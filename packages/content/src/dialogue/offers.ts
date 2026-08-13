/**
 * Requested-item bindings for `bell-mystery-v1` (`D4-I`).
 *
 * The two promise offers themselves (`return-chapel-key-v1`,
 * `keep-lark-accident-secret-v1`) are already fully authored at
 * `content/versions.ts#PROMISE_TERMS` — kind, NPC, subject, and summary —
 * so this module does not duplicate them. What Decision 010's dialogue
 * bundle still needs and no earlier phase authored is the NPC's own spoken
 * prompt for its optional requested item, transcribed verbatim from
 * Decision 009's "NPC content" section.
 */

import { PROMISE_TERMS } from "../versions.js";

export interface RequestedItemBinding {
  readonly npcKey: string;
  readonly itemKey: string;
  /** The NPC's own spoken request, exact authored text. */
  readonly prompt: string;
}

export const REQUESTED_ITEM_BINDINGS: readonly RequestedItemBinding[] = Object.freeze([
  {
    npcKey: "corin_hale",
    itemKey: "guard_dispatch_seal",
    prompt:
      "A guard dispatch seal is missing. If you find it, return it to me rather than " +
      "using it as proof of anything.",
  },
  {
    npcKey: "nessa_reed",
    itemKey: "nessas_field_lens",
    prompt:
      "I lost my field lens near the square benches. Bring it back if you find it.",
  },
] as const);

export function requestedItemBindingForNpc(
  npcKey: string,
): RequestedItemBinding | undefined {
  return REQUESTED_ITEM_BINDINGS.find((binding) => binding.npcKey === npcKey);
}

/** Re-exported so `packages/content/src/dialogue` is the one place to look for offer content. */
export { PROMISE_TERMS };
