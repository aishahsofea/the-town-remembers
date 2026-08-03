# Decision 008: Deterministic Game Rules

- **Project:** The Town Remembers
- **Status:** Accepted numerical baseline; implementation pending
- **Date:** 2026-08-02
- **Rule version:** `mvp-rules-v1`
- **Scope:** Beliefs, relationships, disclosure, access, recall, promises,
  ambient propagation, and case progression

## Decision

Use one versioned, deterministic ruleset for every gameplay consequence. Models
may interpret player language, choose from a bounded ambient candidate list, and
render approved dialogue, but they never calculate these values or override a
failed gate.

`towns.content_version` identifies both the authored mystery content and the
rules version used to seed that town. A deployed balance change creates a new
version; it does not silently change an existing town.

The numerical targets are:

- One neutral-source testimony makes an NPC lean toward a claim, not become
  convinced.
- One direct observation or verified physical clue can make an NPC convinced.
- One verified clue can overturn one ordinary testimony.
- Repeating the same source cannot grind belief or relationship scores.
- Trust 40 requires a short history of helpful conduct, not one dialogue turn.
- One established lie immediately reaches the visible suspicious threshold.
- The authored mystery remains solvable without any model making a rule
  decision.

## Numeric conventions

- Belief, trust, and suspicion scores are integers clamped to `[-100, 100]`.
- `floor` means mathematical floor, including for negative values.
- Beliefs and relationships do not decay with time in the MVP.
- All effects caused by one world event are calculated from the same pre-event
  snapshot, summed by target row, clamped once, and committed atomically.
- Every contribution stores `rule_version = "mvp-rules-v1"`.
- A causal source contributes at most once to the same target and rule. API
  retries, repeated `Show` actions, and another transmission descended from the
  same original speaker do not create another numerical effect.
- Claims may be created through the bounded grammar during play. Creating a
  claim also creates all deterministic relations to existing claims and
  backfills missing contradiction mirrors from existing primary support
  evidence in the same transaction. Evidence results therefore do not depend
  on which claim happened to be asserted first.

One player action uses this order:

1. Validate authority, location, custody, and the pre-action town snapshot.
2. Calculate all deterministic evidence and relationship deltas from that
   snapshot.
3. Derive the post-action scores and evaluate disclosure, item, capability,
   promise-offer, and progression gates against that post-action state.
4. Give the model only the resulting approved bundle.
5. Validate the rendered response and commit the effects, gate result, and
   response atomically against the same town revision.

This means a `Show` action may cross trust 40 and unlock an offer or capability
in its own response. If the final revision check fails, none of those predicted
effects become visible.

## Beliefs

### Score labels and dialogue stance

| Score | Stored label | Approved dialogue stance |
|---:|---|---|
| `60` to `100` | `convinced` | May state the claim confidently |
| `20` to `59` | `leaning` | May state the claim tentatively |
| `-19` to `19` | `doubtful` | May describe it only as uncertain or reported speech |
| `-100` to `-20` | `doubtful` | May explicitly reject the claim |

For a set of mutually contradictory claims, let `lead` be the highest score
minus the second-highest score. When no contradictory claim has evidence, use
`0` as the second score:

- A claim is the NPC's **selected belief** only when its score is at least `20`
  and `lead` is at least `20`.
- When `lead < 20`, the claims are contested. None may unlock a belief-dependent
  gate or be phrased as settled truth.
- A cover story is the sole exception: Corin may deliberately state its
  authored wording while that cover story remains enabled, but it is labelled
  as an authorized deception and never becomes objective truth.

### Evidence weights

| Evidence contribution | Weight |
|---|---:|
| NPC direct observation supporting a claim | `+80` |
| Verified physical clue supporting a claim | `+70` |
| Verified physical clue contradicting a claim | `-70` |
| Independent corroborating testimony from the second source | `+15` |
| Independent corroborating testimony from the third source | `+15` |
| Fourth and later independent sources | `0` additional corroboration |

A direct observation supports the normalized claim represented by that
episode. A physical clue uses its authored `supports` or `contradicts` edge,
but every MVP v1 edge has absolute weight `70`; a different strength requires a
new rules version. If an explicit `contradicts` edge and a derived mirror target
the same `(NPC, clue, claim)`, they coalesce into one `-70` contribution.
Positive clue support is stored as `physical_clue`; every negative clue effect,
whether explicit or mirrored, is stored as `contradiction`.

