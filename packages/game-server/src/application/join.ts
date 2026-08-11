/**
 * First-time join and replay closure (Decision 006
 * `POST /api/v1/invites/{inviteToken}/join`).
 *
 * A wrong join-attempt secret is answered identically to an unknown
 * idempotency key — `404`, never `401` — so the ledger's claim step never
 * confirms that a key exists before the secret is checked.
 */

import { createHash, timingSafeEqual } from "node:crypto";

import { DatabaseError, runSerializable } from "@the-town-remembers/database";
import type { Pool } from "pg";

import { AppError, internalError, rateLimited } from "../http/errors.js";
import {
  claimJoinRequest,
  claimReplaySessionSlot,
  closeExhaustedReplay,
  completeJoinRequest,
  type JoinLedgerRow,
} from "../persistence/join-ledger.js";
import { createPlayer } from "../persistence/players.js";
import { rateScopeKey } from "../persistence/rate-limits.js";
import { mintSessionForPlayer } from "../persistence/sessions.js";
import { joinRequestHash } from "../security/fingerprint.js";
import { hashIp } from "../security/ip-hash.js";
import { mintSessionToken, sessionTokenHash } from "../security/session-token.js";

const JOIN_DEADLINE_MS = 20_000;

/** Matches `town-seed/plan.ts`'s NPC actor normalization exactly, so a
 * player name collides with an authored NPC the same way it collides with
 * another player. */
export function normalizeDisplayName(displayName: string): string {
  return displayName.normalize("NFKC").trim().replaceAll(/\s+/gu, " ").toLowerCase();
}

export interface JoinDependencies {
  readonly pool: Pool;
  readonly sessionTokenPepper: string;
  readonly ipHashSecret: string;
  readonly now: () => Date;
}

export interface JoinInput {
  readonly townId: string;
  readonly townActive: boolean;
  readonly townStatus: "active" | "awaiting_resolution" | "resolved";
  readonly idempotencyKey: string;
  readonly joinAttemptSecret: string;
  readonly displayName: string;
  readonly sourceIp: string | undefined;
}

export interface JoinResult {
  readonly townId: string;
  readonly townStatus: "active" | "awaiting_resolution" | "resolved";
  readonly player: { readonly id: string; readonly displayName: string };
  readonly initialVisit: {
    readonly visitId: string;
    readonly locationId: string;
  } | null;
  readonly sessionToken: string;
}

function notFound(): never {
  throw new AppError({
    status: 404,
    code: "RESOURCE_NOT_FOUND",
    title: "Not found",
    detail: "No resource is available at this address.",
  });
}

function idempotencyKeyReused(): never {
  throw new AppError({
    status: 409,
    code: "IDEMPOTENCY_KEY_REUSED",
    title: "Idempotency key reused",
    detail: "This idempotency key was already used for a different request.",
  });
}

function displayNameTaken(): never {
  throw new AppError({
    status: 409,
    code: "DISPLAY_NAME_TAKEN",
    title: "Name already in use",
    detail: "That display name is already in use in this town.",
  });
}

const CLOSED_REASON_PROBLEMS = {
  confirmed: {
    code: "JOIN_REPLAY_CLOSED",
    detail: "This invite link has already been used to sign in.",
  },
  expired: {
    code: "JOIN_REPLAY_EXPIRED",
    detail: "This join attempt is no longer available.",
  },
  exhausted: {
    code: "JOIN_REPLAY_EXHAUSTED",
    detail: "This join attempt has issued too many sessions.",
  },
} as const;

function replayClosed(reason: "confirmed" | "expired" | "exhausted"): never {
  const problem = CLOSED_REASON_PROBLEMS[reason];
  throw new AppError({
    status: 410,
    code: problem.code,
    title: "Join closed",
    detail: problem.detail,
  });
}

