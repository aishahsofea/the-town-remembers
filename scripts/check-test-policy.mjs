#!/usr/bin/env node

/**
 * The single deterministic gate for docs/agents/testing-policy.md. Combines
 * claim-ledger schema/ownership validation, eval-corpus schema validation,
 * adapter synchronization, the direct-disposable-database allowlist, and
 * legacy-baseline drift (which doubles as the test/setup count budget: any
 * change to what is on disk that isn't already reflected in the ledger or
 * the committed baseline fails until a human explicitly regenerates and
 * reviews the baseline). Starts no database, browser, or model
 * infrastructure and reports every violation from one run.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { REPOSITORY_ROOT } from "./local-env.mjs";
import { ISOLATED_FILES } from "./database-test-classification.mjs";
import { buildBaseline } from "./generate-legacy-baseline.mjs";
import { validateAllScenarios } from "./test-policy-evals.mjs";
import {
  ADAPTERS,
  buildGeneratedBlock,
  checkAdapterContent,
  computeChecksum,
  extractCoreBlock,
} from "./sync-agent-test-policy.mjs";

const BOUNDARIES = new Set([
  "typecheck",
  "pure function",
  "component/hook",
  "API/application",
  "database",
  "real socket",
  "browser",
  "deployed/live",
]);
const SETUPS = new Set([
  "none",
  "typecheck",
  "filesystem",
  "dom",
  "socket",
  "db-shared",
  "db-isolated",
  "browser",
  "model-live",
  "cloud-live",
]);
const EXPENSIVE_SETUPS = new Set([
  "db-isolated",
  "browser",
  "model-live",
  "cloud-live",
]);
const ID_PATTERN = /^V-[A-Z][A-Z0-9-]*$/;
const REJECTED_UNIQUE_PROOF_PHRASES = [
  "extra confidence",
  "comprehensive coverage",
  "end-to-end coverage",
  "more confidence",
  "just in case",
];

/** Files legitimately allowed to call `createDisposableDatabase()` directly
 * (TG-08): the harness that defines it, the two global-setup call sites, and
 * the reviewed isolated-schema/isolated-concurrency test files. */
function isolationAllowlist() {
  return new Set([
    "packages/test-support/src/database/harness.ts",
    "scripts/vitest-database-setup.mjs",
    "playwright.config.ts",
    ...Object.keys(ISOLATED_FILES),
  ]);
}

function violation(ruleId, message, extra = {}) {
  return { ruleId, message, ...extra };
}

function checkClaimsLedger(rootDir) {
  const violations = [];
  const ledger = JSON.parse(
    fs.readFileSync(path.join(rootDir, "verification/test-claims.json"), "utf8"),
  );
  if (ledger.schemaVersion !== 1) {
    violations.push(
      violation("TG-SCHEMA", "verification/test-claims.json schemaVersion must be 1"),
    );
  }

  const seenIds = new Set();
  const primaryOwnership = new Map();

  for (const claim of ledger.claims ?? []) {
    const claimId = claim.id;
    const ctx = { claimId, file: "verification/test-claims.json" };

    if (typeof claimId !== "string" || !ID_PATTERN.test(claimId)) {
      violations.push(
        violation("TG-02", `claim id "${claimId}" must match ${ID_PATTERN}`, ctx),
      );
    } else if (seenIds.has(claimId)) {
      violations.push(violation("TG-02", `duplicate claim id "${claimId}"`, ctx));
    } else {
      seenIds.add(claimId);
    }

    if (typeof claim.requirement !== "string" || claim.requirement.length === 0) {
      violations.push(
        violation("TG-SCHEMA", `claim "${claimId}" is missing a requirement`, ctx),
      );
    }
    if (!Array.isArray(claim.cases) || claim.cases.length === 0) {
      violations.push(
        violation("TG-06", `claim "${claimId}" must list at least one case`, ctx),
      );
    }
    if (!SETUPS.has(claim.setup)) {
      violations.push(
        violation(
          "TG-08",
          `claim "${claimId}" has unknown setup "${claim.setup}"`,
          ctx,
        ),
      );
    }
    if (
      EXPENSIVE_SETUPS.has(claim.setup) &&
      (!claim.isolationReason || claim.isolationReason.length === 0)
    ) {
      violations.push(
        violation(
          "TG-08",
          `claim "${claimId}" uses expensive setup "${claim.setup}" but records no isolationReason`,
          ctx,
        ),
      );
    }
    if (typeof claim.source !== "string" || claim.source.length === 0) {
      violations.push(
        violation("TG-SCHEMA", `claim "${claimId}" is missing a source`, ctx),
      );
    }

    const primary = claim.primary ?? {};
    if (!BOUNDARIES.has(primary.boundary)) {
      violations.push(
        violation(
          "TG-03",
          `claim "${claimId}" primary has unknown boundary "${primary.boundary}"`,
          ctx,
        ),
      );
    }
    checkOwnerResolves(rootDir, claimId, primary, violations);

    const ownerKey = `${primary.file} :: ${primary.test}`;
    if (primaryOwnership.has(ownerKey) && primaryOwnership.get(ownerKey) !== claimId) {
      violations.push(
        violation(
          "TG-02",
          `"${primary.file}" test "${primary.test}" is claimed as primary owner by both ` +
            `"${primaryOwnership.get(ownerKey)}" and "${claimId}"`,
          ctx,
        ),
      );
    }
    primaryOwnership.set(ownerKey, claimId);

    for (const secondary of claim.secondary ?? []) {
      if (!BOUNDARIES.has(secondary.boundary)) {
        violations.push(
          violation(
            "TG-03",
            `claim "${claimId}" secondary has unknown boundary "${secondary.boundary}"`,
            ctx,
          ),
        );
      }
      if (
        typeof secondary.uniqueProof !== "string" ||
        secondary.uniqueProof.length === 0
      ) {
        violations.push(
          violation(
            "TG-04",
            `claim "${claimId}" secondary owner is missing uniqueProof`,
            ctx,
          ),
        );
      } else {
        const normalized = secondary.uniqueProof.toLowerCase();
        for (const phrase of REJECTED_UNIQUE_PROOF_PHRASES) {
          if (normalized.includes(phrase)) {
            violations.push(
              violation(
                "TG-04",
                `claim "${claimId}" secondary uniqueProof relies on the generic phrase "${phrase}", ` +
                  "not a distinct observable property",
                ctx,
              ),
            );
          }
        }
      }
      checkOwnerResolves(rootDir, claimId, secondary, violations);
    }
  }

  return violations;
}

