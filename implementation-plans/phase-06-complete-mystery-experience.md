# Phase 6 — Complete Mystery Experience

- **Project:** The Town Remembers
- **Status:** Draft implementation plan
- **Depends on:** Accepted phase gates through Phase 5
- **Primary contract versions:** `bell-mystery-v1`, `mvp-rules-v1`, HTTP API `v1`

## 1. Objective and user-visible proof

Complete the authored mystery as a coherent, responsive, recoverable, and
accessible experience from invite through a permanently read-only epilogue.
This phase assembles the already-proven persistence, deterministic rules,
player action path, NPC memory loop, and ambient recovery loop into the whole
game. It does not replace those authorities with client-side inference.

The user-visible proof is a browser journey in which players can:

1. enter `bell-mystery-v1`, explore all four locations, and distinguish locked
   from open travel without learning a hidden unlock condition;
2. discover every authored clue and item, build trust, and enter the Old Chapel
   through either Nessa's key or Corin's authorization;
3. use Ask, Tell, Show, Give, and Promise while the UI displays only committed
   results and keeps testimony, hearsay, verified evidence, and notes distinct;
4. reveal the bell, assemble incorrect and correct theories, and observe the
   accepted shared-choice reservation and gameplay freeze;
5. commit either ending once and read a deterministic epilogue with accurate
   contribution, rumour, and promise fragments; and
6. complete the same flow at 320 CSS pixels, by keyboard, and with reduced
   motion, including recovery of a pending action after refresh or network loss.

## 2. Scope

### In scope

- The complete `bell-mystery-v1` content graph: locations, NPC presentation,
  inspectables, clues, items, requested-item routes, promises, caught-lie
  bindings, access routes, confrontation, resolution, and epilogues.
- All player-safe projection fields and deterministic ordering needed by the
  accepted interface contract.
- Complete map, location, encounter, casebook, board, theory, resolution, and
  epilogue screens for desktop and narrow layouts.
- Versioned local scene and portrait assets, plus a neutral unknown-key
  fallback that does not block play.
- Shared board semantics, notes, contradictions, contribution history, theory
  attempts, and resolution state.
- Remaining client action-journal and multiplayer refresh recovery states.
- Accessibility behavior and end-to-end proof owned by this phase.
- Integration coverage for unique-item conflicts and every documented
  no-soft-lock route.

### Explicitly out of scope

- AWS production deployment, IAM, Secrets Manager wiring, budgets, public
  smoke tests, and CockroachDB Managed MCP setup; Phase 7 owns them.
- Broad fault injection, load characterization, submission evidence, and demo
  rehearsal packaging; Phase 8 owns them. Phase 6 still tests failures that are
  part of its player-facing contract.
- A second mystery, procedural content, NPC movement, live presence, player
  chat, a retry/admin dashboard, editable notes, free-position board cards,
  voice, animation, or model-generated epilogues.
- Rebalancing accepted rules or silently changing an existing town's content.

## 3. Prerequisites and accepted contracts

### Required capabilities from earlier phases

- A buildable TypeScript workspace with shared runtime and test contracts.
- Repeatable CockroachDB migrations and `bell-mystery-v1` town creation.
- The deterministic rules engine for evidence, belief, relationships,
  disclosure, access, custody, promises, caught lies, case progression, and
  player-safe projection.
- The complete `/api/v1` join, player-view, action, status, idempotency, and
  error path, including the IndexedDB action journal.
- Grounded NPC dialogue with authored fallbacks and validated promise offers.
- Transactional ambient propagation, transition polling, quarantine, and
  guaranteed re-entry behavior.

Phase 6 begins only when those phase exit gates pass. A missing prerequisite is
fixed in its owning layer; it is not emulated in the UI.

### Accepted sources of truth

- [MVP Product Direction](../docs/001-mvp-product-direction.md): closed action
  vocabulary, multiplayer progression, resolution ownership, and non-goals.
- [Logical Data Model and Schema Contract](../docs/005-logical-data-model-and-schema-contract.md):
  custody, capabilities, clues, board entries, attempts, promise resolution,
  and atomic town resolution.
- [HTTP API Contract](../docs/006-http-api-contract.md): exact player-view and
  completed-action unions, ordering, ETags, denials, and freeze behavior.
- [Deterministic Game Rules](../docs/008-deterministic-game-rules.md): access,
  lie, promise, and confrontation gates under `mvp-rules-v1`.
- [Authored Game Content](../docs/009-authored-game-content.md): all stable
  content keys, clue effects, access routes, copy, fallbacks, solution, and
  both endings under `bell-mystery-v1`.
