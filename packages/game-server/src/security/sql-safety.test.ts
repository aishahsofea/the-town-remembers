/**
 * Static SQL-safety scan over `packages/game-server/src/persistence/**`
 * (`P3-17` acceptance 1 and 2).
 *
 * Acceptance 1: no `.query()` call's SQL literal ever interpolates a
 * `${...}` expression — every value crosses the wire through the parameter
 * array, never string-built. Two column-list constants
 * (`actions.ts`/`creation-ledger.ts`/`join-ledger.ts`) were inlined during
 * this task specifically to satisfy this rule literally: a scanner that
 * carves out "safe" interpolations for known-local constants is a scanner a
 * reviewer can no longer trust at a glance, and the fix costs nothing since
 * the column lists never changed at runtime anyway.
 *
 * Acceptance 2: every statement with a `WHERE` clause names `town_id = $`,
 * with two file-level and one statement-level reviewed exemption — see
 * `FILE_EXEMPT_FROM_TOWN_ID` and `queriesTownsTableByOwnId` below.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PERSISTENCE_DIR = path.resolve(HERE, "../persistence");

interface QueryLiteral {
  readonly file: string;
  readonly text: string;
}

function persistenceSourceFiles(): string[] {
  return readdirSync(PERSISTENCE_DIR)
    .filter((name) => name.endsWith(".ts") && !name.includes(".test."))
    .sort();
}

/** Every SQL string literal passed as the first argument to a `.query(...)` call. */
function extractQueryLiterals(file: string, source: string): QueryLiteral[] {
  const literals: QueryLiteral[] = [];
  const callSites = source.matchAll(/\.query\s*(?:<[\s\S]*?>)?\s*\(/g);
  for (const match of callSites) {
    let index = match.index + match[0].length;
    while (/\s/.test(source[index] ?? "")) index += 1;
    const quote = source[index];
    if (quote !== "`" && quote !== '"') continue;
    const end = source.indexOf(quote, index + 1);
    literals.push({ file, text: source.slice(index + 1, end) });
  }
  return literals;
}

function allQueryLiterals(): QueryLiteral[] {
  return persistenceSourceFiles().flatMap((name) => {
    const source = readFileSync(path.join(PERSISTENCE_DIR, name), "utf8");
    return extractQueryLiterals(name, source);
  });
}

describe("persistence SQL safety (P3-17 acceptance 1)", () => {
  it("never interpolates a ${...} expression into a query() literal", () => {
    const offenders = allQueryLiterals().filter((literal) =>
      literal.text.includes("${"),
    );
    expect(offenders).toStrictEqual([]);
  });

  it("the scan itself is not vacuous", () => {
    expect(allQueryLiterals().length).toBeGreaterThan(20);
  });
});

/**
 * Files whose statements never carry `town_id = $` because there is no town
 * to carry — reviewed, not inferred:
 *  - `creation-ledger.ts`: `town_creation_requests`' primary key is
 *    `idempotency_key` alone; the town does not exist yet when the first
 *    attempt claims a row (docs/005 §"town_creation_requests").
 *  - `rate-limits.ts`: `api_rate_limits`' primary key is
 *    `(scope_kind, scope_key, bucket_kind)`; a per-town scope folds the town
 *    into the `scope_key` hash itself (`rateScopeKey`), not a column.
 *  - `model-cost.ts`: `model_cost_reservations` is migration 0008's one
 *    deliberately global table — a monthly spend ceiling cannot be enforced
 *    per town, `town_id` is nullable (`NULL` for non-game operations like
 *    prewarm), and admission/settlement/release all scope by `billing_month`
 *    or the reservation's own `id` instead (`P4-05`, `D4-M`).
 */
const FILE_EXEMPT_FROM_TOWN_ID = new Set([
  "creation-ledger.ts",
  "rate-limits.ts",
  "model-cost.ts",
]);

/**
 * A statement reads or writes `public.towns`' own row (by that table's own
 * `id`), rather than a subordinate table that needs a separate `town_id`
 * filter to stay tenant-scoped. Matches `view-queries.ts#readTownHeader`,
 * `sessions.ts#authenticate` (`SELECT ... FROM public.towns`), and
 * `players.ts#bootstrapStartVisit`'s revision bump (`UPDATE public.towns`).
 */
function queriesTownsTableByOwnId(text: string): boolean {
  return (
    /(?:FROM|UPDATE)\s+public\.towns\b/i.test(text) &&
    /(?:^|[\s.])id\s*=\s*\$1\b/i.test(text)
  );
}

describe("persistence SQL safety (P3-17 acceptance 2)", () => {
  it("every WHERE-scoped statement names town_id, except the reviewed exemptions", () => {
    const offenders = allQueryLiterals().filter((literal) => {
      if (!/\bwhere\b/i.test(literal.text)) return false;
      if (/town_id\s*=\s*\$\d+/.test(literal.text)) return false;
      if (FILE_EXEMPT_FROM_TOWN_ID.has(literal.file)) return false;
      if (queriesTownsTableByOwnId(literal.text)) return false;
      return true;
    });
    expect(offenders).toStrictEqual([]);
  });
});
