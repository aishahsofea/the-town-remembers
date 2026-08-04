# HTTP API Contract

- **Project:** The Town Remembers
- **Status:** Accepted API design; implementation pending
- **Date:** 2026-08-02
- **Scope:** Public HTTP routes, authentication, player-safe projections, action
  contracts, idempotency, rate limits, failures, and visit transitions

This document is the implementation contract for the MVP HTTP API. The
[runtime architecture](003-technical-architecture-and-schema.md) owns model and
queue behavior, the
[Bedrock prompt contract](010-bedrock-prompt-contracts.md) owns prompt inputs,
structured outputs, validation, and repair, while the
[logical schema contract](005-logical-data-model-and-schema-contract.md) owns
database identities and invariants. If a transport detail and a database detail
appear to conflict, they must be reconciled in both documents before either is
implemented.

## API principles

- The public base path is `/api/v1`. The version participates in every request
  fingerprint; a breaking contract change requires a new version.
- The browser receives explicit player-safe projections, never raw rows or a
  general objective-truth endpoint.
- Authenticated commands use one typed action endpoint and one idempotency
  implementation.
- Gameplay denials are successful completed actions. HTTP errors describe
  malformed, unauthenticated, unavailable, conflicting, rate-limited, or failed
  requests.
- Model-backed responses are complete and validated before players see them.
  Responses are not streamed.
- Canonical town revisions remain internal. Player responses use an opaque
  player-view version so hidden state changes cannot leak.

## Route surface