function checkOwnerResolves(rootDir, claimId, owner, violations) {
  if (!owner.file || !owner.test) return;
  const filePath = path.join(rootDir, owner.file);
  if (!fs.existsSync(filePath)) {
    violations.push(
      violation(
        "TG-TRACE",
        `claim "${claimId}" points at "${owner.file}", which does not exist`,
        {
          claimId,
          file: owner.file,
        },
      ),
    );
    return;
  }
  const contents = fs.readFileSync(filePath, "utf8");
  if (!contents.includes(owner.test)) {
    violations.push(
      violation(
        "TG-TRACE",
        `claim "${claimId}" points at "${owner.file}" for test "${owner.test}", which was not found in that file`,
        { claimId, file: owner.file },
      ),
    );
  }
}

function checkEvalCorpus(rootDir) {
  return validateAllScenarios(path.join(rootDir, "verification/test-policy-evals")).map(
    (message) =>
      violation("TAG-01-SCHEMA", message, { file: "verification/test-policy-evals" }),
  );
}

function checkAdapterSync(rootDir) {
  const policyMarkdown = fs.readFileSync(
    path.join(rootDir, "docs/agents/testing-policy.md"),
    "utf8",
  );
  const coreBlockText = extractCoreBlock(policyMarkdown);
  const checksum = computeChecksum(coreBlockText);
  const generatedBlock = buildGeneratedBlock(coreBlockText, checksum);

  const violations = [];
  for (const adapter of ADAPTERS) {
    const relativePath = path.relative(REPOSITORY_ROOT, adapter.path);
    const adapterPath = path.join(rootDir, relativePath);
    const content = fs.existsSync(adapterPath)
      ? fs.readFileSync(adapterPath, "utf8")
      : "";
    const result = checkAdapterContent(content, generatedBlock);
    if (!result.ok) {
      violations.push(
        violation(
          "ADAPTER-SYNC",
          `${relativePath}: ${result.reason} (run sync-agent-test-policy.mjs --write)`,
          {
            file: relativePath,
          },
        ),
      );
    }
  }
  return violations;
}

/** Directories where a real `createDisposableDatabase()` call site could
 * appear. `scripts/` is deliberately excluded: this repo's tooling scripts
 * reference the identifier as a string/regex literal (to classify or
 * generate reports about database tests), not as an actual call. */
const ISOLATION_SCAN_ROOTS = ["packages", "apps", "e2e"];
const ISOLATION_SCAN_ROOT_FILES = ["playwright.config.ts", "vitest.config.ts"];

