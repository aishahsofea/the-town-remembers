/**
 * `D4-H`: ephemeral, bundle-local ID allocation.
 *
 * Disclosure, outcome, rendering, and episode IDs sent to the model are
 * never a database id and never persisted — Decision 010 requires only that
 * they are "deterministic within one bundle and reused unchanged by its
 * repair attempt." Sequential, prefixed IDs assigned over a *sorted* key set
 * satisfy that: the same underlying keys always produce the same IDs
 * regardless of what order the caller happened to iterate them in (a `Map`
 * or a database read gives no such guarantee on its own), and a town-
 * revision rerun that changes the underlying set produces different IDs by
 * construction.
 */

export interface BundleIdAssignment<TKey extends string> {
  /** Real key (a claim id, episode id, ...) to its ephemeral bundle-local id. */
  readonly idByKey: ReadonlyMap<TKey, string>;
  /** The reverse map, used only in-process to resolve a model's selection back to a real key. */
  readonly keyById: ReadonlyMap<string, TKey>;
  readonly orderedIds: readonly string[];
}

export class DuplicateBundleKeyError extends Error {
  constructor(prefix: string, key: string) {
    super(`Duplicate key for "${prefix}" bundle ids: ${key}`);
    this.name = "DuplicateBundleKeyError";
  }
}

/**
 * Assigns `${prefix}1`, `${prefix}2`, ... over `keys` sorted lexicographically.
 * Each key must be unique — a duplicate signals the caller built its
 * candidate set incorrectly, not something to silently coalesce.
 */
export function assignSequentialBundleIds<TKey extends string>(
  keys: readonly TKey[],
  prefix: string,
): BundleIdAssignment<TKey> {
  const sortedKeys = [...keys].toSorted();
  const idByKey = new Map<TKey, string>();
  const keyById = new Map<string, TKey>();
  const orderedIds: string[] = [];

  sortedKeys.forEach((key, index) => {
    if (idByKey.has(key)) throw new DuplicateBundleKeyError(prefix, key);
    const id = `${prefix}${index + 1}`;
    idByKey.set(key, id);
    keyById.set(id, key);
    orderedIds.push(id);
  });

  return { idByKey, keyById, orderedIds };
}

export function assignDisclosureIds(
  claimIds: readonly string[],
): BundleIdAssignment<string> {
  return assignSequentialBundleIds(claimIds, "d");
}

export function assignOutcomeIds(
  outcomeIds: readonly string[],
): BundleIdAssignment<string> {
  return assignSequentialBundleIds(outcomeIds, "o");
}

export function assignEpisodeIds(
  episodeIds: readonly string[],
): BundleIdAssignment<string> {
  return assignSequentialBundleIds(episodeIds, "e");
}

export function assignRenderingIds(
  templateKeys: readonly string[],
): BundleIdAssignment<string> {
  return assignSequentialBundleIds(templateKeys, "r");
}
