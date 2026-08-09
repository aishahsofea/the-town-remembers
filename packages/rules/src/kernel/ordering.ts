/**
 * Every stable sort/tie-break rule this package needs, named once and
 * consumed everywhere it applies rather than reimplemented at each call
 * site. `P2-12`/`P2-13` use the recall and ambient comparators; `P2-18` uses
 * the `PlayerView` array orders from Decision 006's "array-sorting" section.
 *
 * Every comparator is a total order over its shape: no two distinct rows a
 * rule can legally produce compare equal, so sorting the same logical set
 * twice — in any starting order — always yields the same array.
 */

function ascendingString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function descendingNumber(a: number, b: number): number {
  return b - a;
}

function descendingTime(a: Date, b: Date): number {
  return b.getTime() - a.getTime();
}

function ascendingTime(a: Date, b: Date): number {
  return a.getTime() - b.getTime();
}

// --- Recall (P2-12) ---------------------------------------------------------

export interface RecallAnchorCandidate {
  readonly importance: number;
  readonly occurredAt: Date;
  readonly episodeId: string;
}

/** Candidate pool order: importance desc, `occurred_at` desc, episode ID asc. */
export function compareRecallAnchors(
  left: RecallAnchorCandidate,
  right: RecallAnchorCandidate,
): number {
  return (
    descendingNumber(left.importance, right.importance) ||
    descendingTime(left.occurredAt, right.occurredAt) ||
    ascendingString(left.episodeId, right.episodeId)
  );
}

export interface RecallScoredResult {
  readonly score: number;
  readonly occurredAt: Date;
  readonly episodeId: string;
}

/** Final ranking order: recall score desc, `occurred_at` desc, episode ID asc. */
export function compareRecallResults(
  left: RecallScoredResult,
  right: RecallScoredResult,
): number {
  return (
    descendingNumber(left.score, right.score) ||
    descendingTime(left.occurredAt, right.occurredAt) ||
    ascendingString(left.episodeId, right.episodeId)
  );
}

// --- Ambient (P2-13) ---------------------------------------------------------

export interface AmbientCandidateOrderingKey {
  readonly priority: number;
  readonly normalizedClaimKey: string;
  readonly speakerActorId: string;
  readonly recipientActorId: string;
}

/** Shortlist order: priority desc, normalized claim key, speaker ID, recipient ID. */
export function compareAmbientCandidates(
  left: AmbientCandidateOrderingKey,
  right: AmbientCandidateOrderingKey,
): number {
  return (
    descendingNumber(left.priority, right.priority) ||
    ascendingString(left.normalizedClaimKey, right.normalizedClaimKey) ||
    ascendingString(left.speakerActorId, right.speakerActorId) ||
    ascendingString(left.recipientActorId, right.recipientActorId)
  );
}

// --- PlayerView array orders (P2-18), Decision 006 "array-sorting" ------------

export interface MapOrderedRow {
  readonly mapOrder: number;
  readonly id: string;
}

/** `map`: authored `(mapOrder, id)`, both ascending. */
export function compareByMapOrder(left: MapOrderedRow, right: MapOrderedRow): number {
  return left.mapOrder - right.mapOrder || ascendingString(left.id, right.id);
}

export interface NormalizedNameRow {
  readonly normalizedName: string;
  readonly id: string;
}

/**
 * `inspectables`, `encounters`, `inventory`, and `discoveredClues`: normalized
 * display name, then ID.
 */
export function compareByNormalizedNameThenId(
  left: NormalizedNameRow,
  right: NormalizedNameRow,
): number {
  return (
    ascendingString(left.normalizedName, right.normalizedName) ||
    ascendingString(left.id, right.id)
  );
}

export interface ContributorRow {
  readonly discoverySequence: number;
  readonly playerId: string;
}

/** A clue's `contributors`: discovery sequence, then player ID. */
export function compareByDiscoverySequenceThenPlayerId(
  left: ContributorRow,
  right: ContributorRow,
): number {
  return (
    left.discoverySequence - right.discoverySequence ||
    ascendingString(left.playerId, right.playerId)
  );
}

export interface AcceptedAtRow {
  readonly acceptedAt: Date;
  readonly id: string;
}

/** `activePromises`: `(acceptedAt, promiseId)`, both ascending. */
export function compareByAcceptedAtThenId(
  left: AcceptedAtRow,
  right: AcceptedAtRow,
): number {
  return (
    ascendingTime(left.acceptedAt, right.acceptedAt) ||
    ascendingString(left.id, right.id)
  );
}

export interface CreatedAtRow {
  readonly createdAt: Date;
  readonly id: string;
}

/** `caseBoard` and `caseAttempts`: `(createdAt, id)`, both ascending. */
export function compareByCreatedAtThenId(
  left: CreatedAtRow,
  right: CreatedAtRow,
): number {
  return (
    ascendingTime(left.createdAt, right.createdAt) || ascendingString(left.id, right.id)
  );
}

export interface PairRow {
  readonly firstId: string;
  readonly secondId: string;
}

/** `caseBoardContradictions`: `(firstEntryId, secondEntryId)`, both ascending. */
export function compareByPair(left: PairRow, right: PairRow): number {
  return (
    ascendingString(left.firstId, right.firstId) ||
    ascendingString(left.secondId, right.secondId)
  );
}

export interface AuthoredOrderRow {
  readonly authoredOrder: number;
  readonly id: string;
}

/** Accusation options (suspects/motives/locations): frozen authored order, then ID. */
export function compareByAuthoredOrder(
  left: AuthoredOrderRow,
  right: AuthoredOrderRow,
): number {
  return left.authoredOrder - right.authoredOrder || ascendingString(left.id, right.id);
}

/** The two resolution choices, `expose_cover_up` always first. */
export const RESOLUTION_CHOICE_ORDER: readonly string[] = Object.freeze([
  "expose_cover_up",
  "restore_bell_quietly",
]);

export function compareResolutionChoices(left: string, right: string): number {
  return RESOLUTION_CHOICE_ORDER.indexOf(left) - RESOLUTION_CHOICE_ORDER.indexOf(right);
}
