# Decision 009: Authored Game Content

- **Project:** The Town Remembers
- **Status:** Accepted
- **Date:** 2026-08-02
- **Content version:** `bell-mystery-v1`
- **Rules version:** `mvp-rules-v1`
- **Scope:** Canon, seed state, authored entities, clue graph, NPC knowledge and voice, access routes, promise offers, ambient behavior, case-board visibility, confrontation, endings, and demo path

## Decision

Ship one complete authored mystery, **The Missing Festival Bell**, using the
content and rules in this document.

The versioned TypeScript seed is the executable source for town creation. It
must use the stable keys, player-safe copy, starting knowledge, clue effects,
and gates defined here. Every town freezes `bell-mystery-v1` in
`towns.content_version`; later copy or balance changes require a new content
version and must not silently alter existing towns.

`bell-mystery-v1` maps to the accepted `mvp-rules-v1` ruleset. That mapping is
part of the content version, so `towns.content_version` identifies both the
authored seed and the rules used by the town. Numerical ledger rows still store
`rule_version = "mvp-rules-v1"` as required by Decision 008.

The product, schema, and HTTP contracts remain authoritative for system
behavior. This document supplies the authored values those contracts require.

## Content principles

- The mystery is solvable from verified evidence and deterministic gates. A
  generated line of dialogue is never the only route to a required fact.
- Social play makes the route shorter and more expressive, but a model failure
  cannot make the town unsolvable.
- Every NPC has a partial perspective. Only Corin begins with the complete
  truth, and his complete explanation is withheld until the evidence gate.
- Evidence establishes what it physically supports. It does not make an NPC
  statement objectively true merely because the statement sounds plausible.
- The player may spread a false claim that changes later dialogue. The false
  belief and its provenance remain inspectable without changing the bell's
  actual location.
- There are two independent routes into the Old Chapel. A key held by an away
  player therefore cannot soft-lock the town.
- Required clue text is short, concrete, and readable in a three-minute demo.
  Optional evidence deepens provenance, trust, and alternate routes.

## Canon

### Objective timeline

The following happened before the first player arrived:

1. Lark Venn, Mara's younger sister and the festival bell-ringer's apprentice,
   stayed behind in Festival Square to tighten a loose clapper pin.
2. Lark used green repair thread to hold the pin while she worked. The pin bent,
   the bell swung against its timber frame, and a fresh crack opened in the
   rim. Nobody was injured.
3. Mara was crossing the square and Corin was leaving the guard post when the
   bell struck the frame. Both saw Lark at the rope and repair pin. Mara took
   her frightened sister inside before the council patrol arrived.
4. Corin inspected the damage and promised Mara he would keep Lark out of the
   public inquiry while he worked out how to repair the bell.
5. Before dawn, Corin used the guard handcart to move the bell from Festival
   Square to the Old Chapel. He covered it with guard oilcloth.
6. Corin told Nessa that he needed the chapel opened for public safety. She let
   him through, later recovered her key, and concluded that he was preventing a
   dangerous festival accident. She did not see what was under the oilcloth.
7. Corin left a note for Mara. Mara tried to burn it after reading it, but a
   legible fragment remained in the inn hearth.
8. At dawn the empty frame was discovered and the festival was suspended. The
   public knows only that the bell is missing.

Corin moved the bell to protect Lark, not to steal it, sell it, or cancel the
festival. Concealment was still a breach of his duty and is the cover-up the
players must resolve.

### Private solution

| Answer field | Stable entity key | Player-facing answer |
|---|---|---|
| Culprit | `corin_hale` | Corin Hale |
| Motive | `protect_lark` | Protecting Lark |
| Location | `old_chapel` | Old Chapel |
| Required item | `festival_bell` | Festival Bell |

The correct accusation is exactly this tuple. The server compares entity IDs
from the frozen town seed; the model never judges correctness.

## Player-facing premise

### Invite preview

- **Mystery title:** `The Missing Festival Bell`
- **Tagline:** `The bell is gone. The town remembers a different story in every mouth.`
- **Spoiler-safe description:** `Visit a shared town, question its residents, trace its rumours, and discover what happened before the festival begins.`

### Opening narration

> Festival banners cross the square, but no music answers them. The timber bell
> frame stands empty, the opening procession is suspended, and three townsfolk
> are already telling three different versions of the night. Find the bell.
> Decide which story the town will remember.

The opening establishes only that the bell is missing, the festival is paused,
and Mara, Corin, and Nessa may know something. It does not expose Lark, the Old
Chapel's relevance, or Corin's involvement.

## Authored entities

### Characters

| Entity key | Display name | Role | Conversational NPC |
|---|---|---|---|
| `mara_venn` | Mara Venn | Innkeeper and Lark's protective older sister | Yes |
| `corin_hale` | Corin Hale | Town guard who moved the bell | Yes |
| `nessa_reed` | Nessa Reed | Herbalist and keeper of the chapel key | Yes |
| `lark_venn` | Lark Venn | Bell-ringer's apprentice who damaged the bell | No |

