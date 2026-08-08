/**
 * Provenance traversal, testimony/hearsay classification, board-card
 * eligibility, and contradiction pairing.
 */

import type { TransmissionSourceKind } from "@the-town-remembers/database/domains";

import type { DisclosureTier } from "../disclosure/tiers.js";
import { compareByPair } from "../kernel/ordering.js";

// --- Provenance path --------------------------------------------------------------

export interface TransmissionLink {
  readonly transmissionId: string;
  readonly parentTransmissionId: string | null;
  readonly speakerActorId: string;
  readonly speakerActorType: "player" | "npc";
}

export interface PublicActorRef {
  readonly actorId: string;
  readonly actorType: "player" | "npc";
}

/**
 * Follows `parent_transmission_id` from the given transmission back to its
 * root, then reverses the chain into root-first presentation order —
 * exactly the rule Decision 006 states for `provenancePath: PublicActor[]`.
 */
export function buildProvenancePath(
  transmissionId: string,
  transmissionsById: ReadonlyMap<string, TransmissionLink>,
): readonly PublicActorRef[] {
  const chain: PublicActorRef[] = [];
  const visited = new Set<string>();
  let current = transmissionsById.get(transmissionId);

  while (current !== undefined && !visited.has(current.transmissionId)) {
    visited.add(current.transmissionId);
    chain.push({
      actorId: current.speakerActorId,
      actorType: current.speakerActorType,
    });
    current =
      current.parentTransmissionId !== null
        ? transmissionsById.get(current.parentTransmissionId)
        : undefined;
  }

  return chain.toReversed();
}

// --- entryKind / verificationStatus mapping ----------------------------------------

export type TestimonyOrHearsay = "testimony" | "hearsay";

/** `original_assertion`/`direct_observation` -> testimony; the other two -> hearsay. */
export function entryKindForSourceKind(
  sourceKind: TransmissionSourceKind,
): TestimonyOrHearsay {
  return sourceKind === "original_assertion" || sourceKind === "direct_observation"
    ? "testimony"
    : "hearsay";
}

export function verificationStatusFor(
  entryKind: TestimonyOrHearsay,
): "attributed_testimony" | "attributed_hearsay" {
  return entryKind === "testimony" ? "attributed_testimony" : "attributed_hearsay";
}

// --- Board-card eligibility ---------------------------------------------------------

/**
 * No board entry forms for a player-to-NPC assertion (only NPC-to-player
 * transmissions become account cards) or for confidential-tier dialogue.
 */
export function isBoardEligibleTransmission(
  recipientActorType: "player" | "npc",
  speakerActorType: "player" | "npc",
  disclosureTier: DisclosureTier,
): boolean {
  if (recipientActorType !== "player") return false;
  if (speakerActorType !== "npc") return false;
  if (disclosureTier === "confidential") return false;
  return true;
}

/** One verified card per clue — no repeat write once the clue already has a card. */
export function shouldCreateVerifiedEvidenceCard(
  clueId: string,
  existingClueIdsOnBoard: ReadonlySet<string>,
): boolean {
  return !existingClueIdsOnBoard.has(clueId);
}

/** One account card per NPC-to-player transmission. */
export function shouldCreateAccountCard(
  transmissionId: string,
  existingTransmissionIdsOnBoard: ReadonlySet<string>,
): boolean {
  return !existingTransmissionIdsOnBoard.has(transmissionId);
}

// --- Contradiction pairing ----------------------------------------------------------

export interface BoardEntryRef {
  readonly entryId: string;
  readonly claimId: string | null;
}

export interface ClaimContradictionPair {
  readonly claimAId: string;
  readonly claimBId: string;
}

export interface BoardContradictionPair {
  readonly firstEntryId: string;
  readonly secondEntryId: string;
}

/**
 * Contradiction pairs form only when both referenced entries are currently
 * visible on the board. Each pair is ordered lexically by entry ID (never a
 * verdict field — the badge means the accounts conflict, never that either
 * is false), and the returned array is itself stably ordered.
 */
export function computeBoardContradictionPairs(
  visibleEntries: readonly BoardEntryRef[],
  contradictingClaimPairs: readonly ClaimContradictionPair[],
): readonly BoardContradictionPair[] {
  const entryIdsByClaim = new Map<string, string[]>();
  for (const entry of visibleEntries) {
    if (entry.claimId === null) continue;
    const existing = entryIdsByClaim.get(entry.claimId) ?? [];
    existing.push(entry.entryId);
    entryIdsByClaim.set(entry.claimId, existing);
  }

  const seen = new Set<string>();
  const pairs: BoardContradictionPair[] = [];
  for (const relation of contradictingClaimPairs) {
    const entriesA = entryIdsByClaim.get(relation.claimAId) ?? [];
    const entriesB = entryIdsByClaim.get(relation.claimBId) ?? [];
    for (const entryIdA of entriesA) {
      for (const entryIdB of entriesB) {
        if (entryIdA === entryIdB) continue;
        const [firstEntryId, secondEntryId] = [entryIdA, entryIdB].toSorted();
        const key = `${firstEntryId}|${secondEntryId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({ firstEntryId: firstEntryId!, secondEntryId: secondEntryId! });
      }
    }
  }

  return pairs.toSorted((left, right) =>
    compareByPair(
      { firstId: left.firstEntryId, secondId: left.secondEntryId },
      { firstId: right.firstEntryId, secondId: right.secondEntryId },
    ),
  );
}
