/**
 * Promise offers, acceptance, breaking/fulfillment, and ending-time
 * resolution.
 *
 * The `promise-offer:v1` encoding is implemented by hand per `D2-E`: three
 * concatenated lines with a raw decimal ordinal, not
 * `domainSeparatedPreimage`'s domain-plus-canonical-JSON shape — reusing
 * that primitive would silently produce the wrong bytes.
 */

import { base64UrlUtf8 } from "@the-town-remembers/serialization";

export const PROMISE_OFFER_DOMAIN = "promise-offer:v1";

export function encodePromiseOffer(sourceActionId: string, ordinal: number): string {
  return base64UrlUtf8(
    `${PROMISE_OFFER_DOMAIN}\n${sourceActionId}\n${String(ordinal)}`,
  );
}

export interface DecodedPromiseOffer {
  readonly sourceActionId: string;
  readonly ordinal: number;
}

const ORDINAL_PATTERN = /^(0|[1-9]\d*)$/;

/** Decodes and validates an offer ID; `undefined` for anything malformed. */
export function decodePromiseOffer(offerId: string): DecodedPromiseOffer | undefined {
  let decoded: string;
  try {
    decoded = Buffer.from(offerId, "base64url").toString("utf8");
  } catch {
    return undefined;
  }

  const parts = decoded.split("\n");
  if (parts.length !== 3) return undefined;
  const [domain, sourceActionId, ordinalText] = parts;
  if (domain !== PROMISE_OFFER_DOMAIN) return undefined;
  if (!sourceActionId) return undefined;
  if (ordinalText === undefined || !ORDINAL_PATTERN.test(ordinalText)) return undefined;

  return { sourceActionId, ordinal: Number(ordinalText) };
}

// --- At most one active promise -----------------------------------------------

export type PromiseKind = "keep_secret" | "return_item";

export interface PromiseKey {
  readonly npcId: string;
  readonly kind: PromiseKind;
  readonly protectedClaimId?: string | null;
  readonly protectedItemId?: string | null;
}

function promiseSubjectMatches(left: PromiseKey, right: PromiseKey): boolean {
  return left.kind === "keep_secret"
    ? left.protectedClaimId === right.protectedClaimId
    : left.protectedItemId === right.protectedItemId;
}

/** Reaccepting an already-active `(NPC, kind, protected subject)` promise is denied. */
export function hasActivePromise(
  activePromises: readonly PromiseKey[],
  candidate: PromiseKey,
): boolean {
  return activePromises.some(
    (promise) =>
      promise.npcId === candidate.npcId &&
      promise.kind === candidate.kind &&
      promiseSubjectMatches(promise, candidate),
  );
}

// --- keep_secret --------------------------------------------------------------

export interface StructuredTransmissionCandidate {
  readonly isStructured: boolean;
  readonly normalizedClaimKey: string;
  readonly recipientActorId: string;
}

/**
 * `keep_secret` breaks the first time the player creates a *structured*
 * transmission of the exact protected normalized claim to anyone but the
 * requesting NPC. An unstructured board note never triggers it.
 */
export function keepSecretBreaks(
  protectedNormalizedClaimKey: string,
  transmission: StructuredTransmissionCandidate,
  requestingNpcId: string,
): boolean {
  if (!transmission.isStructured) return false;
  if (transmission.normalizedClaimKey !== protectedNormalizedClaimKey) return false;
  return transmission.recipientActorId !== requestingNpcId;
}

// --- return_item ----------------------------------------------------------------

export type ReturnItemTransferOutcome = "fulfilled" | "broken" | "no_change";

/**
 * Fulfills when custody reaches the requester, breaks on transfer to anyone
 * else. Leaving town while still holding the item is not a transfer at all
 * (`transferToActorId: null`), so it does nothing.
 */
export function returnItemTransferOutcome(
  requesterActorId: string,
  transferToActorId: string | null,
): ReturnItemTransferOutcome {
  if (transferToActorId === null) return "no_change";
  return transferToActorId === requesterActorId ? "fulfilled" : "broken";
}

// --- Ending-time resolution -------------------------------------------------------

export type EndingChoice = "expose_cover_up" | "restore_bell_quietly";
export type PromiseEndingOutcome = "fulfilled" | "broken" | "unchanged";

/**
 * `restore_bell_quietly` fulfills every active secrecy promise.
 * `expose_cover_up` breaks one only if its protected claim enters the public
 * resolution — otherwise the promise is left active (`unchanged`), not
 * force-resolved.
 */
export function keepSecretEndingOutcome(
  choice: EndingChoice,
  protectedClaimEntersPublicResolution: boolean,
): PromiseEndingOutcome {
  if (choice === "restore_bell_quietly") return "fulfilled";
  return protectedClaimEntersPublicResolution ? "broken" : "unchanged";
}

/**
 * Either ending fulfills an active `return_item` promise iff the requester
 * holds the item at resolution, else breaks it — the chosen ending itself
 * does not matter for this promise kind.
 */
export function returnItemEndingOutcome(
  requesterHoldsItemAtResolution: boolean,
): "fulfilled" | "broken" {
  return requesterHoldsItemAtResolution ? "fulfilled" : "broken";
}