function checkIsolationAllowlist(rootDir) {
  const allowlist = isolationAllowlist();
  const violations = [];
  const candidates = [
    ...ISOLATION_SCAN_ROOTS.flatMap((dir) =>
      fs.existsSync(path.join(rootDir, dir))
        ? [...walkSourceFiles(rootDir, path.join(rootDir, dir))]
        : [],
    ),
    ...ISOLATION_SCAN_ROOT_FILES.filter((file) =>
      fs.existsSync(path.join(rootDir, file)),
    ).map((file) => [file, fs.readFileSync(path.join(rootDir, file), "utf8")]),
  ];
  for (const [relativePath, contents] of candidates) {
    if (allowlist.has(relativePath)) continue;
    const lines = contents.split("\n");
    for (const [index, line] of lines.entries()) {
      const trimmed = line.trim();
      if (
        trimmed.startsWith("//") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("/*")
      )
        continue;
      if (line.includes("createDisposableDatabase(")) {
        violations.push(
          violation(
            "TG-08",
            `${relativePath}:${index + 1} calls createDisposableDatabase() outside the reviewed ` +
              "isolation allowlist; use the shared fixture or add this file to the allowlist with a reason",
            { file: relativePath },
          ),
        );
      }
    }
  }
  return violations;
}

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".js"]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".claude",
  ".codegraph",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "cdk.out",
  "test-results",
  "playwright-report",
]);

function* walkSourceFiles(rootDir, directory = rootDir) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      yield* walkSourceFiles(rootDir, path.join(directory, entry.name));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    const filePath = path.join(directory, entry.name);
    const relativePath = path.relative(rootDir, filePath).split(path.sep).join("/");
    yield [relativePath, fs.readFileSync(filePath, "utf8")];
  }
}

function checkLegacyBaseline(rootDir) {
  const baselinePath = path.join(rootDir, "verification/legacy-test-baseline.json");
  const claimsPath = path.join(rootDir, "verification/test-claims.json");
  const computed = buildBaseline(rootDir, claimsPath);
  const serialized = `${JSON.stringify(computed, null, 2)}\n`;
  const existing = fs.existsSync(baselinePath)
    ? fs.readFileSync(baselinePath, "utf8")
    : null;

  if (existing === serialized) return [];

  if (existing === null) {
    return [
      violation(
        "TG-GOVERNANCE-BASELINE",
        "verification/legacy-test-baseline.json does not exist",
        {
          file: "verification/legacy-test-baseline.json",
        },
      ),
    ];
  }

  const existingDeclarations = new Set(
    (JSON.parse(existing).declarations ?? []).map((d) => `${d.file} :: ${d.test}`),
  );
  const newlyUngoverned = computed.declarations.filter(
    (d) => !existingDeclarations.has(`${d.file} :: ${d.test}`),
  );

  const message =
    newlyUngoverned.length > 0
      ? `${newlyUngoverned.length} new ungoverned test declaration(s) are neither in ` +
        "verification/test-claims.json nor verification/legacy-test-baseline.json " +
        `(e.g. "${newlyUngoverned[0].file}" :: "${newlyUngoverned[0].test}"). Add a governed claim, or run ` +
        "`node scripts/generate-legacy-baseline.mjs --write` and review the diff if this is a legitimate " +
        "legacy addition."
      : "verification/legacy-test-baseline.json is stale relative to what is on disk (declarations were " +
        "removed or renamed). Run `node scripts/generate-legacy-baseline.mjs --write` and review the diff.";

  return [
    violation("TG-GOVERNANCE-BASELINE", message, {
      file: "verification/legacy-test-baseline.json",
    }),
  ];
}

export function checkTestPolicy(rootDir = REPOSITORY_ROOT) {
  return [
    ...checkEvalCorpus(rootDir),
    ...checkClaimsLedger(rootDir),
    ...checkAdapterSync(rootDir),
    ...checkIsolationAllowlist(rootDir),
    ...checkLegacyBaseline(rootDir),
  ];
}

function runCli() {
  const violations = checkTestPolicy();
  if (violations.length === 0) {
    console.log("Test policy check passed: no violations found.");
    return;
  }
  console.error(`Test policy check failed with ${violations.length} violation(s):`);
  for (const v of violations) {
    const location = v.file ? ` [${v.file}]` : "";
    const claim = v.claimId ? ` (${v.claimId})` : "";
    console.error(`- ${v.ruleId}${claim}${location}: ${v.message}`);
  }
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  runCli();
}