- [Interface and Interaction Design](../docs/011-interface-and-interaction-design.md):
  routes, layouts, action recovery, board semantics, responsive behavior, and
  accessibility.

If implementation detail exposes a disagreement among these accepted
documents, stop that task and record a contract decision; do not choose one
silently.

## 4. Ordered implementation workstreams

Tasks are ordered by dependency. Workstreams may overlap only after the named
input contracts are stable.

### Workstream A — Freeze and validate the complete authored package

#### P6-01 — Complete the executable content and presentation manifest

**Work**

- Audit the executable `bell-mystery-v1` seed against every stable key, copy
  block, NPC placement, disclosure tier, inspectable, clue effect, item,
  requested-item binding, promise terms version, accusation option, ending
  fragment, and fallback in Decision 009.
- Add the seven accepted presentation keys for four scenes and three portraits
  to a versioned web asset manifest. Keys resolve only to bundled assets, never
  arbitrary URLs.
- Define a neutral local placeholder for an unknown `sceneKey` or
  `portraitKey`. Emit a sanitized client diagnostic containing the key and
  content version, then keep the screen usable.
- Validate that existing towns resolve copy and assets through their frozen
  `contentVersion`; a later build must not reinterpret retained promise offers
  or active promises using newer terms.

**Deliverables**

- Complete versioned content and presentation manifests.
- Seed/content validation suite with reference-resolution and stable-order
  assertions.
- Asset-key fallback component and diagnostic test.

#### P6-02 — Prove authored solvability and fallback coverage

**Work**

- Add a graph-level validator proving that the three required clues and bell
  reveal open the evidence gate without model-selected dialogue.
- Enumerate both independent chapel routes and the non-repeating positive
  relationship events that can reach each trust gate within four events.
- Prove an away key holder, a caught liar, a stale/refused promise offer, a
  dialogue fallback, or an ambient quarantine cannot block the other route or
  shared evidence progression.
- Validate that outcome-specific authored fallback dialogue covers every
  required custody, access, capability, promise, denial, and final-confession
  result and never contradicts committed state.

**Deliverables**

- Executable no-soft-lock/content-graph tests.
- Fallback coverage report generated by tests, with uncovered outcome keys
  treated as failures.

### Workstream B — Complete the player-safe read model

#### P6-03 — Finish mystery projection and deterministic presentation ordering

**Work**

- Populate every accepted `PlayerView` field for map descriptions and assets,
  encounters, inventory, revealed items, clue contributions, active promises,
  board entry unions, contradictions, attempts, accusation options, ambient
  state, choice reservation, and resolved epilogue.
- Apply every HTTP-contract sort before serialization and ETag hashing.
- Keep locked accusation options absent, not redacted; keep locked chapel copy
  exactly `The chapel door is locked.`
- Project only contradiction pairs whose two board entries are visible. Never
  infer truth from a testimony card.
- Ensure resolved and awaiting-choice newcomers receive read-only views and no
  visit or mutation capability.

**Deliverables**

- Exact-schema projection builders and contract fixtures for investigating,
  awaiting-choice, and resolved towns.
- Stable ordering/ETag tests using deliberately shuffled database rows.
- Hidden-state leakage tests for locked access, locked accusation, scores,
  objective truth, and canonical town revision.

### Workstream C — Complete exploration, encounters, and social routes

#### P6-04 — Ship every map, location, inspectable, item, and encounter surface

**Work**

- Implement all four map cards in authored order and all location scenes,
  including NPC placement and every enabled inspectable.
- Render the exact discovery distinctions: `new_to_town`, `new_to_player`,
  `already_discovered_by_player`, and `none`.
- Keep the non-portable bell at the chapel when revealed; show inventory
  treatment only for `player_inventory` custody.
- Complete Show and Give pickers and confirmations so they distinguish
  evidence presentation from custody transfer and never predict a promise
  outcome.
- Preserve the latest encounter exchange for the visit without creating an
  unbounded chat transcript or reconstructing structured state from prose.

**Deliverables**

- Complete map/location/encounter components and route guards.
- Result cards for all inspect, Show, Give, promise, denial, and fallback
  variants.
- Integration tests covering all authored inspectables and custody displays.

#### P6-05 — Integrate both chapel routes, promises, and caught lies

**Work**

- Exercise Nessa's key offer from an immutable saved dialogue descriptor;
  accepting it must atomically create `return-chapel-key-v1` and transfer the
  key. Returning it fulfills the promise; transferring it elsewhere breaks it.
- Exercise Corin's `enter_old_chapel` capability after a required-clue Show
  crosses the post-effect trust/suspicion gate. Later relationship changes must
  not revoke the granted capability.
