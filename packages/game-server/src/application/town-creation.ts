/**
 * Idempotent town creation (Decision 006 `POST /api/v1/towns`).
 *
 * Judge auth, then the creation ledger's claim, then `materializeTown`, then
 * the ledger's completion. A replay reconstructs `inviteUrl` from the
 * request's own idempotency key and the ledger's recorded key version rather
 * than reading a stored URL — the plaintext token is never persisted.
 */

import { CONTENT_VERSION } from "@the-town-remembers/content";
import { DatabaseError } from "@the-town-remembers/database";
import type { Pool } from "pg";

import { materializeTown } from "@the-town-remembers/town-seed";
import type { SecurityConfig } from "@the-town-remembers/runtime-config/security";

import { AppError, internalError, rateLimited } from "../http/errors.js";
import {
  claimCreationRequest,
  completeCreationRequest,
  readTownIdByInviteHash,
} from "../persistence/creation-ledger.js";
import { NO_TOWN_SCOPE, rateScopeKey } from "../persistence/rate-limits.js";
import { townCreationRequestHash } from "../security/fingerprint.js";
import {
  activeSigningKey,
  deriveInviteToken,
  inviteTokenHash,
  inviteUrl,
  signingKeyForVersion,
} from "../security/invite.js";
import { hashIp } from "../security/ip-hash.js";
import { verifyJudgeCode } from "../security/judge-code.js";

/** Generous relative to `materializeTown`'s own budget; this is a rare route. */
const CREATE_TOWN_DEADLINE_MS = 20_000;

export interface TownCreationDependencies {
  readonly pool: Pool;
  readonly securityConfig: SecurityConfig;
  readonly appOrigin: string;
  readonly now: () => Date;
}

export interface TownCreationRequestInput {
  readonly authorizationHeader: string | undefined;
  readonly idempotencyKey: string;
  readonly sourceIp: string | undefined;
}

export interface TownCreationResult {
  readonly townId: string;
  readonly status: "active";
  readonly inviteUrl: string;
}

function idempotencyKeyReused(): never {
  throw new AppError({
    status: 409,
    code: "IDEMPOTENCY_KEY_REUSED",
    title: "Idempotency key reused",
    detail: "This idempotency key was already used for a different request.",
  });
}

export async function createTown(
  deps: TownCreationDependencies,
  input: TownCreationRequestInput,
): Promise<TownCreationResult> {
  verifyJudgeCode(input.authorizationHeader, deps.securityConfig.judgeCode);

  const requestHash = townCreationRequestHash();
  const deadlineAt = deps.now().getTime() + CREATE_TOWN_DEADLINE_MS;
  const activeKey = activeSigningKey(deps.securityConfig);
  const ipHash = hashIp(
    deps.securityConfig.ipHashSecret,
    input.sourceIp ?? "",
    deps.now(),
  );
  const rateLimitScopeKey = rateScopeKey(
    "ip_hash",
    NO_TOWN_SCOPE,
    ipHash.toString("base64url"),
  );

  const decision = await claimCreationRequest(deps.pool, {
    idempotencyKey: input.idempotencyKey,
    requestHash,
    contentVersion: CONTENT_VERSION,
    securityKeyVersion: activeKey.version,
    rateLimitScopeKey,
    now: deps.now,
    deadlineAt,
  });

  if (decision.outcome === "hash_mismatch") idempotencyKeyReused();
  if (decision.outcome === "rate_limited")
    throw rateLimited(decision.retryAfterSeconds);

  if (decision.outcome === "replay") {
    const { row } = decision;
    if (row.status !== "completed" || row.townId === null) {
      // The prior attempt is not (yet) terminal in a way this route can
      // serve; its own claim will eventually expire and be reclaimed.
      throw internalError(
        "The prior attempt for this idempotency key did not complete.",
      );
    }
    const key = signingKeyForVersion(deps.securityConfig, row.securityKeyVersion);
    const token = deriveInviteToken(key, input.idempotencyKey);
    return {
      townId: row.townId,
      status: "active",
      inviteUrl: inviteUrl(deps.appOrigin, token),
    };
  }

  const key = signingKeyForVersion(deps.securityConfig, decision.securityKeyVersion);
  const token = deriveInviteToken(key, input.idempotencyKey);
  const tokenHash = inviteTokenHash(token);

  // The invite hash is deterministic for this creation key and unique in
  // `towns`. Checking it first closes the crash window where materialization
  // committed but the request ledger did not: a reclaimed attempt adopts the
  // already-created town instead of trying to create another one.
  let townId = await readTownIdByInviteHash(deps.pool, tokenHash);
  if (townId === undefined) {
    try {
      const materialized = await materializeTown(deps.pool, {
        contentVersion: decision.contentVersion,
        createdAt: deps.now(),
        inviteTokenHash: tokenHash,
      });
      townId =
        materialized.outcome === "committed"
          ? materialized.value.townId
          : await readTownIdByInviteHash(deps.pool, tokenHash);
    } catch (error) {
      if (!(error instanceof DatabaseError) || error.category !== "unique_violation") {
        throw error;
      }
      townId = await readTownIdByInviteHash(deps.pool, tokenHash);
    }
  }

  if (townId === undefined) {
    // An ambiguous materialization that is not visible yet remains safe to
    // retry: the deterministic invite hash lets a later attempt reconcile it.
    throw internalError("Town materialization outcome is unknown.");
  }

  const responsePayload = {
    townId,
    status: "active" as const,
  };
  await completeCreationRequest(
    deps.pool,
    deps.now().getTime() + CREATE_TOWN_DEADLINE_MS,
    {
      idempotencyKey: input.idempotencyKey,
      processingToken: decision.processingToken,
      townId,
      responseStatus: 201,
      responsePayload,
      now: deps.now,
    },
  );

  return {
    townId,
    status: "active",
    inviteUrl: inviteUrl(deps.appOrigin, token),
  };
}
