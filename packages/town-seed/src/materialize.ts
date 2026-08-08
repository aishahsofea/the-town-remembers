/**
 * Writes a planned town in one transaction.
 *
 * A partially seeded town would be worse than no town: it would look playable
 * and be unsolvable. So the entire seed — identities, truth, evidence, history,
 * beliefs, and both sequence counters — commits or rolls back together.
 *
 * The final update sets `ambient_scheduled_through_sequence` equal to
 * `last_event_sequence`. Authored backstory is history a judge can inspect, but
 * it is already reflected in the seeded episodes and beliefs, so the first
 * player departure must not be able to schedule an ambient tick that gossips
 * about it. Every seed event is also written ambient-ineligible, which says the
 * same thing a second way.
 *
 * This is the direct materializer. Production and demo towns are created
 * through the Phase 3 town-creation ledger with its versioned invite
 * derivation; nothing here derives or returns an invite.
 */

import { contentFor } from "@the-town-remembers/content";
import {
  runSerializable,
  type SerializableResult,
  type TransactionContext,
} from "@the-town-remembers/database";
import type { Pool } from "pg";

import {
  planTown,
  type MaterializationInput,
  type PlannedRow,
  type SeedPlan,
} from "./plan.js";

/** Generous by request standards; this is an operator command, not a route. */
const SEED_DEADLINE_MS = 60_000;

function insertMany(
  transaction: TransactionContext,
  table: string,
  rows: readonly PlannedRow[],
): Promise<unknown[]> {
  if (rows.length === 0) return Promise.resolve([]);

  const columns = Object.keys(rows[0] ?? {});
  const parameters: unknown[] = [];
  const tuples = rows.map((row) => {
    const placeholders = columns.map((column) => {
      parameters.push(row[column]);
      return `$${parameters.length}`;
    });
    return `(${placeholders.join(", ")})`;
  });

  return transaction.query(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${tuples.join(", ")}`,
    parameters,
  );
}

export interface MaterializedTown {
  readonly townId: string;
  readonly contentVersion: string;
  readonly lastEventSequence: number;
  /** Authored key to generated ID. For materialization and tests only. */
  readonly ids: ReadonlyMap<string, string>;
}

export async function materializeTown(
  pool: Pool,
  input: MaterializationInput,
  options: { readonly plan?: SeedPlan; readonly now?: () => number } = {},
): Promise<SerializableResult<MaterializedTown>> {
  const content = contentFor(input.contentVersion);
  const plan = options.plan ?? planTown(content, input);
  const now = options.now ?? Date.now;

  return runSerializable(
    pool,
    { deadlineAt: now() + SEED_DEADLINE_MS },
    async (transaction) => {
      await transaction.query(
        `INSERT INTO public.towns
           (id, invite_token_hash, content_version, status, revision,
            last_event_sequence, ambient_scheduled_through_sequence,
            created_at, updated_at)
         VALUES ($1, $2, $3, 'active', 0, 0, 0, $4, $4)`,
        [
          plan.townId,
          Buffer.from(input.inviteTokenHash),
          plan.contentVersion,
          plan.createdAt,
        ],
      );

      // Ordered by dependency: identities, then truth, then the causal ledger,
      // then the beliefs that ledger explains.
      await insertMany(transaction, "public.story_entities", plan.storyEntities);
      await insertMany(transaction, "public.actors", plan.actors);
      await insertMany(transaction, "public.npcs", plan.npcs);
      await insertMany(transaction, "public.npc_contact_edges", plan.contactEdges);
      await insertMany(transaction, "public.claims", plan.claims);
      await insertMany(transaction, "public.claim_relations", plan.claimRelations);
      await insertMany(transaction, "public.world_facts", plan.worldFacts);
      await insertMany(transaction, "public.case_solutions", [plan.caseSolution]);
      await insertMany(transaction, "public.items", plan.items);
      await insertMany(transaction, "public.inspectables", plan.inspectables);
      await insertMany(transaction, "public.clues", plan.clues);
      await insertMany(transaction, "public.clue_claim_effects", plan.clueEffects);
      await insertMany(transaction, "public.world_events", plan.worldEvents);
      await insertMany(transaction, "public.episodes", plan.episodes);
      await insertMany(
        transaction,
        "public.episode_references",
        plan.episodeReferences,
      );
      await insertMany(transaction, "public.claim_transmissions", plan.transmissions);
      await insertMany(transaction, "public.belief_evidence", plan.primaryEvidence);
      await insertMany(transaction, "public.belief_evidence", plan.mirrorEvidence);
      await insertMany(transaction, "public.npc_beliefs", plan.beliefs);

      // Both counters advance in the same transaction as the events they
      // describe, so the ambient boundary can never disagree with history.
      await transaction.query(
        `UPDATE public.towns
            SET last_event_sequence = $2,
                ambient_scheduled_through_sequence = $2,
                updated_at = $3
          WHERE id = $1`,
        [plan.townId, plan.lastEventSequence, plan.createdAt],
      );

      return {
        townId: plan.townId,
        contentVersion: plan.contentVersion,
        lastEventSequence: plan.lastEventSequence,
        ids: plan.ids,
      };
    },
  );
}
