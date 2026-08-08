-- The episode recall index.
--
-- `town_id` and `npc_id` lead the index because recall is always scoped to one
-- NPC in one town. A vector index without those prefixes would search every
-- NPC's memory and then filter, which is both slower and a tenant-isolation
-- hazard.
--
-- The predicate excludes embeddings that are pending or failed. Decision 005
-- permits omitting the predicate where a version cannot express it and relying
-- on the query-side filter instead; v25.4 supports it, so both apply. Recall
-- still filters `embedding_status = 'ready'` explicitly, which keeps the query
-- correct on a cluster whose index had to be created without the predicate.
--
-- An embedding failure never discards the episode. The row stays, the vector
-- stays null, and recall falls back to the deterministic candidate pool rather
-- than losing the memory.

CREATE VECTOR INDEX ix_episodes__embedding
  ON public.episodes (town_id, npc_id, embedding)
  WHERE embedding_status = 'ready';
