/**
 * Validates and applies a bounded `AmbientChoiceV1` selection.
 *
 * Schema conformance is Decision 010's job at the calling phase; this module
 * owns only semantic validation. One call produces one atomic plan
 * containing zero, one, or two transmission effects
 * (`AMBIENT_MAXIMUM_SELECTIONS`).
 */

import type { AmbientChoiceV1 } from "@the-town-remembers/model-contracts";

import { AMBIENT_DO_NOTHING_CHOICE_ID } from "./eligibility.js";

/** The six named ways one selection independently degrades to `do_nothing`. */
export type AmbientSelectionFailureReason =
  | "missing_candidate"
  | "duplicate_choice"
  | "out_of_list_id"
  | "repeated_claim"
  | "repeated_speaker"
  | "newly_invalid";

export interface AmbientShortlistEntry {
  readonly choiceId: string;
  readonly claimId: string;
  readonly speakerActorId: string;
  /** Whether the candidate still resolves to a real row at apply time. */
  readonly isResolvable: boolean;
  /**
   * Hop/provenance/contact/disclosure eligibility, revalidated at apply
   * time — never trusted from shortlist-generation time.
   */
  readonly isStillEligible: boolean;
}

export interface AmbientSelectionOutcome {
  readonly choiceId: string;
  readonly applied: boolean;
  readonly failureReason?: AmbientSelectionFailureReason;
  readonly entry?: AmbientShortlistEntry;
}

export interface AmbientSelectionPlan {
  readonly primary: AmbientSelectionOutcome | undefined;
  readonly secondary: AmbientSelectionOutcome | undefined;
  readonly transmissionCount: number;
}

function validateSingleChoice(
  choiceId: string,
  shortlist: readonly AmbientShortlistEntry[],
  usedClaimIds: ReadonlySet<string>,
  usedSpeakerIds: ReadonlySet<string>,
): AmbientSelectionOutcome {
  const entry = shortlist.find((candidate) => candidate.choiceId === choiceId);
  if (entry === undefined) {
    return { choiceId, applied: false, failureReason: "out_of_list_id" };
  }
  if (!entry.isResolvable) {
    return { choiceId, applied: false, failureReason: "missing_candidate", entry };
  }
  if (usedClaimIds.has(entry.claimId)) {
    return { choiceId, applied: false, failureReason: "repeated_claim", entry };
  }
  if (usedSpeakerIds.has(entry.speakerActorId)) {
    return { choiceId, applied: false, failureReason: "repeated_speaker", entry };
  }
  if (!entry.isStillEligible) {
    return { choiceId, applied: false, failureReason: "newly_invalid", entry };
  }
  return { choiceId, applied: true, entry };
}

/**
 * Sequential validation: `primary_choice_id` is checked against the
 * pre-tick shortlist; if it applies, `secondary_choice_id` is checked
 * against that same shortlist *plus* the primary's now-committed-in-this-
 * plan effect — same-batch chaining, never a separate call.
 */
export function planAmbientSelections(
  choice: AmbientChoiceV1,
  shortlist: readonly AmbientShortlistEntry[],
): AmbientSelectionPlan {
  const usedClaimIds = new Set<string>();
  const usedSpeakerIds = new Set<string>();

  let primary: AmbientSelectionOutcome | undefined;
  if (
    choice.decision === "select_choices" &&
    choice.primary_choice_id !== null &&
    choice.primary_choice_id !== AMBIENT_DO_NOTHING_CHOICE_ID
  ) {
    primary = validateSingleChoice(
      choice.primary_choice_id,
      shortlist,
      usedClaimIds,
      usedSpeakerIds,
    );
    if (primary.applied && primary.entry) {
      usedClaimIds.add(primary.entry.claimId);
      usedSpeakerIds.add(primary.entry.speakerActorId);
    }
  }

  let secondary: AmbientSelectionOutcome | undefined;
  if (
    choice.decision === "select_choices" &&
    choice.secondary_choice_id !== null &&
    choice.secondary_choice_id !== AMBIENT_DO_NOTHING_CHOICE_ID
  ) {
    if (choice.secondary_choice_id === choice.primary_choice_id) {
      secondary = {
        choiceId: choice.secondary_choice_id,
        applied: false,
        failureReason: "duplicate_choice",
      };
    } else {
      secondary = validateSingleChoice(
        choice.secondary_choice_id,
        shortlist,
        usedClaimIds,
        usedSpeakerIds,
      );
    }
  }

  const transmissionCount = (primary?.applied ? 1 : 0) + (secondary?.applied ? 1 : 0);
  return { primary, secondary, transmissionCount };
}