Lark is a canonical `character` story entity, not an actor and not an NPC. She
remains off-screen throughout the MVP.

### Locations

| Entity key | Display name | Map order | Initial access | Player-safe description |
|---|---|---:|---|---|
| `festival_square` | Festival Square | 0 | Open | `Bright bunting hangs over an empty bell frame and a halted festival.` |
| `lantern_inn` | The Lantern Inn | 1 | Open | `A warm public room where whispers travel faster than trays.` |
| `reeds_garden` | Reed's Garden | 2 | Open | `Orderly herb beds border the narrow lane to the Old Chapel.` |
| `old_chapel` | Old Chapel | 3 | Locked | `A disused stone chapel above the eastern lane.` |

The locked map message is exactly: `The chapel door is locked.` It does not
enumerate the hidden ways to open it.

NPCs remain fixed: Corin is in Festival Square, Mara is in The Lantern Inn, and
Nessa is in Reed's Garden.

### Motive choices

| Entity key | Display name | Meaning |
|---|---|---|
| `protect_lark` | Protecting Lark | Hide her responsibility for the accidental damage |
| `public_safety` | Preventing a public accident | Remove a dangerous bell before the festival |
| `personal_profit` | Selling the bell for personal profit | Take the bell for money |

All three are visible accusation choices after the evidence gate opens. Their
presence is not evidence that any of them is true.

### Items

| Entity key | Display name | Initial custody | Portable | Authored purpose |
|---|---|---|---|---|
| `festival_bell` | Festival Bell | Old Chapel | No | Required hidden object and case solution |
| `old_chapel_key` | Old Chapel Key | Nessa | Yes | Chapel access through a return-item promise |
| `nessas_field_lens` | Nessa's Field Lens | Festival Square, hidden | Yes | Optional requested item that builds trust with Nessa |
| `guard_dispatch_seal` | Guard Dispatch Seal | Reed's Garden, hidden | Yes | Optional requested item that builds trust with Corin |

The bell remains at the Old Chapel when revealed. Discovering it sets
`items.revealed_event_id`; it does not put the heavy bell in player inventory.
The key, lens, and seal use ordinary conditional item transfers.

## Stable claim catalog

The seed creates these claims because they participate in canon, initial
knowledge, authored disclosure, physical evidence, or the repeatable demo.
Players may create other valid claims through the accepted bounded grammar.

| Claim key | Canonical sentence | Context | Objectively true | Initial role |
|---|---|---|---|---|
| `bell_not_at_square` | At dawn, the Festival Bell was not at Festival Square. | `festival_morning` | Yes | Public premise |
| `lark_was_at_square` | Lark Venn was at Festival Square. | `festival_night` | Yes | Discoverable history |
| `corin_was_at_inn` | Corin Hale was at The Lantern Inn. | `festival_night` | Yes | Mara's guarded observation |
| `lark_damaged_bell` | Lark Venn damaged the Festival Bell. | `festival_night` | Yes | Hidden core fact |
| `corin_moved_bell` | Corin Hale moved the Festival Bell. | `festival_night` | Yes | Hidden core fact |
| `corin_was_at_chapel` | Corin Hale was at the Old Chapel. | `festival_night` | Yes | Guarded observation |
| `bell_at_chapel` | The Festival Bell was at the Old Chapel on festival night. | `festival_night` | Yes | Hidden location during the disappearance |
| `corin_protected_lark` | Corin Hale acted to protect Lark Venn. | `festival_night` | Yes | Hidden motive |
| `corin_acted_for_safety` | Corin Hale acted to prevent a public accident. | `festival_night` | No | Corin's cover story and Nessa's initial interpretation |
| `bell_at_reeds_garden` | The Festival Bell was at Reed's Garden on festival night. | `festival_night` | No | Repeatable demo rumour |
| `lark_did_not_damage_bell` | Lark Venn did not damage the Festival Bell. | `festival_night` | No | Explicit opposite for contradiction handling |

Seeded `claim_relations` include:

- `lark_damaged_bell` contradicts `lark_did_not_damage_bell`.
- `corin_protected_lark` contradicts `corin_acted_for_safety` for this authored
  case context. This is a semantic case relation, not a universal rule that a
  person can have only one motive.
- `bell_at_chapel` contradicts `bell_at_reeds_garden`.
- `bell_at_chapel` contradicts positive festival-night location claims for the
  bell at another authored location.
- `bell_not_at_square` contradicts a positive Festival Square claim with the
  same `festival_morning` context.

The objective `world_facts` visibility is exact:

