/**
 * Frozen `bell-mystery-v1` scenario inputs shared by `scenario-runner.ts`
 * and any test that wants a realistic, reusable starting point rather than
 * building one by hand.
 */

import { BELL_MYSTERY_V1 } from "@the-town-remembers/content";

export const FESTIVAL_SQUARE_LOCATION_ID = "festival_square";
export const OLD_CHAPEL_LOCATION_ID = "old_chapel";
export const PLAYER_ID = "player-1";
export const TOWN_ID = "town-1";
export const VISIT_ID = "visit-1";
export const BELL_ITEM_ID = "festival_bell";
export const CASE_ATTEMPT_ID = "case-attempt-1";
export const ACTION_ID = "action-1";
export const RESOLUTION_EVENT_ID = "event-resolution-1";
export const EVIDENCE_SHOWN_EVENT_ID = "event-evidence-shown-1";

export const CASE_SOLUTION_REFERENCE = Object.freeze({
  culpritKey: BELL_MYSTERY_V1.caseSolution.culpritKey,
  motiveKey: BELL_MYSTERY_V1.caseSolution.motiveKey,
  locationKey: BELL_MYSTERY_V1.caseSolution.locationKey,
});

export const CORRECT_GUESS = Object.freeze({
  suspectId: BELL_MYSTERY_V1.caseSolution.culpritKey,
  motiveId: BELL_MYSTERY_V1.caseSolution.motiveKey,
  locationId: BELL_MYSTERY_V1.caseSolution.locationKey,
});

export const INCORRECT_GUESS = Object.freeze({
  suspectId: "mara_venn",
  motiveId: "personal_profit",
  locationId: FESTIVAL_SQUARE_LOCATION_ID,
});

export const REQUIRED_CLUE_COUNT = BELL_MYSTERY_V1.requiredClueKeys.length;
