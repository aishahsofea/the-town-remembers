# Decision 001: MVP Product Direction

- **Project:** The Town Remembers
- **Status:** Accepted
- **Date:** 2026-07-26
- **Updated:** 2026-08-02
- **Scope:** Player experience, mystery design, memory behavior, and MVP feature boundary

## Decision

Build a small, asynchronous multiplayer social-deduction mystery in which NPC memory materially changes what players can learn, access, and accomplish.

The MVP will use one authored mystery inside isolated invite-link town instances. Players visit the same persistent town at different times. What one player says or does can change NPC beliefs, relationships, dialogue, and cooperation for the next player.

Objective world state remains authoritative. LLMs render dialogue, normalize bounded claims, and choose from tightly constrained ambient behaviors; they do not invent or mutate world truth.

## Player fantasy

The player is a **social detective**. Solving the case requires managing the town's information network, not merely collecting clues.

Players can:

- Ask NPCs questions in natural language.
- Tell truths or deliberate lies.
- Make authored, mechanically verifiable promises.
- Present evidence to challenge beliefs.
- Influence which claims NPCs repeat to one another.
- Gain or lose access and cooperation through trust and suspicion.

The expected visit lasts approximately 10–15 minutes.

## Mystery

The town's festival bell has disappeared.

The objective truth is:

- Lark Venn accidentally damaged the bell.
- Guard Corin Hale secretly moved it to protect Lark.
- Corin hid it in the Old Chapel.
- Innkeeper Mara Venn knows about the accident and the guard's offer to help, but not the bell's location.
- Herbalist Nessa Reed directly observed Corin's cart travelling toward the chapel, but misinterpreted his motive.

The cast is deliberately limited to:

- **Mara Venn:** innkeeper; sociable, protective, and prone to anxious gossip.
- **Corin Hale:** guard; cautious, authoritative, and concealing the complete truth.
- **Nessa Reed:** herbalist; observant, private, and keeper of the chapel key.
- **Lark Venn:** off-screen cause of the accident, not a conversational agent.

The four locations are:

- Festival Square
- The Lantern Inn
- Reed's Garden
- Old Chapel

The guard's post is part of Festival Square rather than a fifth location.

## Multiplayer and progression

- Each mystery runs in an isolated town created through an unguessable invite link.
- Players choose guest display names.
- A persistent, town-scoped browser session identifies a returning player
  within that town. One browser may retain independent identities in several
  towns.
- Reopening the same invite resumes that identity. Losing all town cookies
  loses it; there is no recovery flow.
- There are no accounts, email flows, or OAuth.
- Players may overlap, but there is no real-time presence, avatar movement, typing indicator, or player chat.
- Shared state refreshes after actions or through light polling.
- Unique-item transfers and other conflicting mutations are transactional.

Each town has a shared case board containing:

- Verified physical evidence
- Attributed testimony
- Known hearsay and disclosed sources
- Visible contradictions
- Player-authored notes, clearly marked as unverified
- Contribution history

Testimony is never presented as objective truth merely because an NPC stated it.

## Player actions

The MVP uses a closed action vocabulary.

### World actions

- **Start visit:** Enter Festival Square when the player is currently away.
- **Travel:** Move to an authored location.
- **Inspect:** Examine an authored object or area.
- **Leave town:** End a visit and queue an ambient world tick when the allocated
  event range contains a consequential event.

### NPC actions

- **Ask:** Enter a natural-language question.
- **Tell:** Enter a claim, review its normalized interpretation, and confirm the
  single-use draft before it expires.
- **Show:** Present one discovered authored clue or one physical item currently
  carried by the player to an NPC. A carried item has structured evidence
  effects only when the authored world links it to evidence; otherwise it may
  produce dialogue or no change.
- **Give:** Transfer a unique item.
- **Promise:** Accept a contextual commitment offered by an NPC.

### Case-board actions