Testimony uses the listener's trust at transmission time:

```text
player_base = clamp(35 + floor(player_trust / 10), 25, 45)
npc_base    = clamp(40 + floor(listener_trust_in_speaker / 10), 30, 50)
testimony   = max(10, base - 10 * hop_count)
```

- Use `player_base` when the immediate speaker is a player and `npc_base` when
  the immediate speaker is an NPC. Root identity affects deduplication and
  corroboration, not whose trust the listener applies to this transmission.
- `player_trust` is the recipient NPC's current trust in that player.
- `listener_trust_in_speaker` is the authored directional NPC trust from the
  listening NPC toward the speaking NPC. A versioned pre-game transmission may
  store an explicit trust snapshot even when no live contact edge exists; the
  v1 Nessa-from-Corin seed testimony uses `0`. Live ambient communication still
  requires a contact edge.
- Original assertion and direct-observation transmissions have `hop_count = 0`.
  Every repeat adds one, and alleged hearsay begins at `1`.
- Trust is snapshotted before the testimony's relationship effects and is never
  recomputed retroactively.

### Source independence and repeat protection

The **independent source** is the actor who originated the root transmission,
not merely a newly generated transmission ID. For one `(NPC, claim)` pair:

- The same originating actor contributes testimony weight once.
- Descendant hearsay from that actor contributes no second testimony weight to
  an NPC who already heard that source.
- A player intentionally repeating the same claim with a new action remains the
  same source and contributes no additional weight.
- With `N` active independent sources, the corroboration bonus is
  `15 * min(2, max(0, N - 1))`. It is therefore `0`, `15`, or `30`.

`belief_evidence` must therefore retain both the root transmission and the root
speaker identity. The repository enforces uniqueness for testimony by
`(town_id, npc_id, claim_id, independent_source_actor_id)`.

### Contradictions, entailment, and reversals

- Supporting evidence of weight `W` appends `+W` to its claim and, for every
  explicit `contradicts` relation, a separate `-W` mirror contribution to the
  contradicted claim.
- Evidence authored only as `contradicts` appends its negative weight to that
  claim but does not infer which alternative is true.
- A mirror contribution never recursively creates another mirror.
- Every mirror stores the primary evidence row it mirrors and is unique for
  `(NPC, target claim, primary evidence)`. When a new contradiction relation is
  created, missing mirrors of existing, unreversed primary support are
  backfilled before the new claim's own effects commit. A backfilled row uses
  the claim-creation event as its causal event and the older primary row as its
  mirrored source.
- `entails` relations do not propagate numerical weight in v1. They support
  explanation and authored gates only.
- When a source is explicitly discredited, each of that source's active
  testimony contributions and their contradiction mirrors receives one exact
  opposite reversal.
- After any source addition or reversal, calculate the corroboration formula
  before and after the event and append the difference as a signed
  `corroboration` row. Crossing either threshold adds or removes `15`; later
  sources may cross the same threshold again.
- Original evidence rows are append-only. A reversal points to exactly one row,
  and the same row cannot be reversed twice.

Discrediting is scoped to one listening NPC, source actor, and claim; knowledge
does not teleport to other NPCs. Establishing a knowing lie emits that targeted
`source_discredited` effect. A broken promise changes relationship and recall
but does not, by itself, reverse factual testimony. Other NPCs revise the claim
only after receiving their own clue, contradiction, or valid later
communication.

The stored belief score is:

```text
belief_score = clamp(sum(all evidence and reversal weights), -100, 100)
```

## Relationships

Every player starts at `trust = 0` and `suspicion = 0` with every NPC.

### Qualitative stance

| Condition | Player-visible stance |
|---|---|
| Suspicion `>= 40` | `suspicious` |
| Otherwise, trust `>= 40` | `trusting` |
| Otherwise, trust `<= -20` | `wary` |
| Otherwise | `neutral` |

Suspicion takes precedence over every trust label.

### Event deltas