| Method | Route | Authentication | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/health` | None | API liveness only |
| `POST` | `/api/v1/towns` | Judge code | Create one town idempotently |
| `GET` | `/api/v1/invites/{inviteToken}` | Invite token | Resolve a minimal invite preview |
| `POST` | `/api/v1/invites/{inviteToken}/join` | Invite token + join-attempt secret | Create one guest identity idempotently |
| `GET` | `/api/v1/towns/{townId}/player-view` | Town player cookie | Return the aggregated player-safe view |
| `POST` | `/api/v1/towns/{townId}/actions` | Town player cookie | Execute one typed player action |
| `GET` | `/api/v1/towns/{townId}/actions/{actionId}` | Same player cookie | Read processing or saved action status |

There are no player HTTP routes for raw beliefs, scores, provenance tables,
prompts, ambient execution, queue recovery, or objective truth. Judges and
developers inspect those through the separately authenticated read-only MCP
surface.

## Common transport rules

- Requests and responses use UTF-8 JSON except `304 Not Modified`, which has no
  body.
- Every response carries an opaque `X-Request-Id`. The same value appears in
  safe application logs.
- Every state-changing or model-consuming `POST` requires an
  `Idempotency-Key` header containing a UUID. `GET` requests do not.
- Every `POST` requires `Content-Type: application/json` and an exact matching
  application `Origin`. Town creation authenticates with the judge bearer code;
  first-time join authenticates with the invite and join-attempt secret; only
  player-authenticated mutations require the town-scoped cookie described
  below.
- CORS is not enabled for arbitrary origins. The React application and API are
  delivered through the same CloudFront origin.
- Identifiers are opaque strings. Clients must not infer database type or game
  meaning from their format.
- CloudFront caching is disabled for `/api/*`. Authenticated responses use
  `Cache-Control: private, no-cache` and `Vary: Cookie`; mutation and action
  status responses additionally use `no-store`. Invite preview, town creation,
  and join responses use `Cache-Control: no-store` so capability URLs and
  personalized data never enter shared caches.
- Every HTML and API response sends `Referrer-Policy: no-referrer`. The invite
  page loads no third-party scripts, pixels, fonts, or analytics. At bootstrap
  it copies the route token into the current page's ephemeral memory and
  immediately calls `history.replaceState` with tokenless `/join`, before
  issuing invite-preview or authentication requests. The application never
  writes the token to persistent browser storage. Refresh before completion
  loses the capability and requires reopening the invite URL.
- CloudFront standard and real-time access logs and S3 server-access logs are
  disabled for the MVP because their URI fields cannot safely redact invite
  tokens. API Gateway access logs contain only request ID, route template,
  status, and integration latency—not raw path, query, headers, or body. Lambda
  logging likewise never records the request event, raw URL, invite token,
  authorization headers, cookies, or join secret. Aggregate service metrics
  remain enabled.

## Town creation

`POST /api/v1/towns` receives the shared judge code as
`Authorization: Bearer <judge-code>`. The code never appears in a URL, request
body, response, or log. Because the MVP has one server-selected authored
mystery, the request body is exactly `{}`; clients cannot select a content
version.

The browser creates one town-creation UUID and reuses it until the request
reaches a terminal response. The server stores a `town_creation_requests`
record whose fingerprint covers the API version, operation kind, and canonical
empty body. The first record also freezes the server-selected content version
and security-key version, so a deployment or key rotation cannot change a
retried creation. Every replay must present both the same key and a valid judge
code.

The invite token is derived as a versioned HMAC of the creation key using the
application security secret. This produces the same unguessable invite on a
retry without storing its plaintext. The request records which secret version
was used so a later replay can use the same derivation after key rotation.
Every referenced historical derivation-key version remains retrievable while
any retained creation-request record uses it. A completed request that created
a town remains retained through that town's lifetime.

A successful `201 Created` response returns:

```json
{
  "townId": "town_123",
  "status": "active",
  "inviteUrl": "https://example.test/join/opaque-token"
}
```

Creating a town does not create a player. The creator joins through the normal
invite flow.

The stored terminal response contains only town ID and status. It explicitly
excludes `inviteUrl` and the invite token; every first response and replay
reconstructs that field from the creation key and recorded secret version.

## Invite resolution and joining

### Invite preview

`GET /api/v1/invites/{inviteToken}` returns only:

```json
{
  "townId": "town_123",
  "mysteryTitle": "The Missing Festival Bell",
  "tagline": "The bell is gone. The town remembers a different story in every mouth.",
  "description": "Visit a shared town, question its residents, trace its rumours, and discover what happened before the festival begins.",
  "townStatus": "active",
  "joinMode": "play"
}
```

`joinMode` is:

- `play` for an active town;
- `read_only` while the town awaits its final choice or is resolved; or
- `closed` for a retired town.

An eligible returning participant learns whether they may call `resolve` from
their authenticated `player-view`; the public preview never promises that a
new invite holder can take the final choice.

The preview exposes no player names, evidence, contribution count, case
progress, or hidden state. Invite links may create or resume access until
retirement; afterward preview returns `closed`, but join and player routes
return `410`.

### Existing browser identity

Each town uses an independent cookie named from the opaque town ID and scoped
to `/api/v1/towns/{townId}`. After resolving an invite, the browser requests
that town's `player-view`. A valid cookie resumes the existing player without a
display-name prompt or new player record.

A browser may hold cookies for several towns. There is no global account
session.

### First-time join

The first-time join body is exactly `{ "displayName": "..." }` and contains a
fixed display name. The request also carries two independent random values:

- `Idempotency-Key`, which identifies the join request; and
- `Join-Attempt-Secret`, a 256-bit base64url value kept only in the tab's
  `sessionStorage` during the attempt.

The join secret is excluded from logs and stored only as a hash. It is required
because an ordinary idempotency key must not become an identity-recovery
credential.

One `join_requests` record maps retries to the same player. Until the earlier of
ten minutes after completion or bootstrap confirmation, a replay with the same
request and join secret may mint a new valid session cookie for that player.
The first successful authenticated `player-view` (`200` or `304`) conditionally
sets `bootstrap_confirmed_at` and destroys the stored join-secret hash; later
replays return `410 JOIN_REPLAY_CLOSED`. An
unconfirmed request whose time window elapsed returns
`410 JOIN_REPLAY_EXPIRED`. Neither response can mint a cookie. The browser
deletes the attempt secret after it receives that authenticated view. This
window recovers only a lost initial transport response; it is not available
after identity bootstrap succeeds.

The existing once-per-minute Recovery invocation conditionally closes every
unconfirmed join whose `replay_expires_at` has passed and clears its secret
hash. The request-time expiry check remains authoritative: a replay arriving
before that sweep performs the same closure and returns `410`. This cleanup
never authenticates a player or issues a session.

At most three session cookies may be issued from one join request, including
the initial response. A fourth attempt returns `410 JOIN_REPLAY_EXHAUSTED` and
closes the replay path. Every successful initial response or replay returns the
same `201` JSON body; only the cookie token may differ:

```ts
type JoinResponse = {
  townId: Id;
  townStatus: "active" | "awaiting_resolution" | "resolved";
  player: { id: Id; displayName: string };
  initialVisit: null | { visitId: Id; locationId: Id };
};
```

Losing all town cookies means losing that identity. There is no recovery flow;
the visitor may join as a new guest with a different available name.

Every join atomically creates the player, zeroed NPC relationships, and session.
An active-town join additionally creates the first Festival Square visit and
an internally completed `start_visit` action. A join while
`awaiting_resolution` or `resolved` does not create a visit.

The response sets a `Secure`, `HttpOnly`, `SameSite=Lax` cookie with a one-year
browser `Max-Age`. The corresponding server session has no inactivity expiry:
an `active` session remains valid until explicitly revoked or the town is
retired. On the first authenticated response after at least thirty days since
the prior issuance, including a resolved-town view, the server reissues the
cookie. A conditional update of `last_cookie_issued_at` elects one concurrent
response to emit `Set-Cookie`. That monthly write updates issuance metadata
only; it does not extend a server-side expiry. A browser that loses the cookie,
including after a year without returning, still has no recovery flow. Only
session-token hashes are stored. A retried join may create at most three
simultaneously valid session rows for the same player.

### Display names

- Names are fixed for the identity's lifetime.
- Normalize with Unicode NFKC, trim and collapse whitespace, then apply full
  Unicode case folding for uniqueness.
- The displayed form preserves the player's accepted casing.
- Length is 2 through 24 grapheme clusters after normalization.
- Letters, numbers, spaces, apostrophes, and hyphens are allowed. Markup and
  control characters are rejected.
- Normalized names are unique across all player and NPC actors in one town, so
  a player cannot impersonate an authored NPC.

## Player-safe view

`GET /api/v1/towns/{townId}/player-view` is the sole gameplay read model. It
contains the data needed to render the map, current visit, available
encounters, inventory, active promises, case board, resolution state, and any
player-visible ambient transition.

The complete version-one response schema is below. `Id` values are opaque
strings. `IsoTime` is UTC RFC 3339 with exactly three fractional digits. An
optional property is omitted rather than serialized as `null`; only properties
explicitly typed with `null` use JSON null.

```ts
type Id = string;
type IsoTime = string;
type PublicActor = {
  id: Id;
  actorType: "player" | "npc";
  displayName: string;
};

type LocationView = {
  id: Id;
  displayName: string;
  description: string;
  sceneKey: string;
  mapOrder: number;
  access:
    | { state: "open" }
    | { state: "locked"; message: string };
};

type InspectableView = {
  id: Id;
  displayName: string;
  inspectionState: "available" | "already_inspected";
};

type EncounterView = {
  npc: PublicActor & { actorType: "npc" };
  roleLabel: string;
  portraitKey: string;
  openingLine: string;
  stance: "suspicious" | "trusting" | "wary" | "neutral";
  availableActionKinds: Array<
    "ask" | "normalize_claim" | "tell" | "show" | "give" |
    "accept_promise"
  >;
};

type InventoryItemView = {
  itemId: Id;
  displayName: string;
  description: string;
};

type RevealedItemView = {
  itemId: Id;
  displayName: string;
  description: string;
  custody:
    | { kind: "player_inventory" }
    | { kind: "location"; locationId: Id };
};

type DiscoveredClueView = {
  clueId: Id;
  title: string;
  description: string;
  firstContributor: PublicActor & { actorType: "player" };
  contributors: Array<PublicActor & { actorType: "player" }>;
};

type PromiseSubjectView =
  | { kind: "claim"; claimId: Id; text: string }
  | { kind: "item"; itemId: Id; displayName: string };

type ActivePromiseView = {
  promiseId: Id;
  npc: PublicActor & { actorType: "npc" };
  kind: "keep_secret" | "return_item";
  summary: string;
  subject: PromiseSubjectView;
  acceptedAt: IsoTime;
};

type CaseBoardEntryView =
  | {
      entryId: Id;
      entryKind: "verified_evidence";
      verificationStatus: "verified_physical";
      contributedBy: PublicActor & { actorType: "player" };
      createdAt: IsoTime;
      clue: { clueId: Id; title: string; description: string };
    }
  | {
      entryId: Id;
      entryKind: "testimony";
      verificationStatus: "attributed_testimony";
      contributedBy: PublicActor & { actorType: "player" };
      createdAt: IsoTime;
      claim: { claimId: Id; text: string };
      speaker: PublicActor;
      allegedSource?: PublicActor;
      provenancePath: PublicActor[];
    }
  | {
      entryId: Id;
      entryKind: "hearsay";
      verificationStatus: "attributed_hearsay";
      contributedBy: PublicActor & { actorType: "player" };
      createdAt: IsoTime;
      claim: { claimId: Id; text: string };
      speaker: PublicActor;
      allegedSource?: PublicActor;
      provenancePath: PublicActor[];
    }
  | {
      entryId: Id;
      entryKind: "note";
      verificationStatus: "unverified_player_note";
      contributedBy: PublicActor & { actorType: "player" };
      createdAt: IsoTime;
      text: string;
    };

type CaseBoardContradictionView = {
  firstEntryId: Id;
  secondEntryId: Id;
};

type CaseAttemptView = {
  attemptId: Id;
  contributedBy: PublicActor & { actorType: "player" };
  suspect: { id: Id; displayName: string };
  motive: { id: Id; displayName: string };
  location: { id: Id; displayName: string };
  outcome: "incorrect" | "correct";
  createdAt: IsoTime;
};

type AccusationOptionView = {
  id: Id;
  displayName: string;
};

type ResolutionView =
  | {
      state: "investigating";
      accusationGate:
        | {
            state: "open";
            options: {
              suspects: AccusationOptionView[];
              motives: AccusationOptionView[];
              locations: AccusationOptionView[];
            };
          }
        | { state: "locked"; message: string };
    }
  | {
      state: "awaiting_choice";
      owner: PublicActor & { actorType: "player" };
      reservationExpiresAt: IsoTime;
      canResolve: boolean;
      choices: Array<{
        value: "expose_cover_up" | "restore_bell_quietly";
        label: string;
      }>;
    }
  | {
      state: "resolved";
      choice: "expose_cover_up" | "restore_bell_quietly";
      chosenBy: PublicActor & { actorType: "player" };
      resolvedAt: IsoTime;
      epilogue: string;
    };

type PlayerView = {
  viewVersion: string;
  town: {
    id: Id;
    mysteryTitle: string;
    contentVersion: string;
    tagline: string;
    status: "active" | "awaiting_resolution" | "resolved";
  };
  player: {
    id: Id;
    displayName: string;
    visit:
      | { status: "away" }
      | { status: "active" | "frozen"; visitId: Id; locationId: Id };
  };
  map: LocationView[];
  currentLocation: null | {
    id: Id;
    displayName: string;
    inspectables: InspectableView[];
  };
  encounters: EncounterView[];
  inventory: InventoryItemView[];
  discoveredClues: DiscoveredClueView[];
  activePromises: ActivePromiseView[];
  caseBoard: CaseBoardEntryView[];
  caseBoardContradictions: CaseBoardContradictionView[];
  caseAttempts: CaseAttemptView[];
  resolution: ResolutionView;
  ambientTransition: null | {
    status: "waiting" | "processing" | "complete";
    canStartVisit: boolean;
  };
};
```

The projection contains player-safe display strings and presentation keys
resolved from the town's frozen content version. `sceneKey` and `portraitKey`
are opaque lookups into that version's bundled illustration manifest, never
arbitrary URLs. Locked-access and accusation messages are generic and never
enumerate hidden missing evidence. A locked accusation gate contains no
candidate IDs or labels. An open gate contains only the frozen content
version's authored suspect, motive, and location options. `currentLocation` is null while away;
`encounters` contains only enabled NPCs at the current location.
`discoveredClues` contains the town-wide verified clues this player may submit
through `show`. `contributors` includes each player with a discovery row exactly
once in discovery-event order, then player ID; its first element equals
`firstContributor`. The board card retains the first discoverer's primary
credit while its contribution detail can name later discoverers. The board and
attempt history are shared contributions, subject to their spoiler-safe
projections. A contradiction pair is returned only when both referenced claim
entries are visible on this board. Each pair puts the lexically smaller entry
ID first; it means that the accounts conflict, never that either is objectively
false.

Resolution `canResolve` applies the owner/expiry/prior-participant rule in this
contract and does not require a currently active visit. For an ambient transition,
`canStartVisit` is false for `waiting` and `processing` and true for `complete`;
when the transition is null, an away player may start only while the town is
`active`.

Projection builders apply these stable orders before hashing or returning JSON:

- `map`: `(mapOrder, id)`;
- `inspectables`, `encounters`, `inventory`, and `discoveredClues`: normalized
  display name, then ID;
- each discovered clue's `contributors`: discovery-event sequence, then player
  ID;
- `availableActionKinds`: the enum order shown in its type;
- `activePromises`: `(acceptedAt, promiseId)`;
- `caseBoard`: `(createdAt, entryId)`;
- each `caseBoardContradictions` pair: lexical entry ID, with the array ordered
  by `(firstEntryId, secondEntryId)`;
- `caseAttempts`: `(createdAt, attemptId)`;
- open accusation `suspects`, `motives`, and `locations`: the frozen authored
  order for their content version, then ID as a defensive tie-breaker;
- each `provenancePath`: root speaker to final recipient by following
  `parent_transmission_id` and reversing the chain; and
- resolution `choices`: `expose_cover_up`, then `restore_bell_quietly`.

The `ETag` header contains the quoted `viewVersion`. Compute both as:

```text
base64url(SHA-256("player-view:v1\n" + canonicalJSON(hashProjection)))
```

`hashProjection` is the complete player-safe response projection excluding
`viewVersion` and volatile transport fields such as request IDs, server time,
and polling hints. Canonical JSON recursively sorts object keys, preserves each
array's documented semantic order, uses UTF-8, and contains no insignificant
whitespace. It never includes `towns.revision`. Hidden changes therefore do not
alter it or reveal that private activity occurred.

The browser sends `If-None-Match` on later polls. An unchanged projection
returns `304`; a changed projection returns `200` and the complete new view.
The client refreshes:

- immediately after a completed action;
- every five seconds while the tab is visible;
- every thirty seconds while hidden; and
- immediately when a hidden tab becomes visible.

Exact belief, trust, and suspicion scores are never returned. Relationships use
the accepted qualitative stance. Object truth appears only after an authorized
inspection or other deterministic discovery.

## Player action request

`POST /api/v1/towns/{townId}/actions` accepts this strict discriminated union;
unknown properties are rejected:

```ts
type ActionRequest =
  | { kind: "start_visit" }
  | { kind: "travel"; destinationLocationId: Id }
  | { kind: "inspect"; inspectableId: Id }
  | { kind: "ask"; npcId: Id; question: string }
  | { kind: "normalize_claim"; npcId: Id; text: string }
  | { kind: "tell"; claimDraftId: Id }
  | {
      kind: "show";
      npcId: Id;
      evidenceRef:
        | { kind: "clue"; clueId: Id }
        | { kind: "item"; itemId: Id };
    }
  | { kind: "give"; npcId: Id; itemId: Id }
  | { kind: "accept_promise"; offerId: string }
  | { kind: "add_note"; text: string }
  | { kind: "leave" }
  | {
      kind: "accuse";
      suspectId: Id;
      motiveId: Id;
      locationId: Id;
    }
  | {
      kind: "resolve";
      choice: "expose_cover_up" | "restore_bell_quietly";
    };
```

The completed envelope has `outcome` equal to `applied`, `no_change`, or
`denied`. A denied action always uses `DeniedActionResult`; otherwise `result`
must match the action kind in `ActionResultByKind`.

```ts
type NpcDialogue = {
  npcId: Id;
  text: string;
  responseMode: "selected" | "repaired" | "fallback" | "authored";
};

type PromiseOfferView = {
  offerId: string;
  sourceActionId: Id;
  ordinal: number;
  npcId: Id;
  kind: "keep_secret" | "return_item";
  termsVersion: string;
  summary: string;
  subject: PromiseSubjectView;
};

type DeniedActionResult = {
  type: "denied";
  reasonCode: string;
  message: string;
  dialogue?: NpcDialogue;
};

type ActionResultByKind = {
  start_visit: {
    disposition: "started" | "already_active";
    visitId: Id;
    locationId: Id;
  };
  travel: {
    disposition: "arrived" | "already_there";
    locationId: Id;
  };
  inspect: {
    inspectableId: Id;
    discovery:
      | "new_to_town"
      | "new_to_player"
      | "already_discovered_by_player"
      | "none";
    clue?: DiscoveredClueView;
    revealedItem?: RevealedItemView;
  };
  ask: {
    dialogue: NpcDialogue;
    promiseOffers: PromiseOfferView[];
  };
  normalize_claim:
    | {
        normalizationStatus: "drafted";
        claimDraftId: Id;
        canonicalText: string;
        allegedSource?: PublicActor;
        expiresAt: IsoTime;
      }
    | {
        normalizationStatus: "needs_revision";
        explanation: string;
      };
  tell: {
    claimDraftId: Id;
    claim: { claimId: Id; text: string };
    dialogue: NpcDialogue;
    promiseOffers: PromiseOfferView[];
  };
  show: {
    evidenceRef:
      | { kind: "clue"; clueId: Id }
      | { kind: "item"; itemId: Id };
    structuredEffect: "applied" | "none";
    appliedClueIds: Id[];
    dialogue: NpcDialogue;
    promiseOffers: PromiseOfferView[];
  };
  give: {
    itemId: Id;
    custody: "transferred" | "unchanged";
    dialogue: NpcDialogue;
    promiseOffers: PromiseOfferView[];
  };
  accept_promise: {
    promise: ActivePromiseView;
    itemTransfer: null | {
      itemId: Id;
      fromActorId: Id;
      toActorId: Id;
    };
    dialogue?: NpcDialogue;
  };
  add_note: {
    entry: Extract<CaseBoardEntryView, { entryKind: "note" }>;
  };
  leave: {
    visitId: Id;
    transitionStatus: "not_required" | "waiting";
  };
  accuse: {
    attempt: CaseAttemptView;
    resolution: ResolutionView;
  };
  resolve: {
    disposition: "resolved" | "already_resolved";
    resolution: Extract<ResolutionView, { state: "resolved" }>;
  };
};

type ActionKind = keyof ActionResultByKind;
type CompletedActionResponse = {
  [K in ActionKind]: {
    actionId: Id;
    kind: K;
    status: "completed";
  } & (
    | {
        outcome: "applied" | "no_change";
        result: ActionResultByKind[K];
      }
    | { outcome: "denied"; result: DeniedActionResult }
  );
}[ActionKind];
```

Every `promiseOffers` array is stored in ordinal order as part of the terminal
action response; each descriptor's `sourceActionId` equals the envelope action
ID and its `ordinal` equals its array index. Every `appliedClueIds` array is
sorted by clue ID and is nonempty exactly when `structuredEffect` is `applied`.
Result objects contain player-safe text and identifiers only. The saved response does
not embed `player-view` or expose the canonical town revision. The browser
fetches the current view after completion.

For a non-denied response, `outcome` is `no_change` exactly for
`already_active`, `already_there`, `already_discovered_by_player` or `none`
discovery, `needs_revision`, `structuredEffect: "none"`, custody:
`"unchanged"`, or `already_resolved`. `new_to_town` and `new_to_player` are
`applied` because each creates a durable discovery contribution. Every other
non-denied result is `applied`; notably, an
incorrect accusation is applied because it creates immutable shared history,
and a leave with `not_required` is applied because it ends the visit.

### Action kinds

| Kind | Required input | Principal result |
|---|---|---|
| `start_visit` | None | New Festival Square visit or existing active visit |
| `travel` | `destinationLocationId` | Deterministic arrival outcome |
| `inspect` | `inspectableId` | Authorized discovery and any verified clue |
| `ask` | `npcId`, `question` | Validated NPC dialogue |
| `normalize_claim` | `npcId`, `text` | Claim draft or `needs_revision` explanation |
| `tell` | `claimDraftId` | Confirmed claim transmission and dialogue |
| `show` | `npcId`, `evidenceRef` | Authorized evidence effects or dialogue |
| `give` | `npcId`, `itemId` | Conditional unique-item transfer and dialogue |
| `accept_promise` | `offerId` | Created authored promise and any atomic transfer |
| `add_note` | `text` | Immutable attributed board note |
| `leave` | None | Ended visit and optional ambient transition |
| `accuse` | `suspectId`, `motiveId`, `locationId` | Incorrect attempt or resolution reservation |
| `resolve` | `choice` | Irreversible ending or winning prior choice |

Except `start_visit` and `resolve`, gameplay actions require an active visit.
NPC actions additionally require the player and target NPC to be co-located.
Hidden, inaccessible, and cross-town identifiers all return the same `404`.

### Input bounds

- `ask` questions and raw claim text contain 1 through 500 Unicode grapheme
  clusters after trimming.
- Case-board notes contain 1 through 280 Unicode grapheme clusters after
  trimming.
- These fields are plain text. Control characters and markup are rejected.
- One `show` action presents either one discovered authored clue or one physical
  item currently held by the player to one co-located NPC. `evidenceRef` is a
  discriminated union of `{ "kind": "clue", "clueId": "..." }` and
  `{ "kind": "item", "itemId": "..." }`. An item may always produce
  dialogue or `no_change`; it produces structured clue or belief effects only
  when the authored world links that item to authorized evidence. Showing an
  item does not transfer it; `give` does.

A clue becomes discovered for `show` town-wide when its first
`clue_discoveries` row creates the shared verified-evidence board entry. A
player need not repeat that inspection. Personal discovery rows still preserve
credit and contribution history.

Inspecting an undiscovered clue returns `new_to_town`. A different player who
later examines it returns `new_to_player`, appends that player's one discovery
row, and does not duplicate the board entry. A player who already has that row
receives `already_discovered_by_player` with no write. An inspectable's
`inspectionState` is therefore player-relative: town-known evidence remains
`available` until this player has examined it.

`revealedItem.custody` distinguishes a portable item transferred into the
player's inventory from a non-portable item merely revealed at its authoritative
location. Only `player_inventory` appears in the refreshed `inventory` array.

### Claim normalization

Normalization and confirmation are separate actions. A valid normalization
creates a `claim_drafts` row bound to the player, visit, target NPC, and original
text. The response shows a plain-language canonical sentence and alleged source
without exposing predicate JSON or internal entity rules.

Drafts expire after ten minutes, are single-use, and require an active,
co-located visit at confirmation. Editing text or changing the NPC requires a
new normalization action and key. Ambiguous or unsupported text completes with
`outcome: "no_change"` and
`result.normalizationStatus: "needs_revision"`; it creates no draft,
transmission, memory, or belief effect.

### Promise offers

An NPC action may return one or more human-readable promise offers. Its saved
action result contains the ordered canonical descriptors; `offerId` is a
deterministic opaque encoding of the source action ID plus a zero-based stable
ordinal:

```text
base64url(UTF8("promise-offer:v1\n" + sourceActionId + "\n" + decimalOrdinal))
```

The ordinal is its array index written in base ten without leading zeroes. A
descriptor fixes `npcId`, promise kind, `termsVersion`, summary, and
the already-player-visible referenced claim or item. Accepting an offer loads
that exact saved descriptor and retained authored terms version, verifies the
same town, player, visit, and NPC, and re-evaluates current gates. It never
reconstructs an old offer from newly deployed content. No promise-offer token
grants authority by itself, and no separate promise-offers table is required.
Terms evaluators referenced by a retained offer or active promise remain
deployable for that town's lifetime.

An offer has no arbitrary timer. It remains usable only while its authored
context still passes validation. A context change produces a completed
gameplay denial.

### Notes and evidence

Notes are immutable and attributed. Players correct a note by adding another
note. Unverified notes and ordinary testimony cannot be submitted through
`show`; players discuss them through `tell` or `ask`.

### Gameplay denials

A valid request refused by game rules returns `200` with
`outcome: "denied"`. It may include safe in-character dialogue. Examples are a
closed access gate, an ineligible promise offer, or an item the NPC refuses.
The denial is terminal, saved, and replayable.

## Processing and HTTP time budget

API Gateway HTTP API integrations have a 30-second maximum timeout. The MVP
uses:

- a 30-second API Gateway integration timeout;
- a 28-second Game Lambda timeout; and
- a 24-second application completion budget.

An initial request is not converted into detached background work. If safe
dialogue cannot finish within the budget, the authored fallback completes the
action. Claim normalization has no safe semantic fallback and stores a terminal
`503 MODEL_UNAVAILABLE_RETRY_ACTION`; an intentional retry uses a new key. A
request records an absolute application deadline and reserves its final four
seconds for output validation, authored fallback selection, and the database
commit. Every pre-commit CockroachDB read, Titan call, and Bedrock call must end
by `applicationDeadline - 4 seconds`. The final transaction receives a
statement timeout no later than the remaining application budget, with a
500-millisecond response-serialization margin. A repair pass or town revision
rerun starts only when its worst-case bound fits before the reserved window.

If Titan query embedding fails during `ask`, retrieval falls back
deterministically to authorized recent episodes, high-importance episodes,
unresolved promises, and public disclosures, in that order and within the same
NPC/town visibility boundary. If no safe context remains, authored dialogue
completes the action. The fallback never broadens access to hidden truth.

If another invocation observes the same action still processing, it returns:

```json
{
  "actionId": "action_123",
  "status": "processing",
  "pollAfterMs": 2000
}
```

with `202 Accepted`, `Retry-After: 2`, and a `Location` pointing to the action
status route. Polling that route is the preferred recovery path; resending the
identical `POST` and key remains safe.

The status route is visible only to the action's player; every other identity
receives `404`. While processing it returns the same `202` shape. A `retryable`
action returns its saved `409 ACTION_CONFLICT` and `Retry-After`; the status
route observes that state but does not restart it. Once terminal, the route
returns the saved original HTTP status and body: the completed action envelope
for a success or gameplay denial, or the saved problem body for a terminal
failure.

Player processing claims last 35 seconds and do not renew. The browser polls
every two seconds. If the action is still processing after claim expiry, it
resends the original `POST`, body, and key once so a new worker may
conditionally take over; automatic recovery stops after 70 seconds and leaves
a manual same-key retry. The accepted attempt-exhaustion and late-worker rules
remain those in the schema contract.

## Visits and ambient transitions

Joining an active town starts the first visit at Festival Square. Later visits
use `start_visit`; starting while already active returns the existing visit.
`leave` ends the visit, and away players cannot perform gameplay actions.

Every world event carries a deterministic `ambient_eligible` value. When a
visit ends, the transaction allocates the next disjoint event range. If the
range has no eligible event, it advances the scheduling boundary without an
outbox job and the player may start another visit immediately. Otherwise it
creates one delayed ambient job. The SQS FIFO queue has a 20-second queue-level
delay, uses `town_id` as the message group, and uses the job key as the
deduplication ID.

The departing player cannot start another visit until the job is `completed`
or `quarantined`. Normal player-visible states are `waiting`, `processing`, and
`complete`; queue IDs, retry counts, and failures remain private.

Each ambient transition has a hard deadline five minutes after departure.
Recovery runs once per minute. At the deadline, any pending or sending outbox
row becomes `abandoned`, and any nonterminal execution becomes `quarantined`
with no effects. `start_visit` may perform this conditional terminalization if
the deadline has passed before Recovery runs. Late SQS deliveries observe the
terminal state and stop. Quarantine is player-visible as `complete`, so a
delivery or model failure can never strand the player away.

The Ambient Tick Lambda has a 30-second hard timeout and 24-second application
budget. Ambient processing claims last 45 seconds without renewal. SQS
visibility is 180 seconds, batch size is one, and ambient concurrency is capped
at five. A worker may commit only before the transition deadline, while it
holds the current claim, and while the town remains `active`. Invalid or
exhausted ambient model output becomes a recorded `do_nothing` or quarantine
without partial effects.

## Accusation and resolution

The deterministic evidence gate must be open before `accuse` is accepted.
Premature attempts are completed gameplay denials and do not create
`case_attempts`. Valid incorrect attempts are immutable and visible in shared
contribution history.

The first correct attempt conditionally moves the town to
`awaiting_resolution`, records that attempt and player as the resolution owner,
and reserves the choice for ten minutes. During this state:

- all gameplay and ambient effects are frozen;
- player reads, joins, action-status reads, and `resolve` remain available;
- active visits remain visible but accept no further gameplay actions; and
- queued ambient jobs complete as `do_nothing` or quarantine.

Before reservation expiry, only the correct accuser may resolve. After expiry,
any participating player with a `player_visits` row whose `started_at` is no
later than the winning correct attempt may do so, even without a currently
active visit. This excludes a new invite holder who joined only after the town
entered `awaiting_resolution`. The first resolution transaction wins
permanently. A concurrent loser completes with `outcome: "no_change"` and the
already-selected ending.

Resolution ends all active visits, applies the authored ending state change,
resolves promises and relationships, and makes the town permanently read-only.
For `bell-mystery-v1`, either ending conditionally moves the Festival Bell from
the Old Chapel to Festival Square and records one `item_relocated` event in the
same winning transaction. Existing players and new invite holders may view the
epilogue and shared history until the town is retired. Joining a resolved town
creates no visit. A retired town accepts neither joins nor player views.

## Idempotency and conflicts

Authenticated action records and their fingerprints remain for the town's
lifetime. The behavior is:

| Existing record | Result |
|---|---|
| None | Create `processing`, take the claim, and execute |
| Same input, processing | `202` and action status location |
| Same input, retryable before `retry_after_at` | Replay `409 ACTION_CONFLICT` and `Retry-After` |
| Same input, retryable after `retry_after_at` | Conditionally clear the saved conflict and return to `processing` under the same key |
| Same input, completed or failed | Replay the saved status and body |
| Different input | `409 IDEMPOTENCY_KEY_REUSED` |
| Expired processing claim | A new worker may conditionally take over |

At most one action may be `processing` for a player. For a different new key,
a live blocking action returns `409 ACTION_IN_PROGRESS`, `Retry-After: 2`, and
the blocking action's status location without creating a record for the new
request. An expired blocking action may be conditionally failed with no effects
and saved `409 ACTION_SUPERSEDED` before the new action is created in the same
transaction. Same-key replay is resolved first.

CockroachDB serialization conflicts receive the accepted three short retries.
A model-backed action reloads relevant state once after a town revision change.
A second relevant conflict stores nonterminal `retryable` state with
`409 ACTION_CONFLICT`, no effects, `retry_after_at = now + 1 second`, and
`Retry-After: 1`. The client retries
the identical request with the same key; the action may then reclaim processing
and finish under the same durable identity. Reclaiming atomically clears the
saved conflict response and retry timestamp while installing the new processing
token. A new key is used only for an
intentional retry after a terminal semantic or dependency failure.

Rate-limit rejection for a new action occurs before its record is created, so
the same key may be used after `Retry-After`. Authentication and
malformed-request failures also occur before action creation. A same-input
replay of a processing or terminal action does not consume model quota. A
retryable action that will actually run model work again must consume the
applicable action-attempt buckets before reclaiming `processing`; a `429` leaves
that existing action retryable under the same key.

## Rate limits

Application limits use transactional token buckets in `api_rate_limits`.
API Gateway additionally applies coarse route and account protection.
The model-backed player-action class is exactly `ask`, `normalize_claim`,
`tell`, `show`, `give`, and `accept_promise`. `start_visit`, `travel`, `inspect`,
`add_note`, `leave`, `accuse`, and `resolve` are not charged to that class;
ambient work has its own bounded execution path and cost controls.

| Scope | Sustained rate | Burst capacity |
|---|---:|---:|
| Model-backed actions, per player | 6/minute | 3 |
| Model-backed actions, per town | 30/minute | 10 |
| `player-view`, per player | 30/minute | 10 |
| Town-creation attempts, per IP hash | 5/15 minutes | 5 |
| New joins, per IP hash | 10/15 minutes | 10 |

Non-executing authenticated replays and existing-session resumes are recognized
before the new-operation limit so a lost response is not converted into a
duplicate.
Source IPs are stored only as rotating HMAC hashes. A `429` response includes
`Retry-After` and does not consume an idempotency key.

Cost-mode limits may be stricter. They use stable error codes and never reveal
the internal dollar ledger.

## Error contract

Errors use `application/problem+json`:

```json
{
  "type": "https://the-town-remembers/errors/idempotency-key-reused",
  "status": 409,
  "code": "IDEMPOTENCY_KEY_REUSED",
  "title": "Idempotency key reused",
  "detail": "This key was previously used for different action input.",
  "requestId": "req_123",
  "actionId": "action_123",
  "fieldErrors": []
}
```

`actionId` is present only when an action record exists. Pre-authentication,
malformed, and rate-limit problems omit it.

The exact reusable problem shape is:

```ts
type ProblemResponse = {
  type: string;
  status: number;
  code: string;
  title: string;
  detail: string;
  requestId: string;
  actionId?: Id;
  fieldErrors: Array<{
    path: string;
    code: string;
    message: string;
  }>;
};
```

`path` is a JSON Pointer into the request body, or an empty string for a
request-wide error. Public codes and messages are stable within `/api/v1` and
never contain submitted secret values.

Core status policy:

| Status | Meaning |
|---:|---|
| `400` | Malformed JSON, header, or required field structure |
| `401` | Missing or invalid player session |
| `403` | Authenticated identity lacks route-level permission |
| `404` | Missing, hidden, inaccessible, or cross-town resource |
| `409` | Saved idempotency misuse, retryable action conflict, or another live action for the player |
| `410` | Join bootstrap closed, replay expired/exhausted, or town retired |
| `422` | Well-formed request with unsupported semantic value |
| `429` | Rate limit, with `Retry-After` |
| `500` | Unexpected internal failure |
| `503` | Safe temporary dependency or capacity failure |

Stack traces, SQL details, hidden identifiers, dependency credentials, and raw
model output never appear in responses.

## Health route

`GET /api/v1/health` reports only API liveness, build version, and server time:

```json
{
  "status": "ok",
  "build": "git-sha-or-release-id",
  "time": "2026-08-02T00:00:00Z"
}
```

It does not query CockroachDB or Bedrock and exposes no dependency state. The
production smoke test exercises authenticated flows separately.

## Verification priorities

The API test suite must prove:

1. Invite preview reveals no case or player data.
   Invite tokens also never appear in referrers, access logs, application logs,
   analytics, or post-resolution browser URLs.
2. Returning town cookies resume the same fixed identity, while separate towns
   retain independent sessions.
3. Join replay within ten minutes creates one player and may issue a fresh
   session only before the first authenticated view; bootstrap confirmation or
   replay expiry permanently closes that path and clears the join-secret hash,
   and no request issues more than three sessions.
4. Unicode-normalized display names and authored NPC names cannot collide.
5. Hidden town changes do not change a player's `ETag`.
6. Completed actions replay exactly, mismatched keys return `409`, and action
   status is readable only by the owning player.
7. Rule denials are completed `200` responses and produce no unauthorized
   effects.
8. Claim drafts expire after ten minutes and can be confirmed once by the
   same co-located player.
9. Inspect distinguishes first-town, later-player, and repeated-same-player clue
   discovery; later discoverers appear once in contribution history, and a
   non-portable revealed item remains at its location rather than entering
   inventory. `show` rejects unheld items and town-undiscovered clues, lets another player
   show a clue already verified on the shared board, allows a held item to
   produce dialogue, and applies structured evidence effects only for authored
   evidence links.
10. A no-eligible-event departure creates no ambient job; concurrent jobs that
    do exist receive disjoint ranges.
11. Completion, quarantine, or the five-minute deadline always permits later
    re-entry, and a late delivery cannot apply abandoned work.
12. `awaiting_resolution` freezes gameplay, enforces the ten-minute owner
    reservation, and stores only one ending.
13. Canonical revisions, exact scores, and objective truth never enter player
    responses.
14. The 24-second application budget, dependency abort deadlines, and reserved
    commit window produce a saved safe response before the API Gateway timeout;
    failed query embedding cannot widen `ask` retrieval authority.
15. Every rate-limit scope is enforced atomically and a `429` does not consume
    the request key.
16. A second relevant revision conflict is retryable with the same action key,
    never duplicates effects, and cannot be restarted through the status route.
17. A resolved-town newcomer can read the ending but cannot claim an expired
    resolution reservation.
18. Every player-view and completed action validates against the exact response
    union; shuffled database row order produces the same ordered JSON and ETag.
19. A promise offer remains bound to its saved descriptor and terms version
    across a later content deployment; ordinal or source-action mismatch is
    denied.
20. One player cannot run two actions concurrently; an expired blocking action
    may be cleared only after its old processing token can no longer commit.
21. Locked accusation state exposes no candidates; the open gate returns only
    the frozen content version's authored suspect, motive, and location options
    in deterministic order, including non-NPC characters such as Lark.

## Related decisions

- [Decision 001: MVP Product Direction](001-mvp-product-direction.md)
- [Decision 002: MVP System Architecture](002-mvp-system-architecture.md)
- [Technical Architecture and Runtime Flows](003-technical-architecture-and-schema.md)
- [Infrastructure Cost Estimate](004-infrastructure-cost-estimate.md)
- [Logical Data Model and Schema Contract](005-logical-data-model-and-schema-contract.md)
- [MVP Reliability Parameters](007-mvp-reliability-parameters.md)
- [Decision 008: Deterministic Game Rules](008-deterministic-game-rules.md)
- [Decision 009: Authored Game Content](009-authored-game-content.md)
- [Decision 010: Bedrock Prompt and Structured-Output Contracts](010-bedrock-prompt-contracts.md)
- [Decision 011: Interface and Interaction Design](011-interface-and-interaction-design.md)
- [AWS API Gateway v2 integration timeout](https://docs.aws.amazon.com/cli/latest/reference/apigatewayv2/create-integration.html)