- Exercise Mara's `keep-lark-accident-secret-v1` offer and exact structured
  claim transmission rules for fulfillment or breach.
- Connect the narrow authored `lie_established` knowledge test. Mere
  contradiction must not label a player a liar or apply its relationship
  penalty.
- Verify same-action relationship effects can cross a gate and that the result,
  state effects, dialogue, and saved response commit against one revision.

**Deliverables**

- Full-route integration fixtures for key, authorization, secret, key-return,
  and caught-lie outcomes.
- UI states for active promises, stale offers, fulfilled/broken consequences,
  suspicious/wary/trusting stances, and locked access.

### Workstream D — Shared board and collaborative reasoning

#### P6-06 — Complete board semantics, notes, contradictions, and contributions

**Work**

- Render verified evidence, testimony, hearsay, and unverified notes with their
  accepted labels, source fields, provenance paths, attribution, and non-color
  distinctions.
- Keep chronological DOM order and preserve filters, scroll, focus, and
  expanded provenance across polling updates.
- Implement visible-only contradiction navigation with accessible text and no
  `true`, `false`, `lie`, or `disproven` inference.
- Implement immutable 1–280-grapheme notes and correction-as-new-note behavior.
  Notes must never satisfy evidence, disclosure, access, or accusation gates.
- Connect `add_note` to the existing authenticated action ledger so note,
  contribution event, saved response, and refreshed board projection commit
  once under the original request identity.
- Show first-finder credit plus ordered later examiners without duplicating the
  shared evidence card.

**Deliverables**

- Responsive board and filter components.
- Board union/component tests and two-player append/update tests.
- Accessible contradiction relationship and provenance controls.

### Workstream E — Theory, irreversible resolution, and epilogue

#### P6-07 — Complete theory assembly and accusation history

**Work**

- Keep theory controls absent while the deterministic gate is closed and show
  the exact generic lock message.
- Once open, render only the authored suspect, motive, and location options in
  frozen-content order and repeat all three selections in confirmation.
- Persist one immutable attempt for every accepted accusation. Incorrect
  attempts remain visible without permanently failing or penalizing the town.
- Connect `accuse` to the existing action ledger and Phase 2 planner; rule
  denials and incorrect theories are saved completed results, not transport
  errors.
- On the first correct tuple, atomically reserve the choice for the accuser for
  ten minutes and route every client to the frozen resolution state.

**Deliverables**

- Theory composer, irreversible-safe confirmation, and attempt cards.
- API/database/browser tests for premature denial, incorrect attempt, correct
  reservation, and simultaneous correct accusations.

#### P6-08 — Complete both endings and permanent read-only behavior

**Work**

- Enforce `canResolve`: owner-only before expiry; afterward any player whose
  visit began no later than the correct accusation; never a later newcomer.
- Make the first conditional resolution win. In one transaction, store the
  choice, move the bell once to Festival Square, append the relocation and
  resolution events, resolve promises and relationship consequences, end
  active visits, and mark the town resolved.
- Connect `resolve` to the same authenticated action and idempotency path; do
  not add a special mutation endpoint or client-only resolution state.
- Render the exact authored base epilogue and escaped contribution fragments in
  stable finder, accuser, resolver, rumour, promise order.
- Count only distinct authored-false claim keys propagated across at least one
  ambient NPC-to-NPC hop before resolution.
- Remove every mutation, Start Visit, and Leave control after resolution while
  retaining read-only Board and Map access for existing and new invite holders.

**Deliverables**

- Resolution domain/application integration and two ending screens.
- Atomicity and concurrency tests proving one ending, one bell relocation, and
  consistent promise/relationship/epilogue state.
- Resolved-town read-only route and action-denial tests.

### Workstream F — Recovery, responsive behavior, and accessibility

#### P6-09 — Close the remaining client recovery state machine

**Work**

- Verify every mutation entry point uses the single town/player IndexedDB
  action journal before its first POST and `BroadcastChannel` coordination
  across tabs.
- Cover processing polling, offline resume, 35-second same-key takeover POST,
  70-second manual same-key retry, retryable `ACTION_CONFLICT`, pre-record
  `429`, live `ACTION_IN_PROGRESS`, terminal new-action errors, and journal
  deletion only after result render plus view refresh.
- Preserve editable input without turning it into an automatic new action.
  Never offer cancellation of a running worker.
- Complete time-passes/away/resolution precedence, including the 90-second safe
  close note and five-minute Start Visit terminalization path without exposing
  queue or model failure.

**Deliverables**