| Deterministic event | Trust | Suspicion |
|---|---:|---:|
| Earlier testimony from this player is verified by a clue | `+10` | `-5` |
| Player presents a relevant verified clue without an established lie implicated by that clue | `+5` | `-5` |
| Player gives the NPC an item that NPC requested | `+15` | `-5` |
| Promise to that NPC is fulfilled | `+25` | `-15` |
| Player's assertion is explicitly established as a knowing lie | `-30` | `+40` |
| Promise to that NPC is broken | `-40` | `+35` |
| Unsupported, irrelevant, repeated, or merely contradictory speech | `0` | `0` |

Distinct reasons caused by one event stack. For example, showing a clue that
verifies the player's earlier testimony applies both positive rows for a net
`trust +15, suspicion -10`. A clue that establishes the player's lie applies
the lie row and does not also grant either positive clue row in that `Show`
event.

Repeat protection is exact:

- `verified_testimony`: once per NPC, player, and claim, regardless of how many
  times that player asserted it.
- `evidence_presented`: once per NPC, player, and clue.
- `requested_item_given`: once per NPC, player, and authored request/item pair.
- `lie_established`: once per NPC, player, and claim.
- Promise consequences: once per promise, guaranteed by its terminal state.

Evidence that merely contradicts a player does not prove intent and produces no
lie penalty. Only an authored rule or `source_discredited` event may establish a
knowing lie.

### Reachability requirement

For every mandatory trust gate, the authored seed must contain a non-repeating,
pre-gate sequence of at most four positive relationship events that reaches the
threshold from zero. A seed validation test enumerates those events and rejects
content that can soft-lock the mystery.

Under the default deltas, three clue presentations that each verify one earlier
assertion produce `trust = 45` and `suspicion = -30`, enough to pass a trust-40
gate without score grinding.

## Disclosure and access

### Dialogue disclosure

| Tier | Exact gate |
|---|---|
| `public` | Relevant to the request |
| `guarded` | `(trust >= 20 AND suspicion < 40)`, or a relevant verified clue is presented in the current action |
| `confidential` | `trust >= 40 AND suspicion < 20` and the player has never broken a promise to this NPC |
| `cover_story` | Corin's authored cover story and the final-confrontation gate is still closed |
| `final_truth` | Final-confrontation gate is open |

Passing a disclosure tier only permits a claim to enter the dialogue bundle.
Ordinary claims must also satisfy the belief/contestation rule above. Direct
observations may be recounted as observations, and reported claims as reported
speech, even when the NPC does not currently believe them.

### Item and location gates

- Nessa transfers the chapel key only when `trust >= 40`, `suspicion < 40`, and
  the player accepts the authored return-item promise in the same action.
- A player may enter the Old Chapel when they hold the chapel key or have the
  `enter_old_chapel` capability.
- Corin grants `enter_old_chapel` only when `trust >= 40`, `suspicion < 20`, and
  the player presents a relevant required clue in that action.
- A broken promise to the relevant NPC cannot be bypassed by later score gains
  where the tier explicitly checks promise history.

## Episodic recall

### Importance defaults

Runtime episodes receive these minimum importance values. Authored seed content
may set a higher value, never a lower one.

| Episode | Minimum importance |
|---|---:|
| Direct observation | `90` |
| Heard original testimony, hop `0` | `60` |
| Heard testimony, hop `1` | `50` |
| Heard testimony, hop `2` or `3` | `40` |
| Ordinary player interaction | `40` |
| Fulfilled promise | `85` |
| Broken promise or established lie | `100` |
| Unique-item transfer | `85` |
| Other consequential world event | `80` |

An episode involved in an active contradiction has an effective importance
floor of `80` during reranking; the immutable stored importance is not edited.

### Candidate pool and formula

Recall unions:

- At most `30` vector candidates scoped to one town and NPC.
- At most `10` structured anchors, ordered by importance descending, occurrence
  time descending, then episode ID. Anchors are recent episodes, importance-80+
  episodes, active promises or grievances, and active contradictions.

After deduplication, calculate:

```text
similarity    = clamp(cosine_similarity, 0, 1)
age_hours     = max(0, query_time - occurred_at) in hours
recency       = 2 ^ (-age_hours / 168)
importance    = effective_importance / 100

recall_score =
    0.45 * similarity
  + 0.15 * recency
  + 0.15 * importance
  + 0.10 * directness
  + 0.10 * commitment_or_grievance
  + 0.05 * active_contradiction
```

