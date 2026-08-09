/**
 * The `npc_player_relationships` half of a relationship change. Appending
 * `relationship_changes` history is not enough on its own: nothing in the
 * schema recomputes the current row, so every planner that emits ledger rows
 * also emits the compare-and-swap that advances the aggregate they sum to.
 */

import {
  aggregateRelationshipUpdates,
  type RelationshipContribution,
  type RelationshipSnapshot,
} from "../beliefs/relationships.js";
import type { EffectPlanEntry } from "../kernel/effects.js";

/**
 * One conditional state change per relationship this event actually moved,
 * ordered by (npc, player) so a plan's effects stay comparable across runs.
 */
export function relationshipStateChangeEffects(
  snapshots: readonly RelationshipSnapshot[],
  contributions: readonly RelationshipContribution[],
  updatedEventId: string,
): readonly EffectPlanEntry[] {
  return aggregateRelationshipUpdates(snapshots, contributions).map((aggregate) => ({
    kind: "conditional_state_change",
    table: "npc_player_relationships",
    key: { npc_id: aggregate.npcId, player_id: aggregate.playerId },
    expectedRevision: aggregate.expectedRevision,
    change: {
      trust_score: aggregate.trustScore,
      suspicion_score: aggregate.suspicionScore,
      updated_event_id: updatedEventId,
    },
  }));
}