| Visibility | Fact keys |
|---|---|
| `public` | `bell_not_at_square` |
| `discoverable` | `lark_was_at_square`, `corin_was_at_inn`, `lark_damaged_bell`, `corin_moved_bell`, `corin_was_at_chapel`, `bell_at_chapel`, `corin_protected_lark` |
| `hidden` | None; the private answer tuple remains in `case_solutions` |

Discoverable facts become player-visible only through the clues and disclosures
below. The `world_facts` table is never sent wholesale to a model or player.

## Starting NPC state

### Contact and trust graph

Enabled ambient contact and trust edges are exactly the Decision 008 matrix:

| From | To | Trust score |
|---|---|---:|
| Mara | Nessa | 30 |
| Mara | Corin | 40 |
| Nessa | Mara | 20 |
| Corin | Mara | 20 |

Each row is both that directed contact opportunity and the From NPC's trust in
the To NPC. For received NPC testimony, the recipient's directional trust in
the speaker is used. For example, Nessa receiving testimony from Mara uses
Nessa's edge to Mara, with trust 20.

There is no current Nessa–Corin contact edge. Every new player's relationship
with every NPC starts at trust 0 and suspicion 0, as required by the schema and
rules contracts.

### Initial episodes and beliefs

All seed episodes occur before the town's `created_at` by fixed relative
offsets, so town creation remains deterministic while their order is stable.
The accident is `T-12h`, Corin's inn conversation is `T-11h50m`, his safety
story to Nessa is `T-11h30m`, the move and protective decision are `T-11h`, and
the three empty-frame observations are `T-30m`. Ties use stable event and
episode IDs.

| Episode key | NPC | Kind | Importance | Summary and references |
|---|---|---|---:|---|
| `mara_saw_the_accident` | Mara | `direct_observation` | 95 | Mara saw the bell strike its frame while Lark worked at the rope and clapper pin. References Lark, bell, square, and `lark_damaged_bell`. |
| `mara_met_corin_at_inn` | Mara | `direct_observation` | 90 | Mara saw Corin enter The Lantern Inn after the accident. References Corin, inn, and `corin_was_at_inn`. |
| `mara_heard_corins_offer` | Mara | `heard_claim` | 90 | Corin told Mara he would keep Lark out of the public blame. References Corin, Lark, and `corin_protected_lark`. |
| `corin_saw_the_accident` | Corin | `direct_observation` | 95 | Corin saw the bell strike its frame while Lark worked, then inspected the fresh crack. References Lark, bell, square, and `lark_damaged_bell`. |
| `corin_moved_the_bell` | Corin | `direct_observation` | 100 | Corin loaded the bell onto the guard handcart and hid it under oilcloth in the Old Chapel. References Corin, bell, chapel, `corin_moved_bell`, and `bell_at_chapel`. |
| `corin_chose_to_protect_lark` | Corin | `direct_observation` | 100 | Corin decided to conceal the damage until he could protect Lark from public blame. References Corin, Lark, `protect_lark`, and `corin_protected_lark`. |
| `nessa_saw_corins_cart` | Nessa | `direct_observation` | 95 | Nessa saw Corin take the covered guard cart through the chapel gate but could not see its load. References Corin, chapel, and `corin_was_at_chapel`. |
| `nessa_heard_safety_story` | Nessa | `heard_claim` | 80 | Corin said he needed the chapel opened to prevent a public accident. References Corin, `public_safety`, and `corin_acted_for_safety`. |
| `empty_frame_seen` | Mara, Corin, Nessa | `direct_observation` | 90 | Each NPC saw the empty bell frame at dawn. Separate NPC episodes reference the bell, square, and `bell_not_at_square`. |

The two pre-story transmissions are:

- Corin to Mara: `corin_protected_lark`, producing +44 NPC-testimony evidence
  from Mara's trust 40. Mara begins `leaning` toward the true motive.
- Corin to Nessa: `corin_acted_for_safety`, producing +40 NPC-testimony
  evidence from a neutral pre-story trust snapshot of 0. This one-off authored
  conversation predates the game and does not create a current Nessa–Corin
  contact edge. Nessa begins `leaning` toward the false safety explanation.

Direct observations contribute +80. Therefore:

- Mara is `convinced` that Lark damaged the bell, `leaning` that Corin meant to
  protect Lark, and has no initial belief about the bell's location.
- Corin is `convinced` of the damage, his own movement of the bell, its chapel
  location, and his motive.
- Nessa is `convinced` that Corin was at the chapel and `leaning` toward his
  public-safety cover story. She has no initial structured belief that the bell
  was under the cart cover.
- All three are `convinced` that the bell is no longer in Festival Square.

## NPC content

All ordinary NPC responses use one to three short sentences, no more than 80
words, and no Markdown. They address the present player, distinguish observed
facts from testimony, and express only claim and entity IDs in the approved
bundle. Voice instructions may change phrasing but never disclosure tiers,
belief stance, gate results, promise terms, or objective state.

### Mara Venn

