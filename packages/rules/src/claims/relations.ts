/**
 * Claim relations: `contradicts` (fully implemented) and `entails`
 * (implemented defensively per `D2-Q`, since no fixture in the shipped
 * `bell-mystery-v1` content exercises it — every `entails` row propagates
 * zero weight rather than being rejected).
 *
 * The three authored `contradicts` pairs already live in
 * `content#CLAIM_RELATIONS`, stored both directions. This module adds the
 * general mechanism a *new*, in-play (dynamic) claim's relation goes
 * through: mirror weight derivation and the backfill plan for evidence that
 * existed before the relation did.
 */

export type ClaimRelationKind = "contradicts" | "entails";

export interface ClaimRelationRow {
  readonly claimAId: string;
  readonly claimBId: string;
  readonly relationKind: ClaimRelationKind;
}

/** Whether the mirror `(b, a, kind)` row already exists for a `(a, b, kind)` row. */
export function hasMirroredRelation(
  relations: readonly ClaimRelationRow[],
  claimAId: string,
  claimBId: string,
  relationKind: ClaimRelationKind,
): boolean {
  return relations.some(
    (relation) =>
      relation.claimAId === claimBId &&
      relation.claimBId === claimAId &&
      relation.relationKind === relationKind,
  );
}

/**
 * The weight a mirror contribution carries on the *other* claim in a
 * relation, given the primary contribution's signed weight. A `contradicts`
 * mirror is the exact opposite (Decision 008: "supporting evidence of
 * weight W appends −W to every explicitly contradicted claim"). An
 * `entails` mirror propagates zero weight (`D2-Q`) — `entails` is accepted
 * and stored, but has no evidentiary effect in `mvp-rules-v1`.
 */
export function mirrorWeightFor(
  relationKind: ClaimRelationKind,
  primaryWeight: number,
): number {
  return relationKind === "entails" ? 0 : -primaryWeight;
}

export interface UnreversedSupportRow {
  readonly evidenceId: string;
  readonly npcId: string;
  readonly claimId: string;
  readonly signedWeight: number;
}

export interface ExistingMirrorRow {
  readonly claimId: string;
  readonly mirrorsEvidenceId: string;
}

export interface ContradictionMirrorBackfillPlanEntry {
  readonly npcId: string;
  readonly claimId: string;
  readonly mirrorsEvidenceId: string;
  readonly signedWeight: number;
  readonly causalEventId: string;
}

/**
 * When a new `contradicts` relation is created between two claims, any
 * *existing*, unreversed support either claim already had needs a mirror on
 * the other claim — the relation didn't exist yet when that support was
 * appended, so no mirror was written at the time. This is a pure planning
 * function: it returns the plan, but commits nothing, and the caller
 * supplies the causal event identity (the event that created the relation)
 * since this module never generates one itself.
 *
 * Only `contradicts` needs backfilling: `entails` mirrors carry zero weight,
 * so a backfilled `entails` mirror would contribute nothing.
 */
export function planContradictionMirrorBackfill(
  claimAId: string,
  claimBId: string,
  unreversedSupport: readonly UnreversedSupportRow[],
  existingMirrors: readonly ExistingMirrorRow[],
  causalEventId: string,
): readonly ContradictionMirrorBackfillPlanEntry[] {
  const alreadyMirrored = new Set(
    existingMirrors.map((mirror) => `${mirror.claimId}:${mirror.mirrorsEvidenceId}`),
  );

  const plan: ContradictionMirrorBackfillPlanEntry[] = [];
  for (const support of unreversedSupport) {
    const otherClaimId =
      support.claimId === claimAId
        ? claimBId
        : support.claimId === claimBId
          ? claimAId
          : undefined;
    if (otherClaimId === undefined) continue;

    const key = `${otherClaimId}:${support.evidenceId}`;
    if (alreadyMirrored.has(key)) continue;

    plan.push({
      npcId: support.npcId,
      claimId: otherClaimId,
      mirrorsEvidenceId: support.evidenceId,
      signedWeight: mirrorWeightFor("contradicts", support.signedWeight),
      causalEventId,
    });
  }

  return plan.toSorted(
    (left, right) =>
      left.claimId.localeCompare(right.claimId) ||
      left.npcId.localeCompare(right.npcId) ||
      left.mirrorsEvidenceId.localeCompare(right.mirrorsEvidenceId),
  );
}
