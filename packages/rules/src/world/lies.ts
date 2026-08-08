/**
 * Knowing-lie detection: the `D2-J` four-part test.
 *
 * Decision 008 states only negative constraints (mere contradiction is
 * insufficient) and a circular trigger pair (an authored rule and
 * `source_discredited`). This module's test is this plan's own
 * specification, not an extraction of 008 — if it proves wrong during
 * play-testing, that is a Decision 008 amendment, not a defect here.
 */

export interface KnowingLieInputs {
  /** (1) The player directly confirmed the claim to this NPC. */
  readonly playerConfirmedClaimToThisNpc: boolean;
  /** (2) A physically verified contradicting clue was visible to that player at confirmation time. */
  readonly contradictingClueVerifiedAndVisibleAtConfirmation: boolean;
  /** (3) The same NPC later had the clue presented, or already had direct knowledge. */
  readonly npcLaterPresentedClueOrHadDirectKnowledge: boolean;
  /** (4) No prior `lie_established` exists for this exact (player, NPC, claim). */
  readonly priorLieEstablishedForThisPlayerNpcClaim: boolean;
}

/**
 * All four parts must hold. Mere contradiction (parts 2 alone, or 2+3
 * without the player ever confirming anything to this NPC) never
 * establishes a lie, and another NPC's independent knowledge of the same
 * contradiction cannot establish one for a *different* NPC who was never
 * told the claim.
 */
export function establishesKnowingLie(inputs: KnowingLieInputs): boolean {
  return (
    inputs.playerConfirmedClaimToThisNpc &&
    inputs.contradictingClueVerifiedAndVisibleAtConfirmation &&
    inputs.npcLaterPresentedClueOrHadDirectKnowledge &&
    !inputs.priorLieEstablishedForThisPlayerNpcClaim
  );
}

export interface ScopedSourceDiscreditedTarget {
  readonly listeningNpcId: string;
  readonly sourceActorId: string;
  readonly claimId: string;
}

/**
 * On success, the reversal is scoped to exactly this listening NPC, the
 * source actor, and the claim — never propagated to another NPC. The
 * caller enforces this scoping by passing only this NPC's own active
 * contributions to `beliefs/evidence.ts#planSourceDiscreditedReversal`.
 */
export function scopedSourceDiscreditedTarget(
  listeningNpcId: string,
  sourceActorId: string,
  claimId: string,
): ScopedSourceDiscreditedTarget {
  return { listeningNpcId, sourceActorId, claimId };
}