- **Core want:** Protect Lark without letting the town tear itself apart.
- **Voice:** Warm, quick, observant, and prone to unfinished thoughts. She uses
  domestic images sparingly and asks personal questions when nervous.
- **Never do:** Sound omniscient, reveal the chapel location, invent a customer,
  or make every line a food metaphor.
- **Public disclosure:** The bell is missing; Lark is resting and not available.
- **Guarded disclosure:** Corin came through the inn before dawn and asked Mara
  to keep Lark inside while he dealt with the bell.
- **Confidential disclosure:** Lark damaged the bell and Corin said he would
  protect her from blame. This may produce the keep-secret offer.
- **Unknown to Mara initially:** Where Corin took the bell and what Nessa saw.
- **Opening greeting:** `If you've come for the festival, I'm sorry. If you've come for the truth, lower your voice and tell me which part you think you have.`

### Corin Hale

- **Core want:** Keep order, protect Lark, and retain control of the inquiry.
- **Voice:** Formal, economical, and precise. He answers the narrowest version
  of a question and rarely uses contractions.
- **Never do:** Threaten violence, confess before the gate, disclose another
  NPC's private memory, or fabricate a new official order.
- **Public disclosure:** The bell is missing and the festival is suspended.
- **Cover story:** He acted to prevent a public accident. He may say the bell
  was secured but may not assert a false location.
- **Final-truth disclosure:** Lark damaged the bell; Corin moved it to the Old
  Chapel; he did so to protect Lark; concealment was his choice.
- **Unknown to Corin initially:** What players have privately told Mara or Nessa
  unless a valid transmission reaches him.
- **Requested item prompt:** `A guard dispatch seal is missing. If you find it, return it to me rather than using it as proof of anything.`
- **Opening greeting:** `The square is closed for the bell inquiry. You may look, and you may ask, but do not turn rumour into evidence.`

### Nessa Reed

- **Core want:** Distinguish observation from interpretation and keep careless
  people out of the chapel.
- **Voice:** Measured, sensory, and exact. She explicitly corrects herself when
  moving from what she saw to what she inferred.
- **Never do:** Claim she saw the bell on the cart, know Corin's true motive,
  or gossip directly with Corin when no contact edge exists.
- **Public disclosure:** She keeps the chapel key; she lost her field lens near
  Festival Square; the chapel remains locked.
- **Guarded disclosure:** She saw Corin's covered handcart pass through the
  chapel gate and later received her key back.
- **Interpretation, not fact:** She leans toward Corin's public-safety story.
- **Unknown to Nessa initially:** What was under the cover and whether Lark
  damaged the bell.
- **Requested item prompt:** `I lost my field lens near the square benches. Bring it back if you find it.`
- **Opening greeting:** `I can tell you what I saw, what I heard, or what I concluded. Those are three different answers.`

### Disclosure tiers

| NPC | Claim | Tier |
|---|---|---|
| Mara | `bell_not_at_square` | `public` |
| Mara | `corin_was_at_inn` | `guarded` |
| Mara | `corin_protected_lark` as an incomplete offer of help | `guarded` |
| Mara | `lark_damaged_bell` | `confidential` |
| Mara | `corin_protected_lark` as Lark's protection motive | `confidential` |
| Nessa | `bell_not_at_square` | `public` |
| Nessa | `corin_was_at_chapel` | `guarded` |
| Nessa | `corin_acted_for_safety` | `guarded` and explicitly framed as interpretation |
| Corin | `bell_not_at_square` | `public` |
| Corin | `corin_acted_for_safety` | `cover_story` |
| Corin | `lark_damaged_bell` | `final_truth` |
| Corin | `corin_moved_bell` | `final_truth` |
| Corin | `bell_at_chapel` | `final_truth` |
| Corin | `corin_protected_lark` | `final_truth` |

The accepted disclosure thresholds apply without content-specific exceptions:
guarded requires trust 20 and suspicion below 40 or a relevant verified clue;
confidential requires trust 40, suspicion below 20, and no broken promise with
that NPC; final truth requires the confrontation evidence gate.

## Inspectables and clues

Each inspectable reveals at most one clue. An inspectable may also reveal one
linked portable item where stated. Stable clue copy is reused in the inspect
result, discovered-clue list, and verified-evidence case-board entry.

