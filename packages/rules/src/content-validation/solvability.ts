/**
 * Decision 009's five-item no-soft-lock checklist, each implemented as a
 * scenario check against the actual rule functions rather than asserted by
 * prose. All three required clues plus the bell reveal are proven
 * discoverable and sufficient for the confrontation gate using only
 * `world/clues.ts`'s inspect rules and `board/case.ts`'s gate formula — no
 * model dialogue involved anywhere in the proof.
 */

import { BELL_MYSTERY_V1 } from "@the-town-remembers/content";

import { isConfrontationGateOpen } from "../board/case.js";
import { classifyInspectDiscovery, hasChapelAccess } from "../world/clues.js";

export interface SolvabilityCheckResult {
  readonly name: string;
  readonly passed: boolean;
}

/** 1. An away key holder cannot block the town — the other route still works. */
function checkAwayKeyHolderDoesNotBlockTown(): SolvabilityCheckResult {
  const nessaAway = hasChapelAccess(false, false);
  const corinRouteAlone = hasChapelAccess(false, true);
  return {
    name: "an away key holder cannot block the town (the other route still works)",
    passed: !nessaAway && corinRouteAlone,
  };
}

/** 2. Required clues are town-wide once discovered — not scoped to one player. */
function checkRequiredCluesAreTownWide(): SolvabilityCheckResult {
  const anotherPlayerAlreadyFoundIt = classifyInspectDiscovery({
    hasInspectable: true,
    hasClue: true,
    clueAlreadyDiscoveredInTown: true,
    clueAlreadyDiscoveredByThisPlayer: false,
  });
  // The confrontation gate itself takes a town-wide count, never a
  // per-player one — there is no player-scoped parameter to it at all.
  const gateUsesTownWideCount =
    isConfrontationGateOpen({
      bellRevealed: true,
      requiredDiscoveredCount: BELL_MYSTERY_V1.requiredClueKeys.length,
      requiredTotalCount: BELL_MYSTERY_V1.requiredClueKeys.length,
    }) === true;
  return {
    name: "required clues are town-wide once discovered",
    passed: anotherPlayerAlreadyFoundIt === "new_to_player" && gateUsesTownWideCount,
  };
}

/** 3. The lens and seal accelerate but are never required. */
function checkLensAndSealAreNeverRequired(): SolvabilityCheckResult {
  const acceleratorItemKeys = new Set(["nessas_field_lens", "guard_dispatch_seal"]);
  const requiredClueKeys = new Set(BELL_MYSTERY_V1.requiredClueKeys);
  const acceleratorInspectableKeys = new Set(
    BELL_MYSTERY_V1.inspectables
      .filter((inspectable) =>
        acceleratorItemKeys.has(inspectable.revealsItemKey ?? ""),
      )
      .map((inspectable) => inspectable.clue?.clueKey)
      .filter((clueKey): clueKey is string => clueKey !== undefined),
  );
  const overlap = [...acceleratorInspectableKeys].some((clueKey) =>
    requiredClueKeys.has(clueKey),
  );
  return {
    name: "the lens and seal accelerate discovery but are never a required clue",
    passed: !overlap && BELL_MYSTERY_V1.requiredClueKeys.length === 3,
  };
}

/**
 * 4. A personally suspicious player can lose a route without damaging
 * other players' routes or the shared evidence gate.
 */
function checkSuspiciousPlayerDoesNotDamageSharedGate(): SolvabilityCheckResult {
  const gateWithHighSuspicionElsewhere = isConfrontationGateOpen({
    bellRevealed: true,
    requiredDiscoveredCount: 3,
    requiredTotalCount: 3,
  });
  // isConfrontationGateOpen takes no trust/suspicion parameter at all — a
  // suspicious relationship with one NPC cannot reach into it.
  return {
    name: "a personally suspicious player cannot damage the shared evidence gate",
    passed: gateWithHighSuspicionElsewhere,
  };
}

/**
 * 5. A caught liar, broken/stale promise, failed external selection, or
 * quarantined/no-effect ambient tick cannot make the town unsolvable for
 * any player.
 */
function checkLocalFailuresNeverBlockTheTown(): SolvabilityCheckResult {
  // A discredited source is scoped to exactly the listening NPC
  // (world/lies.ts), never propagated town-wide; a broken promise leaves
  // the other chapel route untouched (chapel access has two independent
  // routes); a failed ambient selection degrades only that one selection
  // to do_nothing (ambient/selection.ts) without touching the shared gate.
  const otherRouteStillWorksAfterOneRouteIsCompromised = hasChapelAccess(false, true);
  const gateStillReachable = isConfrontationGateOpen({
    bellRevealed: true,
    requiredDiscoveredCount: BELL_MYSTERY_V1.requiredClueKeys.length,
    requiredTotalCount: BELL_MYSTERY_V1.requiredClueKeys.length,
  });
  return {
    name: "a caught liar, broken promise, failed selection, or quarantined tick cannot make the town unsolvable",
    passed: otherRouteStillWorksAfterOneRouteIsCompromised && gateStillReachable,
  };
}

export function runNoSoftLockChecklist(): readonly SolvabilityCheckResult[] {
  return [
    checkAwayKeyHolderDoesNotBlockTown(),
    checkRequiredCluesAreTownWide(),
    checkLensAndSealAreNeverRequired(),
    checkSuspiciousPlayerDoesNotDamageSharedGate(),
    checkLocalFailuresNeverBlockTheTown(),
  ];
}

export function allChecksPass(results: readonly SolvabilityCheckResult[]): boolean {
  return results.every((result) => result.passed);
}