- **Add note:** Leave an attributed, unverified message for other players.
- **Accuse:** Complete the culprit, motive, and location theory.
- **Resolve:** Make the one irreversible shared choice after a correct theory.

There is no unrestricted "do anything" action.

## Promise mechanics

Promises are authored and mechanically verifiable.

The MVP includes:

- **Keep a secret:** Repeating the protected normalized claim to another NPC breaks the promise.
- **Return an item:** Returning the chapel key fulfills the promise; an incompatible transfer can break it.

Each promise records its requester, accepter, exact condition, relevant claim or item, status, and resolving event.

Promise status is deterministic. LLM dialogue may express the emotional response but cannot decide whether a promise was fulfilled or broken.

## Memory semantics

The system keeps the following concepts separate:

- **Objective truth:** Authoritative locations, object ownership, clue state, case state, and authored mystery facts.
- **Episodes:** Immutable records of what an NPC personally experienced.
- **Claims:** Bounded normalized propositions communicated by a source.
- **Provenance:** Who told whom, including the chain of transmission.
- **Beliefs:** An NPC's deterministic interpretation of available evidence.
- **Relationships:** Trust and suspicion between an NPC and a player, plus authored NPC-to-NPC trust.
- **Promises and grievances:** Specific consequential records rather than generic dialogue flavor.

Beliefs are calculated from:

- Directness of observation
- Trust in the source
- Number of hearsay hops
- Independent corroboration
- Contradictory evidence
- Relevant broken promises and caught lies

Direct observations and conflicting claims remain stored together. A recent claim does not overwrite an older observation, and a false belief never changes objective truth.

The LLM does not calculate belief confidence.

## Claim grammar

Only claims over canonical entities and supported predicates can affect belief state.

Initial supported forms include:

- `person was_at location`
- `person moved item`
- `person damaged item`
- `item is_at location`
- `person acted_for reason`
- Positive or negative polarity

Natural-language claims are normalized into this grammar and shown to the player for confirmation before persistence.

Unsupported conversation may remain in the episodic transcript, but it cannot change structured beliefs or unlock gameplay gates.

Provenance is stored separately from the proposition. For example, "Mara told me Corin took the bell" stores the proposition about Corin plus Mara as the alleged source.

## Recall and forgetting

Episodic records are permanent and auditable in the MVP.

Retrieval priority, rather than the underlying memory, can fade according to:

- Semantic relevance
- Recency
- Importance
- Involved people, places, objects, and claims
- Unresolved promises and grievances
- Contradiction with a current belief

Direct observations, betrayals, promises, item transfers, and unresolved contradictions remain highly salient.

Beliefs do not decay merely because time passes. Literal forgetting is deferred.

## Mechanical consequences

Memory and relationships must affect gameplay, not just dialogue.

Deterministic gates control:

- Whether an NPC reveals sensitive information
- Whether the guard permits restricted access
- Whether an NPC lends or accepts a unique item
- Whether an NPC cooperates with a confrontation

The player sees qualitative attitudes such as wary, trusting, or suspicious. Exact values remain internal.

NPCs remain at authored locations in the MVP. They do not autonomously move unique objects.

## NPC generation boundary

Before an NPC response is generated, deterministic application code selects:

- Relevant retrievable memories
- Claims the NPC currently believes
- Claims the NPC is permitted to disclose
- Relationship stance
- Result of requested access or item actions

The LLM renders a short in-character response from this approved disclosure bundle.

Structured output identifies the claims and memories expressed. Responses referencing unapproved claims or entities are rejected, with an authored fallback response available.

The guard can lie only through an explicitly permitted cover-story claim. The model does not receive omniscient truth and decide independently to deceive.

## Ambient world tick

A consequential visit queues a tick when the player leaves town.

Each tick:

1. Loads newly committed consequential events.
2. Identifies NPCs with a reason to react.
3. Retrieves a small relevant memory set.
4. Allows a bounded choice between sharing one existing claim with one reachable NPC or doing nothing.
5. Validates the proposed action.
6. Persists the conversation, provenance, and derived belief changes transactionally.

Hard limits:

- At most two ambient actions per tick
- At most one new gossip hop per claim during a tick
- Tick-created events cannot cause another action until a later tick
- No new facts, entities, items, locations, or promises
- Idempotent retries
- Full decision and event trace

An ambient delivery or execution that cannot finish within the bounded
transition deadline completes safely with no effects and remains inspectable.
Continuous scheduled simulation and an admin retry control are not part of the
MVP.

## Interface

The game will use an illustrated storybook-style web interface with:

- A four-location town map
- NPC encounter cards
- Short dialogue
- Action controls
- Inventory
- Active promises
- Qualitative relationship cues
- A shared case board
- A visible "time passes" transition when leaving town

It will not use a command-line/chatbot-only interface or a top-down movement engine.

## Resolution

The final confrontation unlocks after the group has found the bell and verified sufficient supporting evidence.

The submitted theory must identify:

- Corin as the person who moved the bell
- Protecting Lark as the motive
- The Old Chapel as the location

An incorrect theory does not permanently fail the town. It is recorded as an attempted conclusion.

A correct theory leads to one irreversible shared choice:

- **Expose the cover-up:** Make the full truth public, potentially breaking confidentiality promises and preserving grievances.
- **Restore the bell quietly:** Confront Corin privately and preserve Lark's secret.

Both choices solve the mystery. The epilogue summarizes contributions, propagated claims, promises, relationship outcomes, and the difference between objective truth and the final public story.

The first correct accuser owns the choice for ten minutes. If they do not act,
any participating player whose visit began no later than the correct accusation
may finish it, even if currently away. A newcomer who joins after the accusation
may read but cannot take the choice. While the choice is pending, other gameplay
and ambient effects are frozen. The first committed choice wins.
Afterward the town is permanently read-only but remains viewable, including to
new invite holders, until it is retired.

## Inspection and explainability

The player-facing case board reveals only legitimately acquired information and disclosed provenance.

A separate read-only MCP inspection surface will provide complete causal inspection for judges and developers, including:

- NPC beliefs
- Claim provenance
- Recent world events
- Relationship changes
- Object history

The MCP surface cannot mutate game state.

## MVP non-goals

The following are explicitly excluded until the complete vertical slice works:

- A second mystery or procedural cases
- Continuous scheduled simulation
- NPC movement
- Autonomous object manipulation
- Live player presence or player chat
- User accounts
- Voice
- Character animation
- Top-down movement
- Combat
- Economy or currency
- Crafting
- Character progression
- Literal memory deletion
- Secret player roles
- Mobile-first optimization
- Open-world claim predicates
- Custom promises
- Admin world-state editing
- Fully systemic endings

## Rationale

This scope keeps the distinctive promise of the project: one player's social actions persist, propagate, and change another player's experience, while structured state prevents the world from diverging.

It is intentionally smaller than a general living-town simulation. The project has ten days, one developer, a new database platform, multiple required integrations, and a sub-three-minute demonstration. Reliability and explainability take priority over content volume.

## Follow-up decision

The application stack, database design, AWS topology, model roles, security, cost controls, and test strategy are recorded in [Decision 002: MVP System Architecture](002-mvp-system-architecture.md).

The public route, session, projection, action, and error contracts are recorded
in the [HTTP API Contract](006-http-api-contract.md).

The complete mystery canon, seed state, NPC voices, clue graph, access routes,
promise offers, case-board visibility, and endings are recorded in
[Decision 009: Authored Game Content](009-authored-game-content.md).

The screen hierarchy, claim confirmation, pending-action recovery, time-passes
transition, case board, and accessibility behavior are recorded in
[Decision 011: Interface and Interaction Design](011-interface-and-interaction-design.md).