function joinAttemptSecretHash(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

function secretMatches(stored: Buffer | null, presented: Buffer): boolean {
  return (
    stored !== null &&
    stored.length === presented.length &&
    timingSafeEqual(stored, presented)
  );
}

function respondFromCompletedRow(row: JoinLedgerRow): JoinResult {
  if (row.status !== "completed" || row.playerId === null) {
    throw internalError(
      "The prior join attempt for this idempotency key did not complete.",
    );
  }
  const payload = row.responsePayload as {
    readonly townId: string;
    readonly townStatus: JoinResult["townStatus"];
    readonly player: { readonly id: string; readonly displayName: string };
    readonly initialVisit: JoinResult["initialVisit"];
  };
  return { ...payload, sessionToken: "" };
}

export async function join(
  deps: JoinDependencies,
  input: JoinInput,
): Promise<JoinResult> {
  const requestHash = joinRequestHash({ displayName: input.displayName });
  const joinSecretDigest = joinAttemptSecretHash(input.joinAttemptSecret);
  const deadlineAt = deps.now().getTime() + JOIN_DEADLINE_MS;
  const ipHash = hashIp(deps.ipHashSecret, input.sourceIp ?? "", deps.now());
  const rateLimitScopeKey = rateScopeKey(
    "ip_hash",
    input.townId,
    ipHash.toString("base64url"),
  );

  const decision = await claimJoinRequest(deps.pool, {
    townId: input.townId,
    idempotencyKey: input.idempotencyKey,
    requestHash,
    joinSecretHash: joinSecretDigest,
    rateLimitScopeKey,
    now: deps.now,
    deadlineAt,
  });

  if (decision.outcome === "hash_mismatch") idempotencyKeyReused();
  if (decision.outcome === "closed") replayClosed(decision.reason);
  if (decision.outcome === "rate_limited")
    throw rateLimited(decision.retryAfterSeconds);

  if (decision.outcome === "replay") {
    if (!secretMatches(decision.row.joinSecretHash, joinSecretDigest)) notFound();

    const saved = respondFromCompletedRow(decision.row);
    const token = mintSessionToken();
    const tokenHash = sessionTokenHash(deps.sessionTokenPepper, token);

    const minted = await runSerializable(
      deps.pool,
      { deadlineAt },
      async (transaction) => {
        const claimedSlot = await claimReplaySessionSlot(
          transaction,
          input.townId,
          input.idempotencyKey,
          deps.now(),
        );
        if (!claimedSlot) return { slot: "exhausted" as const };

        await mintSessionForPlayer(transaction, {
          townId: input.townId,
          playerId: saved.player.id,
          joinRequestId: input.idempotencyKey,
          tokenHash,
          now: deps.now(),
        });
        return { slot: "claimed" as const };
      },
    );
    if (minted.outcome !== "committed")
      throw internalError("Session creation outcome is unknown.");

    if (minted.value.slot === "exhausted") {
      await closeExhaustedReplay(
        deps.pool,
        deadlineAt,
        input.townId,
        input.idempotencyKey,
        deps.now,
      );
      replayClosed("exhausted");
    }

    return { ...saved, sessionToken: token };
  }

  // decision.outcome === "claimed"
  const normalized = normalizeDisplayName(input.displayName);
  const token = mintSessionToken();
  const tokenHash = sessionTokenHash(deps.sessionTokenPepper, token);

  let created;
  try {
    const result = await runSerializable(
      deps.pool,
      { deadlineAt },
      async (transaction) =>
        createPlayer(transaction, {
          townId: input.townId,
          townActive: input.townActive,
          displayName: input.displayName,
          displayNameNormalized: normalized,
          sessionTokenHash: tokenHash,
          joinRequestId: input.idempotencyKey,
          now: deps.now(),
        }),
    );
    if (result.outcome !== "committed") {
      throw internalError("Player creation outcome is unknown.");
    }
    created = result.value;
  } catch (error) {
    if (error instanceof DatabaseError && error.category === "unique_violation") {
      displayNameTaken();
    }
    throw error;
  }

  const responsePayload: Readonly<Record<string, unknown>> = {
    townId: input.townId,
    townStatus: input.townStatus,
    player: { id: created.playerId, displayName: input.displayName },
    initialVisit: created.initialVisit,
  };

  await completeJoinRequest(deps.pool, deadlineAt, {
    townId: input.townId,
    idempotencyKey: input.idempotencyKey,
    playerId: created.playerId,
    initialVisitId: created.initialVisit?.visitId ?? null,
    responseStatus: 201,
    responsePayload,
    now: deps.now,
  });

  return {
    townId: input.townId,
    townStatus: input.townStatus,
    player: { id: created.playerId, displayName: input.displayName },
    initialVisit: created.initialVisit,
    sessionToken: token,
  };
}