| Inspectable key | Location | Display name | Clue key | Required | Player-safe clue copy | Claim effects |
|---|---|---|---|---|---|---|
| `empty_bell_frame` | Festival Square | Empty Bell Frame | `bent_clapper_pin` | Yes | **Bent Clapper Pin** — `A freshly bent pin lies beneath the frame, wrapped in the same green repair thread Lark uses at the inn. Brass scoring shows the bell struck the timber before it was removed.` | Supports `lark_damaged_bell` +70; contradicts `lark_did_not_damage_bell` -70 |
| `guard_cart_tracks` | Festival Square | Cart Tracks by the Guard Post | `guard_cart_ruts` | Yes | **Guard Cart Ruts** — `Twin narrow wheels left the bell frame under a heavy load. Their width matches Corin's handcart, and the freshest turn leads toward the chapel lane.` | Supports `corin_moved_bell` +70, `corin_was_at_chapel` +70, and `bell_at_chapel` +70; the location relation mirrors -70 to `bell_at_reeds_garden` |
| `square_bench_glint` | Festival Square | Glint Beneath the Bench | None | No | Reveals `nessas_field_lens` with description `A brass-rimmed field lens engraved N. Reed.` | None |
| `inn_hearth` | The Lantern Inn | Ash in the Back Hearth | `scorched_guard_note` | Yes | **Scorched Guard Note** — `A fragment in Corin's hand reads: “Keep Lark inside. I will put the bell beyond the search until I can mend what happened.”` | Supports `corin_protected_lark` +70; contradicts `corin_acted_for_safety` -70 |
| `inn_guest_ledger` | The Lantern Inn | Inn Guest Ledger | `larks_late_entry` | No | **Lark's Late Entry** — `Mara's ledger records Lark returning from bell practice minutes before Corin arrived at the inn.` | Supports `lark_was_at_square` +70 |
| `chapel_lane_hedge` | Reed's Garden | Thorn Hedge by the Chapel Lane | `red_seal_on_thorn` | No | **Red Wax on the Thorn** — `A shred of guard-red sealing wax is caught at cart height on the hedge beside the chapel lane.` | Supports `corin_was_at_chapel` +70; also reveals `guard_dispatch_seal` |
| `chapel_threshold` | Old Chapel | Chapel Threshold | `guard_axle_grease` | No | **Guard Axle Grease** — `Fresh black grease at the threshold matches the distinctive resin used on the town guard's handcart.` | Supports `corin_moved_bell` +70 |
| `shrouded_shape` | Old Chapel | Shrouded Shape | `cracked_festival_bell` | No | **The Missing Bell, Found** — `The festival bell rests beneath guard oilcloth inside the chapel. Its rim is freshly cracked and its clapper pin is missing.` | Supports `bell_at_chapel` +70 and contradicts current bell-location claims elsewhere -70; reveals `festival_bell` without transferring it |

The three required clues establish damage, mover, and motive. Revealing the bell
establishes location. No required clue depends on generated dialogue.

Repeated inspection may add a personal `clue_discoveries` row for contribution
credit but never duplicates the shared verified-evidence board entry.

## Relationship effects and social gates

The accepted relationship policy applies with these content-specific bindings:

- Every clue in this document is relevant to all three NPCs unless its table row
  says otherwise. The first relevant presentation of a clue by one player to
  one NPC grants `evidence_presented` exactly once for that triple.
- `nessas_field_lens` is requested only by Nessa. Giving it to her grants
  `requested_item_given` once.
- `guard_dispatch_seal` is requested only by Corin. Giving it to him grants
  `requested_item_given` once.
- If a player has already told an NPC a claim and later presents a clue whose
  effect supports that exact claim, `verified_testimony` applies once for that
  player, NPC, and claim. A repeat Show may apply this reward if the clue was
  seen earlier but the verifying testimony is newly eligible; the ordinary
  evidence-presentation reward still applies only once.
- Ask, unsupported conversation, repeating the same evidence, and giving an
  unrequested item have zero relationship effect.

This produces deliberate but attainable access routes. For example, returning
Nessa's lens grants +15 trust; two truthful claims later verified by physical
clues grant +30 total; the resulting trust 45 is enough for her key offer. The
same route works with Corin's seal. A player may instead use more clue
presentations and corroborations, and multiplayer contributions remain shared.

### Chapel access route A: Nessa's key

Nessa offers the key only when:

- she currently holds `old_chapel_key`;
- the player's trust with Nessa is at least 40;
- suspicion is below 40;
- the bell has not yet been revealed; and
- the player has no active return promise for the key.

An eligible Ask, Show, Tell, or Give response may include this stable offer:

- **Kind:** `return_item`
- **Terms version:** `return-chapel-key-v1`
- **Summary:** `I will lend you the Old Chapel key if you promise to return it to me.`
- **Subject:** `old_chapel_key`

Accepting the offer creates the promise and transfers the key from Nessa to the
player atomically. Giving it back to Nessa fulfills the promise. Giving it to
Mara or Corin breaks the promise. Keeping it until resolution resolves under
the accepted ending rules.

The chapel opens for a player currently holding the key. The key is not
consumed.

### Chapel access route B: Corin's authorization

Corin grants the persistent `enter_old_chapel` capability when a Show action:

- presents any required clue;
- leaves the player's trust with Corin at 40 or above after that action's
  relationship effects;
- leaves suspicion below 20; and
- occurs before the bell is revealed.