- Recovery adapters, durable action-result surfaces, and deterministic client
  state-machine tests.
- Refresh/offline/two-tab browser tests with duplicate-effect assertions.

#### P6-10 — Finish responsive and accessible interaction behavior

**Work**

- Implement the accepted desktop casebook shell, Map/Satchel drawers below
  1100 pixels, one-column board below 720 pixels, and usable controls at 320
  CSS pixels without horizontal scrolling.
- Apply semantic headings, landmarks, form labels, field errors, DOM order,
  focus movement/restoration, dialog traps, and escape behavior.
- Use polite pending announcements and one assertive terminal-error
  announcement. Throttle countdown announcements to one minute, ten seconds,
  and expiry.
- Pair every stance, evidence kind, hearsay, contradiction, lock, and state
  with non-color meaning. Verify paper/ink contrast at WCAG AA.
- Honor `prefers-reduced-motion` by removing transforms and looping art while
  preserving state labels and comprehension.

**Deliverables**

- Responsive shell and complete focus/live-region behavior.
- Automated accessibility suite plus a documented manual keyboard, zoom,
  contrast, screen-reader, and reduced-motion checklist.

#### P6-11 — Prove the complete mystery end to end

**Work**

- Create deterministic Playwright fixtures that build fresh towns and use
  public behavior rather than direct hidden-state edits for the asserted
  journey.
- Cover both chapel routes, correct and incorrect theories, both endings,
  active promise variants, caught lie versus mere contradiction, simultaneous
  unique-item transfer, and resolution concurrency.
- Cover pending action recovery, two-browser board updates, narrow viewport,
  keyboard-only use, and reduced motion.
- Add a full no-model/fallback journey proving required evidence and authored
  fallbacks keep the mystery solvable.

**Deliverables**

- Tagged complete-mystery E2E suite and retained failure artifacts.
- Traceable coverage table mapping every Phase 6 exit condition to at least one
  automated or documented manual check.

## 5. Artifacts

Phase 6 is expected to produce or complete these artifact classes; exact paths
follow the workspace conventions established in Phase 0:

- versioned content and presentation manifests for `bell-mystery-v1`;
- bundled scene, portrait, and unknown-key placeholder assets;
- exact player-view projection and epilogue builders;
- map, scene, encounter, casebook, board, theory, resolution, and epilogue UI;
- route guards and action-journal/recovery state machines;
- content-graph, fallback-coverage, integration, component, accessibility, and
  Playwright fixtures;
- a Phase 6 contract-to-test traceability matrix.

No Phase 6 artifact may contain an invite token, session or join secret,
cookie, raw model output, exact belief/trust/suspicion score, objective truth in
a player projection, or an arbitrary remote asset URL.

## 6. Dependencies and sequencing

```text
P6-01 -> P6-02
P6-01 -> P6-03 -> P6-04 -> P6-05
P6-03 -> P6-06 -> P6-07 -> P6-08
P6-04 -> P6-09
P6-06 -> P6-10
P6-05 + P6-08 + P6-09 + P6-10 -> P6-11
```

- P6-03 must stabilize projection types and ordering before screen E2E
  snapshots become authoritative.
- P6-07 may be built in parallel with late board styling after P6-06's semantic
  cards and attempt projection are stable.
- P6-09 and P6-10 apply to every mutation and screen; they are not final polish
  passes. Each feature task adds its baseline recovery and accessibility tests,
  while those workstreams perform the complete-system closure.
- Phase 7 can begin environment-independent CDK work after Phase 6 API/build
  artifacts stabilize, but public deployment is not a substitute for P6-11.

## 7. Verification matrix

Commands below are **planned command surfaces** to be provided by the workspace;
they are not a claim that the scripts already exist.

| Concern | Boundary and evidence | Planned command |
|---|---|---|
| Content completeness | Stable keys, references, clue effects, fallback coverage, two solvable routes | `pnpm test:content` |
| Projection safety | Exact union, stable order/ETag, locked-state and hidden-field tests | `pnpm test:contracts` |
| Mystery mechanics | Real CockroachDB integration for custody, capability, promises, lie rules, attempts, and resolution | `pnpm test:integration` |
| UI semantics | Component tests for every result and board union | `pnpm test:web` |
| Accessibility | Automated axe/DOM/focus/reduced-motion checks plus recorded manual checklist | `pnpm test:a11y` |
| Complete browser flow | Fresh-town Playwright journeys for both routes and both endings | `pnpm test:e2e --grep @complete-mystery` |
| Concurrency | Parallel unique-item, correct-accusation, and resolve submissions produce one winner | `pnpm test:integration --grep concurrency` |
| Pending recovery | Refresh, offline, two-tab, 35/70-second, conflict, and rate-limit cases reuse the correct key | `pnpm test:e2e --grep @action-recovery` |
| Responsive use | 320, 719, 720, 1099, and 1100 CSS-pixel assertions; no horizontal overflow | `pnpm test:e2e --grep @responsive` |
| Final phase gate | Build plus the complete Phase 6 suite | `pnpm build && pnpm test && pnpm test:e2e --grep @phase-6` |