`directness` is:

| Episode | Value |
|---|---:|
| Direct observation, item transfer, promise consequence, or world consequence | `1.0` |
| Original testimony at hop `0` | `0.6` |
| Hearsay at hop `1+` | `0.3` |
| Ordinary player interaction without a structured claim | `0.5` |

The two remaining signals are `1.0` when true and `0.0` otherwise:

- `commitment_or_grievance` is true when the episode and current query share the
  player, claim, or item of an active promise, established lie, or broken
  promise involving this NPC. MVP grievances do not expire automatically.
- `active_contradiction` is true when the episode references a claim opposed by
  the NPC's selected belief, or when it belongs to a contested set whose two
  highest scores are both at least `20`.

Ties use newer occurrence time and then episode ID. The prompt receives the top
`8` authorized episodes, or every authorized episode when fewer than eight
exist.

If embedding is unavailable, `similarity = 0` and only structured anchors are
used. Retrieval failure never broadens disclosure permissions.

## Promises and grievances

- One player may have at most one active promise for the same
  `(NPC, kind, protected claim/item)` tuple. Reaccepting it is denied.
- A `keep_secret` promise breaks the first time the player creates a structured
  transmission of the exact protected normalized claim to any actor other than
  the requesting NPC. An unstructured case-board note is not a transmission and
  does not mechanically resolve the promise.
- A `return_item` promise fulfills when custody moves to the requesting NPC.
- It breaks when custody moves from the player to any other actor. Merely
  leaving town while holding the item leaves it active.
- At `restore_bell_quietly`, active secrecy promises are fulfilled. At
  `expose_cover_up`, an active secrecy promise whose claim enters the public
  resolution is broken.
- At either ending, an active return-item promise fulfills only if the requester
  holds the item; otherwise it breaks.
- Promise relationship deltas use the table above and commit with the promise's
  terminal event.

Broken promises and established lies create permanent MVP grievances. They
affect recall, relationship scores, and the explicit confidential-disclosure
check; no generic model-generated apology can erase them.

## Ambient claim propagation

### Authored NPC trust

The v1 contact/trust matrix is:

| Listener | Speaker they may hear from | Trust |
|---|---|---:|
| Mara | Nessa | `30` |
| Mara | Corin | `40` |
| Nessa | Mara | `20` |
| Corin | Mara | `20` |

The corresponding contact opportunities are bidirectional only for the pairs
listed. There is no direct Nessa–Corin contact.

### Candidate eligibility

An ambient `(speaker, claim, recipient)` candidate exists only when all of the
following are true:

- The town and job are active. The claim is either referenced directly by an
  event in the job's disjoint range, or appears in the speaker's top-eight
  recall set and shares a canonical person, place, item, or motive with an
  ambient-eligible event in that range.
- The speaker has selected the claim as a belief with score at least `20`, or
  the claim is Corin's currently enabled cover story.
- The directed authored contact edge exists.
- The disclosure tier is `public`; or it is `guarded` and the listener's trust
  in the speaker is at least `20`; or it is the enabled cover story. Dynamic
  player-originated claims default to `guarded`.
- `confidential` and `final_truth` claims are never ambient candidates.
- The proposed transmission's `hop_count` is at most `3`.
- The recipient does not already appear in that provenance chain and has not
  already received the same claim from the same independent source.

Eligible candidates receive an integer shortlist priority:

```text
priority =
    50 * triggering_event_match
  + max(0, speaker_belief_score)
  + 20 * recipient_holds_contradictory_belief
  + floor((listener_trust_in_speaker + 100) / 10)
  - 10 * proposed_hop_count
```

Booleans are `0` or `1`. Sort by priority descending, then normalized claim key,
speaker ID, and recipient ID. Haiku receives at most the top `12` candidates
plus `do_nothing`. `triggering_event_match` is `1` only for a direct claim
reference in the event range; structured entity overlap receives no extra 50
points.

### Tick limits

- Haiku may select `0`, `1`, or `2` supplied candidates.
- At most two transmissions may commit.
- One claim may be transmitted at most once per tick.
- One NPC may perform at most one outgoing transmission per tick.
- Selected actions validate in returned order against the pre-tick snapshot
  plus any earlier valid selection from the same tick.