The player-safe result remains the ordinary Show result. Corin's authored line
is: `You have enough evidence to search the chapel. I will authorize the door, but I will not tell you what conclusion to draw.`

Once granted, the capability is not revoked in `bell-mystery-v1`. Later
relationship damage changes Corin's dialogue but does not re-lock a door he has
already authorized.

### No soft lock

- Either personal route opens the chapel.
- Required clues are town-wide once discovered.
- The lens and seal accelerate trust but are not required.
- An away player may retain the chapel key, but another player can still earn
  Corin's authorization.
- A player who becomes personally suspicious may lose a route without damaging
  the other players' routes or the shared evidence gate.

## Promise content

### Keep Lark's accident secret

Mara may attach this offer to the first confidential disclosure of
`lark_damaged_bell` when the confidential gate passes:

- **Kind:** `keep_secret`
- **Terms version:** `keep-lark-accident-secret-v1`
- **Summary:** `Promise Mara you will not repeat that Lark damaged the bell.`
- **Subject:** `lark_damaged_bell`

Accepting creates the promise; it does not change objective state. Repeating
the protected normalized claim to Nessa or Corin breaks it. Repeating it to
Mara does not. Player notes are not structured claim transmissions and do not
mechanically break it, but the UI labels them unverified and does not let them
unlock gates.

At resolution, `restore_bell_quietly` fulfills an active version of this
promise. `expose_cover_up` breaks it because Lark's responsibility becomes part
of the public resolution.

### Return the chapel key

The key promise uses the route-A terms above. At resolution it is fulfilled if
Nessa holds the key; otherwise it is broken. A resolved promise never changes
again.

## Caught lies

Contradiction is not automatically deception. A player who repeats the garden
rumour before the bell is found may simply be wrong and receives no automatic
relationship penalty when later evidence disproves it.

`lie_established` applies only when all of these are true:

1. The player confirmed a claim directly to the NPC.
2. A physically verified clue that contradicts the claim was already visible
   to that player at confirmation time.
3. That clue is later presented to, or directly known by, the same NPC.
4. No prior `lie_established` relationship change exists for that player, NPC,
   and claim, even if the player asserted it in another transmission.

This narrow rule makes the knowledge test inspectable and avoids model-based
mind reading. Telling mutually contradictory claims without the physical
knowledge condition produces contradiction, not an automatic caught lie.

## Ambient propagation

### Eligible content

An event may supply ambient candidates when it creates or materially changes a
belief about an existing claim. Travel, ordinary Ask, inspection by itself,
case-board notes, and non-evidentiary item movement are not candidate sources.

Decision 008 alone determines candidate eligibility, numerical priority, stable
ordering, the top-12 shortlist, and the two-action limit. This content adds only
narrative preferences to the Haiku choice prompt:

- **Mara:** Prefer recent unresolved claims and contradictions. For speculative
  location rumours, prefer speaking with Nessa over drawing Corin into gossip.
- **Nessa:** Prefer direct observations and active contradictions over ordinary
  hearsay, and distinguish what she saw from what she inferred.
- **Corin:** Prefer the enabled cover story and public-order concerns. Never
  select Lark's responsibility or the chapel location before the final gate;
  those tiers are already ineligible under Decision 008.

Confidential and final-truth disclosures never propagate through the ambient
loop. Dynamically normalized player claims are treated as ordinary guarded
testimony, not as world facts.

These preferences never add, remove, or reorder the deterministic shortlist
and never override provenance, disclosure, contact, hop, or tick limits. They
guide the model only after the accepted rules have supplied valid choices.

### Repeatable rumour path

The canonical demo rumour is `bell_at_reeds_garden`:

1. Player A tells Mara, `The bell was hidden in Reed's Garden last night.`
2. With starting player trust 0, Mara records +35 player-testimony evidence and
   becomes `leaning` toward the false claim.
3. Player A leaves. Mara-to-Nessa and Mara-to-Corin are scored by Decision 008;
   Mara's authored preference favors Nessa for this speculative location
   rumour.
4. The selected recipient becomes the demo target. Nessa is the expected
   narrative path; Corin is a valid live fallback. Both have trust 20 in Mara,
   so the hop-1 testimony contributes `40 + 2 - 10 = 32`.
5. Player B visits that recipient and hears materially changed dialogue while
   the item row still places the bell in the Old Chapel.
6. Showing `guard_cart_ruts` to the same recipient applies +70 to
   `bell_at_chapel`; the authored location contradiction mirrors -70 to the
   garden claim, exposing the belief change and provenance in inspection.

## Case-board visibility

- The board starts empty. The missing-bell premise appears in town chrome, not
  as a player-contributed entry.
- The first clue discovery creates one shared `verified_evidence` entry using
  the exact clue title and description in this document.
- Public, guarded, and cover-story claims spoken to a player may create
  attributed testimony or hearsay entries with their real provenance.
