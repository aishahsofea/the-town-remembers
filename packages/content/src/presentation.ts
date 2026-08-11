/**
 * Player-safe presentation strings and asset keys for `bell-mystery-v1`.
 *
 * `apps/web` cannot import this package: `packages/content` depends on
 * `packages/serialization`, which imports `node:crypto`, and
 * `scripts/check-bundle-safety.mjs` forbids both substrings in the browser
 * bundle. The seven asset keys below are therefore deliberately duplicated in
 * `apps/web/src/assets/manifest.ts#BELL_MYSTERY_V1_ASSET_KEYS`, and
 * `scripts/check-asset-keys.mjs` fails the build the moment the two lists
 * disagree (`D3-K`).
 */

/** Decision 009 §"Player-facing premise" › "Invite preview", verbatim. */
export const MYSTERY_TITLE = "The Missing Festival Bell";
export const TAGLINE =
  "The bell is gone. The town remembers a different story in every mouth.";
export const SPOILER_SAFE_DESCRIPTION =
  "Visit a shared town, question its residents, trace its rumours, and " +
  "discover what happened before the festival begins.";

/** Decision 009 §"Player-facing premise" › "Opening narration", verbatim. */
export const OPENING_NARRATION =
  "Festival banners cross the square, but no music answers them. The timber " +
  "bell frame stands empty, the opening procession is suspended, and three " +
  "townsfolk are already telling three different versions of the night. " +
  "Find the bell. Decide which story the town will remember.";

/**
 * Keyed by `AuthoredLocation#entityKey` from `entities.ts#LOCATIONS`. Values
 * are literal strings, not built from `versions.ts#CONTENT_VERSION`, because
 * `scripts/check-asset-keys.mjs` finds them by scanning this file's source
 * text — a key a future content version needs is a new authored literal here,
 * not a substitution.
 */
export const LOCATION_SCENE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  festival_square: "bell-mystery-v1/scenes/festival-square",
  lantern_inn: "bell-mystery-v1/scenes/lantern-inn",
  reeds_garden: "bell-mystery-v1/scenes/reeds-garden",
  old_chapel: "bell-mystery-v1/scenes/old-chapel",
});

/** Keyed by `AuthoredNpc#npcKey` from `entities.ts#NPCS`. */
export const NPC_PORTRAIT_KEYS: Readonly<Record<string, string>> = Object.freeze({
  mara_venn: "bell-mystery-v1/portraits/mara-venn",
  corin_hale: "bell-mystery-v1/portraits/corin-hale",
  nessa_reed: "bell-mystery-v1/portraits/nessa-reed",
});

/**
 * Player-safe role labels (`D3-J`), new authored copy distinct from Decision
 * 009's "Role" column. That column is a design note — *"Innkeeper and Lark's
 * protective older sister"*, *"Town guard who moved the bell"* — and the
 * second entry states the solution outright. Decision 009 separately requires
 * the opening not to expose Lark, the Old Chapel's relevance, or Corin's
 * involvement, so the long forms cannot be `EncounterView.roleLabel`. Keyed by
 * `AuthoredNpc#npcKey`.
 */
export const NPC_ROLE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  mara_venn: "Innkeeper",
  corin_hale: "Town guard",
  nessa_reed: "Herbalist",
});

/**
 * Player-safe inventory descriptions, keyed by `AuthoredItem#entityKey` from
 * `entities.ts#ITEMS`. Decision 011's `InventoryItemView.description` needs
 * authored prose that `AuthoredItem` itself never carried — these are new
 * authored copy, not a restatement of a design note.
 */
export const ITEM_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  old_chapel_key: "A heavy iron key, worn smooth at the bow.",
  nessas_field_lens:
    "A herbalist's folding lens, its brass hinge still faintly warm from a pocket.",
  guard_dispatch_seal:
    "A guard dispatch seal in red wax, its cord snapped rather than untied.",
});