- A missing, duplicated, out-of-list, or newly invalid selection becomes
  `do_nothing`; it is never replaced with a model-invented alternative.
- Tick-created events are outside their own input range and cannot chain until a
  later tick.

The model chooses narrative relevance only inside this numerical and
referential boundary. It cannot alter belief weights, contactability, hop
counts, or the number of actions.

## Case progression and resolution

Let:

```text
required_total      = count(clues where required_for_resolution)
required_discovered = count(those clues with at least one discovery)
bell_revealed        = case_solution.required_item.revealed_event_id is not null
```

The final-confrontation gate is open exactly when:

```text
bell_revealed
AND required_total > 0
AND required_discovered = required_total
```

An accusation is correct only when suspect, motive, and location IDs exactly
match the private solution row. There is no partial credit and no model
judgment. Incorrect attempts have no score penalty. A correct attempt reserves
the ending choice for `10` minutes as defined by the schema and HTTP contracts.

## Worked balance checks

1. A neutral player tells Nessa a claim: `35 + floor(0 / 10) = 35`, so Nessa is
   `leaning`, not convinced.
2. Nessa repeats it to Mara. Mara trusts Nessa at `30`, and the repeat is hop
   `1`: `40 + 3 - 10 = 33`, so Mara also leans toward it.
3. A verified clue contradicts the original rumour: the rumour moves from `35`
   to `-35`; the supported claim receives `+70` and becomes convinced.
4. Two distinct neutral players independently tell the same NPC the same claim:
   `35 + 35 + 15 = 85`, so coordinated corroboration can create a strong false
   belief. Repetition by either player adds `0`.
5. Establishing the first player's lie reverses that player's `+35` testimony
   and applies `trust -30, suspicion +40`; the NPC becomes visibly suspicious
   immediately.
6. Three non-repeated clue presentations, each verifying an earlier assertion,
   produce `trust +45, suspicion -30`, opening a trust-40 gate.
7. Breaking a promise from a neutral relationship produces `trust -40,
   suspicion +35`; the NPC is wary, and the broken-promise check independently
   blocks confidential disclosure.

## Required deterministic tests

- Boundary tests at every score and gate edge: `-20`, `19`, `20`, `39`, `40`,
  `59`, and `60`.
- Clamp tests at `-100` and `100`, including multiple effects from one event.
- Same-player repetition, same-root hearsay, and API replay add no new weight.
- Corroboration follows the active-source formula through source additions,
  reversals, and later threshold recrossings.
- Contradiction mirrors apply once and entailment adds no score.
- One clue overturns one neutral testimony as shown above.
- Relationship trigger deduplication prevents evidence-show grinding.
- Seed graph validation proves every mandatory trust gate is reachable in four
  or fewer positive events before the gated content.
- Recall scoring uses the exact half-life, normalization, flags, limit, and
  tie-breakers above with and without an embedding.
- Ambient shortlisting is stable, never exceeds 12 candidates, never commits
  more than two actions, never exceeds hop three, and never revisits an actor in
  one provenance chain.
- The final-confrontation gate remains closed until the bell and every required
  clue are discovered.

## Schema alignment

The schema contract persists `independent_source_actor_id` and optional
`corroboration_threshold` on `belief_evidence`, with partial uniqueness matching
the repeat-protection rules above. `mirrors_evidence_id` gives derived
contradictions stable source identity. The contract also gives relationship
changes typed clue, item, promise, and root-transmission sources so their
one-time triggers can be protected by partial unique indexes. No new table is
required.

## Related decisions

- [Decision 001: MVP Product Direction](001-mvp-product-direction.md)
- [Decision 002: MVP System Architecture](002-mvp-system-architecture.md)
- [Technical Architecture and Runtime Flows](003-technical-architecture-and-schema.md)
- [Logical Data Model and Schema Contract](005-logical-data-model-and-schema-contract.md)
- [HTTP API Contract](006-http-api-contract.md)
- [MVP Reliability Parameters](007-mvp-reliability-parameters.md)
- [Decision 009: Authored Game Content](009-authored-game-content.md)
- [Decision 010: Bedrock Prompt and Structured-Output Contracts](010-bedrock-prompt-contracts.md)