- A confidential Mara disclosure does not automatically create a shared board
  entry. It remains in the saved action response and, if accepted, the active
  promise subject. A later valid transmission may expose it through normal
  provenance and promise consequences.
- Player-to-NPC assertions never automatically appear on the shared board.
- Contradiction badges appear only when both claims are already visible on the
  board and a seeded or deterministic `claim_relations` row connects them.
- Notes remain attributed and unverified. A note cannot satisfy a clue,
  disclosure, access, or accusation gate.
- Objective labels such as `true` or `false`, exact belief scores, and private
  NPC reasoning never appear before resolution.

## Progression and confrontation

### Intended three-act path

1. **The empty frame:** Explore the three open locations, hear partial stories,
   discover the required clues, and decide which claims to repeat or challenge.
2. **The locked chapel:** Build trust through evidence, verified testimony, and
   optional requested items; obtain Nessa's key or Corin's authorization.
3. **The covered bell:** Enter the chapel, reveal the bell, unlock Corin's final
   disclosure, submit the theory, and choose what the town will remember.

The target first-visit duration is 10–15 minutes. Shared evidence allows later
players to enter at act two or three without replaying every inspection.

### Evidence gate

The confrontation gate opens when:

- `festival_bell.revealed_event_id` is non-null; and
- `bent_clapper_pin`, `guard_cart_ruts`, and `scorched_guard_note` each have at
  least one discovery in the town.

The locked message is exactly:
`The town needs stronger verified evidence before it will confront anyone.`

The message never names the missing clue or location. When the gate opens,
Corin's `final_truth` bundle becomes eligible, the suspect, motive, and location
selectors become available, and Accuse accepts submissions. Suspect choices are
Mara, Corin, Nessa, and Lark; motive choices are the three motives above; and
location choices are the four map locations. Selector presence is not evidence.
The open `accusationGate` projection returns those options in exactly those
orders; the locked projection returns none of their IDs or labels.

### Final confrontation

When asked after the gate, Corin's authored fallback confession is:

> Lark damaged the bell by accident. I moved it to the Old Chapel before the
> council could see it, because I meant to protect her. I told myself I was
> preserving order. I was hiding the truth.

The generated version may vary in voice but must express only the four approved
final-truth claims and must not change the solution.

An incorrect theory remains visible in contribution history and does not close
the town. The correct tuple opens the accepted ten-minute resolution
reservation and freezes gameplay.

## Endings

Post-resolution content may reveal the complete objective timeline. The
epilogue is deterministic authored text with named contribution fragments; it
is not model-generated.

### Expose the cover-up

- **Choice label:** `Expose the cover-up`
- **Base epilogue:**

> At sunrise, the bell is carried back into Festival Square and the whole story
> is read aloud: Lark damaged it, Corin hid it in the Old Chapel, and he did so
> to protect her. The festival continues with a cracked bell and no convenient
> lie. Lark keeps her place only after admitting what happened; Corin surrenders
> the inquiry to the council. The town remembers the truth, and also who made
> it public.

- Active keep-secret promises about Lark are broken.
- The key promise resolves from current custody.
- The final public story equals the objective solution.

### Restore the bell quietly

- **Choice label:** `Restore the bell quietly`
- **Base epilogue:**

> Before sunrise, a few careful hands return the bell to Festival Square. Corin
> admits the concealment in private, Lark helps repair the cracked rim, and the
> public announcement says only that damaged fittings delayed the festival.
> The players know where the bell was and why it vanished, but choose not to
> turn Lark's accident into the town's lasting story. The bell rings imperfectly
> at dusk.

- Active keep-secret promises about Lark are fulfilled.
- The key promise resolves from current custody.
- The public story omits Lark's responsibility while the inspection surface
  retains the full objective and causal record.

### Contribution fragments

The epilogue appends applicable fragments in this stable order:

1. **Finder:** `{player} found the bell beneath the chapel oilcloth.`
2. **Accuser:** `{player} assembled the correct accusation.`
3. **Resolver:** `{player} chose how the town would remember it.`
4. **Rumour, singular:** `Before the truth settled, 1 false claim crossed at least one NPC-to-NPC hop.`
5. **Rumour, plural:** `Before the truth settled, {count} false claims crossed at least one NPC-to-NPC hop.`
6. **Promises:** `Promises kept: {fulfilled}. Promises broken: {broken}.`

If one player owns several contributions, their name may repeat; the history is
an audit, not an awards ranking. Zero-count rumour and promise fragments are
omitted. Display names are inserted as escaped plain text.

## Authored fallback dialogue

These lines are safe terminal fallbacks. They contain no hidden structured
claim and may be selected by NPC and interaction kind when generation or repair
cannot finish.

