/**
 * The authored entities of `bell-mystery-v1`.
 *
 * Every stable key here is frozen. Claims, clue effects, the private solution,
 * and the seed all address entities through these keys rather than through
 * generated IDs, so two towns created from this version are semantically
 * comparable while sharing no identity at all.
 *
 * Lark Venn is a character with no NPC row. She is the reason the whole
 * mystery exists and never appears on screen, which is exactly why the schema
 * separates story entities from actors.
 */

export type EntityType = "character" | "location" | "item" | "motive";

/**
 * `D4-J`: NFKC-normalized, case-folded alternative names a player might use
 * to refer to this entity in free text, consumed by claim normalization's
 * `canonical_entities`/`canonical_actors` (Decision 010). An NPC has no
 * alias list of its own — it derives one transitively from its
 * `characterKey`'s entity, so the same name never has to be authored twice.
 */
function normalizeAlias(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeAliases(values: readonly string[]): readonly string[] {
  return Object.freeze(values.map(normalizeAlias));
}

export interface AuthoredEntity {
  readonly entityKey: string;
  readonly entityType: EntityType;
  readonly displayName: string;
  readonly contentKey: string;
  readonly aliases: readonly string[];
}

export interface AuthoredLocation extends AuthoredEntity {
  readonly entityType: "location";
  readonly mapOrder: number;
  readonly initiallyOpen: boolean;
  readonly description: string;
}

export interface AuthoredItem extends AuthoredEntity {
  readonly entityType: "item";
  readonly portable: boolean;
  /** Exactly one of these is set, matching the item's initial custody. */
  readonly initialLocationKey?: string;
  readonly initialHolderKey?: string;
}

export const CHARACTERS: readonly AuthoredEntity[] = Object.freeze([
  {
    entityKey: "mara_venn",
    entityType: "character",
    displayName: "Mara Venn",
    contentKey: "character.mara_venn",
    aliases: normalizeAliases(["Mara", "the innkeeper"]),
  },
  {
    entityKey: "corin_hale",
    entityType: "character",
    displayName: "Corin Hale",
    contentKey: "character.corin_hale",
    aliases: normalizeAliases(["Corin", "the guard"]),
  },
  {
    entityKey: "nessa_reed",
    entityType: "character",
    displayName: "Nessa Reed",
    contentKey: "character.nessa_reed",
    aliases: normalizeAliases(["Nessa", "the herbalist"]),
  },
  {
    entityKey: "lark_venn",
    entityType: "character",
    displayName: "Lark Venn",
    contentKey: "character.lark_venn",
    aliases: normalizeAliases([
      "Lark",
      "the apprentice",
      "the bell-ringer's apprentice",
    ]),
  },
] as const);

export const LOCATIONS: readonly AuthoredLocation[] = Object.freeze([
  {
    entityKey: "festival_square",
    entityType: "location",
    displayName: "Festival Square",
    contentKey: "location.festival_square",
    mapOrder: 0,
    initiallyOpen: true,
    description: "Bright bunting hangs over an empty bell frame and a halted festival.",
    aliases: normalizeAliases(["the square", "festival square"]),
  },
  {
    entityKey: "lantern_inn",
    entityType: "location",
    displayName: "The Lantern Inn",
    contentKey: "location.lantern_inn",
    mapOrder: 1,
    initiallyOpen: true,
    description: "A warm public room where whispers travel faster than trays.",
    aliases: normalizeAliases(["the inn", "the lantern inn"]),
  },
  {
    entityKey: "reeds_garden",
    entityType: "location",
    displayName: "Reed's Garden",
    contentKey: "location.reeds_garden",
    mapOrder: 2,
    initiallyOpen: true,
    description: "Orderly herb beds border the narrow lane to the Old Chapel.",
    aliases: normalizeAliases(["the garden", "reed's garden", "reeds garden"]),
  },
  {
    entityKey: "old_chapel",
    entityType: "location",
    displayName: "Old Chapel",
    contentKey: "location.old_chapel",
    mapOrder: 3,
    initiallyOpen: false,
    description: "A disused stone chapel above the eastern lane.",
    aliases: normalizeAliases(["the chapel", "old chapel"]),
  },
] as const);

/** The locked map message never enumerates the ways in. */
export const LOCKED_LOCATION_MESSAGE = "The chapel door is locked.";

export const MOTIVES: readonly AuthoredEntity[] = Object.freeze([
  {
    entityKey: "protect_lark",
    entityType: "motive",
    displayName: "Protecting Lark",
    contentKey: "motive.protect_lark",
    aliases: normalizeAliases(["protecting lark"]),
  },
  {
    entityKey: "public_safety",
    entityType: "motive",
    displayName: "Preventing a public accident",
    contentKey: "motive.public_safety",
    aliases: normalizeAliases(["public safety", "safety"]),
  },
  {
    entityKey: "personal_profit",
    entityType: "motive",
    displayName: "Selling the bell for personal profit",
    contentKey: "motive.personal_profit",
    aliases: normalizeAliases(["personal profit", "money", "profit"]),
  },
] as const);

export const ITEMS: readonly AuthoredItem[] = Object.freeze([
  {
    entityKey: "festival_bell",
    entityType: "item",
    displayName: "Festival Bell",
    contentKey: "item.festival_bell",
    portable: false,
    initialLocationKey: "old_chapel",
    aliases: normalizeAliases(["the bell", "festival bell"]),
  },
  {
    entityKey: "old_chapel_key",
    entityType: "item",
    displayName: "Old Chapel Key",
    contentKey: "item.old_chapel_key",
    portable: true,
    initialHolderKey: "nessa_reed",
    aliases: normalizeAliases(["the key", "chapel key", "old chapel key"]),
  },
  {
    entityKey: "nessas_field_lens",
    entityType: "item",
    displayName: "Nessa's Field Lens",
    contentKey: "item.nessas_field_lens",
    portable: true,
    initialLocationKey: "festival_square",
    aliases: normalizeAliases(["the lens", "field lens", "nessa's lens"]),
  },
  {
    entityKey: "guard_dispatch_seal",
    entityType: "item",
    displayName: "Guard Dispatch Seal",
    contentKey: "item.guard_dispatch_seal",
    portable: true,
    initialLocationKey: "reeds_garden",
    aliases: normalizeAliases(["the seal", "dispatch seal", "guard seal"]),
  },
] as const);

/** Items are story entities too; the seed inserts one row per key here. */
export const STORY_ENTITIES: readonly AuthoredEntity[] = Object.freeze([
  ...CHARACTERS,
  ...LOCATIONS,
  ...ITEMS,
  ...MOTIVES,
]);

export interface AuthoredNpc {
  readonly npcKey: string;
  readonly characterKey: string;
  readonly locationKey: string;
  readonly profileKey: string;
  readonly profileVersion: string;
  readonly openingGreeting: string;
}

export const NPCS: readonly AuthoredNpc[] = Object.freeze([
  {
    npcKey: "mara_venn",
    characterKey: "mara_venn",
    locationKey: "lantern_inn",
    profileKey: "npc.mara_venn",
    profileVersion: "mara-venn/1.0.0",
    openingGreeting:
      "If you've come for the festival, I'm sorry. If you've come for the truth, " +
      "lower your voice and tell me which part you think you have.",
  },
  {
    npcKey: "corin_hale",
    characterKey: "corin_hale",
    locationKey: "festival_square",
    profileKey: "npc.corin_hale",
    profileVersion: "corin-hale/1.0.0",
    openingGreeting:
      "The square is closed for the bell inquiry. You may look, and you may ask, " +
      "but do not turn rumour into evidence.",
  },
  {
    npcKey: "nessa_reed",
    characterKey: "nessa_reed",
    locationKey: "reeds_garden",
    profileKey: "npc.nessa_reed",
    profileVersion: "nessa-reed/1.0.0",
    openingGreeting:
      "I can tell you what I saw, what I heard, or what I concluded. " +
      "Those are three different answers.",
  },
] as const);

export interface ContactEdge {
  readonly fromNpcKey: string;
  readonly toNpcKey: string;
  readonly trustScore: number;
}

/**
 * Directional, and deliberately incomplete: there is no Nessa-to-Corin edge, so
 * she cannot gossip with him even though both know something.
 */
export const CONTACT_EDGES: readonly ContactEdge[] = Object.freeze([
  { fromNpcKey: "mara_venn", toNpcKey: "nessa_reed", trustScore: 30 },
  { fromNpcKey: "mara_venn", toNpcKey: "corin_hale", trustScore: 40 },
  { fromNpcKey: "nessa_reed", toNpcKey: "mara_venn", trustScore: 20 },
  { fromNpcKey: "corin_hale", toNpcKey: "mara_venn", trustScore: 20 },
] as const);
