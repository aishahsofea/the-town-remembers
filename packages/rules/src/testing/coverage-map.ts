/**
 * A checked-in data table linking every phase-plan goal (`G1`..`G22`, §7 of
 * the Phase 2 execution plan) to one real test that proves it — the same
 * spirit as Phase 1's `expected-schema.ts`: data compared against reality,
 * not prose. `coverage-map.test.ts` asserts every row resolves to a real
 * test name found in its named file, so a row cannot silently rot once the
 * referenced test is renamed or removed.
 */

export interface CoverageMapRow {
  readonly goal: string;
  readonly requirement: string;
  readonly testFile: string;
  readonly testName: string;
}

export const COVERAGE_MAP: readonly CoverageMapRow[] = Object.freeze([
  {
    goal: "G4",
    requirement: "the D2-D claim-matrix three-way equality",
    testFile: "claims/grammar.test.ts",
    testName: "agrees across database/domains, content, and model-contracts",
  },
  {
    goal: "G4",
    requirement: "the D2-D ACTION_KINDS two-way equality",
    testFile: "actions/dispatcher.test.ts",
    testName: "agrees between database/domains and http-contracts",
  },
  {
    goal: "G2",
    requirement: "RULES_REGISTRY re-exports database/domains by reference",
    testFile: "kernel/version.test.ts",
    testName: "re-exports database/domains constants by reference, not by value",
  },
  {
    goal: "G3",
    requirement: "no ambient clock/identity/env read anywhere in packages/rules/src",
    testFile: "kernel/determinism.test.ts",
    testName: "keeps %s free of ambient calls",
  },
  {
    goal: "G5",
    requirement: "entails propagates zero weight (D2-Q) and mirrors backfill correctly",
    testFile: "claims/relations.test.ts",
    testName: "propagates zero weight for an entails mirror (D2-Q)",
  },
  {
    goal: "G6",
    requirement: "replaying SEED_EVIDENCE reproduces seedBeliefs() exactly",
    testFile: "beliefs/evidence.test.ts",
    testName: "reproduces seedBeliefs()'s scores and labels by summing SEED_EVIDENCE",
  },
  {
    goal: "G7",
    requirement: "dialogueStanceFor splits the two doubtful bands at -20",
    testFile: "beliefs/labels.test.ts",
    testName: "splits the shared 'doubtful' label across two different stances",
  },
  {
    goal: "G8",
    requirement: "worked example #6: three stacked Shows cross the trust-40 gate",
    testFile: "beliefs/relationships.test.ts",
    testName: "produces exactly trust +45, suspicion -30, crossing the trust-40 gate",
  },
  {
    goal: "G8",
    requirement: "worked example #7: one broken promise",
    testFile: "beliefs/relationships.test.ts",
    testName: "produces exactly trust -40, suspicion +35 (wary)",
  },
  {
    goal: "G9",
    requirement:
      "the disclosure bundle agrees with content/validate.ts's starting-knowledge checks",
    testFile: "disclosure/bundle.test.ts",
    testName:
      "never approves the chapel location for Mara, even with every gate wide open",
  },
  {
    goal: "G10",
    requirement: "chapel access's asymmetric suspicion ceilings",
    testFile: "world/clues.test.ts",
    testName:
      "the asymmetric suspicion ceiling is intentional: 39 clears Nessa's gate but not Corin's",
  },
  {
    goal: "G11",
    requirement: "the promise-offer:v1 encoding is byte-exact per D2-E",
    testFile: "world/promises.test.ts",
    testName:
      "encodes exactly domain, source action ID, and ordinal joined by newlines",
  },
  {
    goal: "G12",
    requirement: "ambient_eligible covers all 20 EVENT_TYPES with no silent gap",
    testFile: "world/visits.test.ts",
    testName: "covers every one of the 20 EVENT_TYPES values with no silent gap",
  },
  {
    goal: "G13",
    requirement: "the four-part lie test's required negative fixtures",
    testFile: "world/lies.test.ts",
    testName:
      "mere contradiction alone never establishes a lie (no player confirmation)",
  },
  {
    goal: "G14",
    requirement: "embedding failure never widens authorization",
    testFile: "recall/scoring.test.ts",
    testName:
      "returns an empty list when embedding is unavailable, never a permissive default",
  },
  {
    goal: "G15",
    requirement: "the Mara-to-Nessa/Corin +32 hop-1 testimony fixture",
    testFile: "ambient/eligibility.test.ts",
    testName:
      "uses the Nessa->Mara and Corin->Mara trust-20 edges from content#CONTACT_EDGES",
  },
  {
    goal: "G15",
    requirement: "the six named ambient-selection failure modes",
    testFile: "ambient/selection.test.ts",
    testName: "the six failure modes each degrade only their own selection",
  },
  {
    goal: "G16",
    requirement: "exactly one bell relocation under D2-P",
    testFile: "board/case.test.ts",
    testName:
      "a concurrent or replayed loser (bell already relocated) produces no second relocation",
  },
  {
    goal: "G17",
    requirement: "the dispatch table covers all 13 ACTION_KINDS",
    testFile: "actions/dispatcher.test.ts",
    testName:
      "covers all 13 ACTION_KINDS exactly once, split between deterministic and model-backed",
  },
  {
    goal: "G18",
    requirement: "shuffled repository row order yields a byte-identical viewVersion",
    testFile: "projection/player-view.test.ts",
    testName:
      "shuffled repository row order yields byte-identical ordered output and viewVersion",
  },
  {
    goal: "G19",
    requirement: "the trust-40 gate is reachable in at most four events",
    testFile: "content-validation/reachability.test.ts",
    testName: "reaches the trust-40 gate within the four-event bound",
  },
  {
    goal: "G19",
    requirement: "Decision 009's five-item no-soft-lock checklist",
    testFile: "content-validation/solvability.test.ts",
    testName: "all five checks pass together",
  },
]);