| NPC | Ask | Tell | Show | Give or promise |
|---|---|---|---|---|
| Mara | `There is too much frightened talk already. Ask me about one thing at a time, and I will tell you what I can.` | `I heard you. I am not ready to say what I make of it.` | `I can see why you brought that to me. Give me a moment before I answer.` | `Keep hold of that for now. A promise or a possession should go to the right hands.` |
| Corin | `State the question plainly. I will answer what the inquiry permits.` | `Your statement is heard. It is not yet proof.` | `I acknowledge the evidence. Do not mistake that for a conclusion.` | `Retain it until its owner and terms are clear.` |
| Nessa | `I will not guess. Ask for what I saw, what I heard, or what I concluded.` | `I have heard the claim. Hearing is not the same as knowing.` | `That is evidence. I will weigh it against what I observed.` | `I will take it only if it belongs with me and the terms are exact.` |

Authored gameplay denials use these stable lines where applicable:

| Situation | Player-safe line |
|---|---|
| Nessa will not lend the key | `I do not lend the chapel key on urgency alone.` |
| Corin will not authorize the chapel | `You have not shown me enough to justify opening a sealed place.` |
| Mara withholds confidential truth | `Some matters are not mine to scatter through the town.` |
| Item refused | `That item should remain with its present keeper.` |
| Promise offer became stale | `The circumstances have changed; I cannot ask that promise of you now.` |
| Town frozen for resolution | `The evidence is assembled. Nothing more changes until the town chooses.` |

Fallback selection still respects the current NPC, action, gate result, and
visibility bundle. A fallback line never substitutes for claim normalization;
normalization uses the accepted terminal dependency error.

## Demo script

The primary judge path is:

1. Player A joins and travels to The Lantern Inn.
2. Player A tells Mara, `The bell was hidden in Reed's Garden last night`, confirms the normalized
   `bell_at_reeds_garden` claim, and receives a response that records Mara's
   leaning belief.
3. Player A leaves, producing one ambient transition. Mara's new claim enters
   the deterministic shortlist, and her authored prompt preference favors
   Nessa. If Haiku selects Corin instead, the demo follows Corin.
4. The selected Mara-to-recipient transmission is shown in inspection with its
   root player transmission, hop count, trust snapshot, and +32 evidence.
5. Player B visits the selected recipient and hears dialogue changed by Mara's
   report. Nessa distinguishes report from observation; Corin treats the
   conflict as an unproven claim while retaining his authored cover behavior.
6. Player B inspects the Cart Tracks by the Guard Post and shows
   `guard_cart_ruts` to the selected recipient.
7. The recipient's garden belief receives -70 contradiction evidence while
   `bell_at_chapel` receives +70 support.
8. The Managed MCP views show the unchanged bell item location, both beliefs,
   the exact provenance chain, and the model/validation records.

The demo uses an otherwise fresh `bell-mystery-v1` town. It must not pre-create
the player actions, clue discovery, ambient transmission, contradiction, or
inspection records being demonstrated live.

## Content verification

The seed and rule tests must prove:

1. Stable keys are unique and every content reference resolves within
   `bell-mystery-v1`.
2. The case solution matches Corin, protecting Lark, the Old Chapel, and the
   Festival Bell.
3. Mara's starting context contains no chapel location; Nessa's contains no
   knowledge of the cart's load; Corin alone has the complete truth.
4. The three required clues and bell reveal are sufficient for the evidence
   gate and no generated dialogue is required.
5. Each clue effect targets a seeded claim or a valid deterministic
   current-location contradiction.
6. Nessa's key and Corin's authorization independently permit chapel entry.
7. An away key holder, caught liar, refused promise, failed model call, or
   quarantined ambient tick cannot make the town unsolvable.
8. Confidential Mara testimony does not enter the shared board automatically.
9. The garden rumour changes a belief without changing the bell item row, and
   later cart evidence reverses it through append-only evidence.
10. Every fallback line validates without hidden claims or unapproved entity
    references.
11. Both endings resolve active promises and produce deterministic escaped
    epilogues.
12. A fresh-town playthrough and the two-browser demo both complete within the
    agreed scope and action limits.

## Deferred content

`bell-mystery-v1` does not include:

- a conversational Lark;
- a fifth location or explorable guard storehouse;
- randomized clue placement;
- alternate culprits or procedural motives;
- NPC schedules or movement;
- additional promise kinds;
- model-generated clue descriptions, fallback lines, or epilogues; or
- a failure ending that permanently locks the town.

Those additions require a later product decision and a new content version.

## Related decisions

- [Decision 001: MVP Product Direction](001-mvp-product-direction.md)
- [Decision 002: MVP System Architecture](002-mvp-system-architecture.md)
- [Technical Architecture and Runtime Flows](003-technical-architecture-and-schema.md)
- [Logical Data Model and Schema Contract](005-logical-data-model-and-schema-contract.md)
- [HTTP API Contract](006-http-api-contract.md)
- [MVP Reliability Parameters](007-mvp-reliability-parameters.md)
- [Decision 008: Deterministic Game Rules](008-deterministic-game-rules.md)