The integration suite must use CockroachDB for transaction and concurrency
claims rather than mocks alone. Browser assertions must inspect player-visible
behavior; database inspection may be used as a secondary assertion, never to
bypass the route under test.

## 8. Risks, decisions, and fallback strategy

| Risk or decision | Required response | Safe fallback |
|---|---|---|
| Content manifest and seed drift | Fail build/test on unresolved or duplicate keys and contract copy drift | Do not seed or deploy an incomplete version |
| An illustration key is absent in an older/newer bundle | Record a sanitized client diagnostic keyed by content version | Render the neutral local placeholder and keep controls usable |
| A personal key holder leaves town | Preserve transactional custody; do not teleport or duplicate the key | Another player can earn Corin's persistent authorization |
| A player damages one relationship route | Keep consequences and grievances; do not reset scores | Other players and the independent access route preserve solvability |
| Model selection fails during required progress | Preserve validated state and required outcome-specific grounding | Use the accepted authored fallback; normalization alone returns its terminal retry-new-action error |
| UI receives stale or hidden identifiers | Return uniform `404`, refresh the player view, and close invalid controls | Keep prior committed view readable; never reveal why the ID failed |
| Concurrent item/accusation/resolution writes race | Use conditional updates, town revision, and idempotent saved responses | Loser receives the committed safe outcome with no duplicate effect |
| Resolution copy diverges from stored effects | Generate from stored resolution/contribution facts and versioned authored text | Fail the resolution transaction/test rather than show an inconsistent epilogue |
| Accessibility conflicts with decorative board/map treatment | Keep chronological DOM and explicit text semantics authoritative | Remove decoration or motion, not information or controls |
| E2E journeys become slow or flaky due to model variance | Assert structured outcomes and use the supported fallback/no-model mode where the model is not the subject | Keep a smaller tagged live-model integration case; never loosen grounding assertions |

## 9. Exit checklist

- [ ] Every stable `bell-mystery-v1` content and presentation key validates.
- [ ] All four locations, three NPCs, inspectables, clues, items, and promise
      offers are playable through public UI and API paths.
- [ ] Nessa's key and Corin's authorization independently open the chapel.
- [ ] Required clues and bell reveal open the confrontation without requiring a
      model-authored decision.
- [ ] Board cards preserve evidence/testimony/hearsay/note semantics,
      attribution, provenance, contradictions, and later contribution credit.
- [ ] Notes and incorrect accusations are durable but do not satisfy gates.
- [ ] Correct accusation freezes gameplay and enforces the accepted ten-minute
      resolution reservation.
- [ ] Each ending commits exactly once, relocates the bell exactly once,
      resolves promises consistently, and renders the correct deterministic
      epilogue and contribution fragments.
- [ ] Resolved towns are permanently read-only but viewable until retirement.
- [ ] Unique-item, accusation, and resolution concurrency tests pass on
      CockroachDB.
- [ ] Pending action recovery, ambient transition precedence, and two-tab
      behavior follow the accepted key rules without duplicate effects.
- [ ] Complete journeys pass at a narrow viewport, by keyboard, and with
      reduced motion; automated and manual accessibility checks are recorded.
- [ ] The no-soft-lock matrix covers away key holder, caught liar, promise
      refusal/staleness, model fallback, and ambient quarantine.
- [ ] No player response or persistent client state contains hidden authority,
      secrets, scores, raw model output, or arbitrary asset URLs.

## 10. Handoff to Phase 7

Phase 7 receives:

- a production-buildable web bundle with its versioned asset manifest;
- deployable Game, Ambient, and Recovery entry points whose complete-mystery
  integration suite passes locally;
- migration and seed commands that create a fresh complete town;
- known log/metric event names and stable error codes to wire into alarms;
- the exact inspection views and causal records needed to explain the complete
  browser journeys; and
- the Phase 6 traceability matrix, including any explicitly accepted remaining
  manual accessibility checks.

Phase 7 must preserve the Phase 6 public behavior and content versions while it
adds cloud topology and operations. A production-only discrepancy returns to
the owning application or contract task; cloud infrastructure must not paper
over it.
