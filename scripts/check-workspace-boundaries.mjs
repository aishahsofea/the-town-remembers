#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";

const SCOPE = "@the-town-remembers/";
const INTERNAL_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
const SOURCE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  // Each entry under here is a separate git worktree (a separate checkout
  // with its own history), not source this repository owns.
  ".claude",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "cdk.out",
]);

export const STANDARD_EXPORTS = Object.freeze({
  ".": {
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
  },
});

export const RUNTIME_CONFIG_EXPORTS = Object.freeze({
  "./game": {
    types: "./dist/game.d.ts",
    import: "./dist/game.js",
  },
  "./ambient": {
    types: "./dist/ambient.d.ts",
    import: "./dist/ambient.js",
  },
  "./recovery": {
    types: "./dist/recovery.d.ts",
    import: "./dist/recovery.js",
  },
  "./database": {
    types: "./dist/database.d.ts",
    import: "./dist/database.js",
  },
  "./deployment": {
    types: "./dist/deployment.d.ts",
    import: "./dist/deployment.js",
  },
  "./test": {
    types: "./dist/test.d.ts",
    import: "./dist/test.js",
  },
  "./operator": {
    types: "./dist/operator.d.ts",
    import: "./dist/operator.js",
  },
  "./security": {
    types: "./dist/security.d.ts",
    import: "./dist/security.js",
  },
  "./model": {
    types: "./dist/model.d.ts",
    import: "./dist/model.js",
  },
});

export const TEST_SUPPORT_EXPORTS = Object.freeze({
  ".": {
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
  },
  "./database": {
    types: "./dist/database/index.d.ts",
    import: "./dist/database/index.js",
  },
});

export const DATABASE_EXPORTS = Object.freeze({
  ".": {
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
  },
  "./schema": {
    types: "./dist/schema.d.ts",
    import: "./dist/schema.js",
  },
  "./brands": {
    types: "./dist/brands.d.ts",
    import: "./dist/brands.js",
  },
  "./domains": {
    types: "./dist/domains.d.ts",
    import: "./dist/domains.js",
  },
});

const HTTP_CONTRACTS = `${SCOPE}http-contracts`;
const MODEL_CONTRACTS = `${SCOPE}model-contracts`;
const SERIALIZATION = `${SCOPE}serialization`;
const BROWSER_CONFIG = `${SCOPE}browser-config`;
const RUNTIME_CONFIG = `${SCOPE}runtime-config`;
const TEST_SUPPORT = `${SCOPE}test-support`;
const CONTENT = `${SCOPE}content`;
const DATABASE = `${SCOPE}database`;
const DATABASE_ADMIN = `${SCOPE}database-admin`;
const TOWN_SEED = `${SCOPE}town-seed`;
const RULES = `${SCOPE}rules`;
const GAME_SERVER = `${SCOPE}game-server`;
const GAME_API = `${SCOPE}game-api`;
const AMBIENT_WORKER = `${SCOPE}ambient-worker`;
// Not yet an EXPECTED_PACKAGES entry — scaffolded by P4-02. Referenced ahead
// of that so the model-config import boundary can land in the same commit as
// the configuration category itself (D4-C).
const MODEL_RUNTIME = `${SCOPE}model-runtime`;

export const EXPECTED_PACKAGES = Object.freeze([
  {
    path: "apps/web",
    name: `${SCOPE}web`,
    kind: "deployment",
    allowedDependencies: [HTTP_CONTRACTS, BROWSER_CONFIG],
  },
  {
    path: "apps/game-api",
    name: GAME_API,
    kind: "deployment",
    allowedDependencies: [
      HTTP_CONTRACTS,
      MODEL_CONTRACTS,
      SERIALIZATION,
      RUNTIME_CONFIG,
      GAME_SERVER,
    ],
  },
  {
    path: "apps/ambient-worker",
    name: `${SCOPE}ambient-worker`,
    kind: "deployment",
    allowedDependencies: [MODEL_CONTRACTS, SERIALIZATION, RUNTIME_CONFIG],
  },
  {
    path: "apps/recovery-worker",
    name: `${SCOPE}recovery-worker`,
    kind: "deployment",
    allowedDependencies: [RUNTIME_CONFIG],
  },
  {
    path: "infrastructure",
    name: `${SCOPE}infrastructure`,
    kind: "deployment",
    allowedDependencies: [RUNTIME_CONFIG],
  },
  {
    path: "packages/http-contracts",
    name: HTTP_CONTRACTS,
    kind: "library",
    exports: STANDARD_EXPORTS,
    allowedDependencies: [],
  },
  {
    path: "packages/model-contracts",
    name: MODEL_CONTRACTS,
    kind: "library",
    exports: STANDARD_EXPORTS,
    allowedDependencies: [],
  },
  {
    path: "packages/serialization",
    name: SERIALIZATION,
    kind: "library",
    exports: STANDARD_EXPORTS,
    allowedDependencies: [],
  },
  {
    path: "packages/browser-config",
    name: BROWSER_CONFIG,
    kind: "library",
    exports: STANDARD_EXPORTS,
    allowedDependencies: [],
  },
  {
    path: "packages/runtime-config",
    name: RUNTIME_CONFIG,
    kind: "library",
    exports: RUNTIME_CONFIG_EXPORTS,
    allowedDependencies: [],
  },
  {
    path: "packages/content",
    name: CONTENT,
    kind: "library",
    exports: STANDARD_EXPORTS,
    allowedDependencies: [SERIALIZATION],
  },
  {
    path: "packages/database",
    name: DATABASE,
    kind: "library",
    exports: DATABASE_EXPORTS,
    allowedDependencies: [SERIALIZATION, RUNTIME_CONFIG],
  },
  {
    path: "packages/rules",
    name: RULES,
    kind: "library",
    exports: STANDARD_EXPORTS,
    allowedDependencies: [
      CONTENT,
      DATABASE,
      HTTP_CONTRACTS,
      MODEL_CONTRACTS,
      SERIALIZATION,
    ],
  },
  {
    path: "packages/database-admin",
    name: DATABASE_ADMIN,
    kind: "library",
    exports: STANDARD_EXPORTS,
    allowedDependencies: [DATABASE, SERIALIZATION, RUNTIME_CONFIG],
  },
  {
    path: "packages/town-seed",
    name: TOWN_SEED,
    kind: "library",
    exports: STANDARD_EXPORTS,
    allowedDependencies: [CONTENT, DATABASE, DATABASE_ADMIN, SERIALIZATION],
  },
  {
    path: "packages/game-server",
    name: GAME_SERVER,
    kind: "library",
    exports: STANDARD_EXPORTS,
    allowedDependencies: [
      CONTENT,
      DATABASE,
      HTTP_CONTRACTS,
      RULES,
      RUNTIME_CONFIG,
      SERIALIZATION,
      TOWN_SEED,
    ],
  },
  {
    path: "packages/test-support",
    name: TEST_SUPPORT,
    kind: "library",
    exports: TEST_SUPPORT_EXPORTS,
    allowedDependencies: [
      HTTP_CONTRACTS,
      MODEL_CONTRACTS,
      SERIALIZATION,
      BROWSER_CONFIG,
      RUNTIME_CONFIG,
      CONTENT,
      DATABASE,
      DATABASE_ADMIN,
    ],
  },
]);

const EXPECTED_WORKSPACE_GLOBS = ["apps/*", "packages/*", "infrastructure"];
const EXPECTED_IMPORTERS = [".", ...EXPECTED_PACKAGES.map((entry) => entry.path)];

function addViolation(violations, code, message, filePath) {
  violations.push({ code, message, ...(filePath ? { path: filePath } : {}) });
}

function readJson(filePath, violations) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    addViolation(
      violations,
      "invalid_json",
      `Could not parse JSON: ${error.message}`,
      filePath,
    );
    return undefined;
  }
}

function walkFiles(directory, predicate) {
  if (!fs.existsSync(directory)) return [];

  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath, predicate));
    } else if (entry.isFile() && predicate(entryPath)) {
      files.push(entryPath);
    }
  }
  return files;
}

function parseWorkspaceGlobs(contents) {
  const lines = contents.split(/\r?\n/);
  const packagesIndex = lines.findIndex((line) => line.trim() === "packages:");
  if (packagesIndex === -1) return [];

  const globs = [];
  for (const line of lines.slice(packagesIndex + 1)) {
    const match = line.match(/^\s+-\s+(.+?)\s*$/);
    if (match) {
      globs.push(match[1].replace(/^['"]|['"]$/g, ""));
      continue;
    }
    if (line.trim() !== "") break;
  }
  return globs;
}

function parseLockfileImporters(contents) {
  const lines = contents.split(/\r?\n/);
  const importersIndex = lines.findIndex((line) => line.trim() === "importers:");
  if (importersIndex === -1) return [];

  const importers = [];
  for (const line of lines.slice(importersIndex + 1)) {
    if (line.trim() === "") continue;
    if (!line.startsWith(" ")) break;

    const match = line.match(/^ {2}([^\s][^:]*):(?:\s|$)/);
    if (match) importers.push(match[1].replace(/^['"]|['"]$/g, ""));
  }
  return importers;
}

function getInternalPackageName(specifier) {
  if (!specifier.startsWith(SCOPE)) return undefined;
  return specifier.split("/").slice(0, 2).join("/");
}

function collectSpecifiers(contents) {
  const specifiers = [];
  const patterns = [
    /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
    /require\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of contents.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

function findDeclaredSection(manifest, dependencyName) {
  return INTERNAL_SECTIONS.find((section) => manifest[section]?.[dependencyName]);
}

function isAllowedDependency(packageDefinition, dependencyName, section) {
  if (dependencyName === TEST_SUPPORT) {
    return packageDefinition.name !== TEST_SUPPORT && section === "devDependencies";
  }
  return packageDefinition.allowedDependencies.includes(dependencyName);
}

function validateRuntimeConfigImport(
  packageDefinition,
  specifier,
  violations,
  filePath,
) {
  if (!specifier.startsWith(`${RUNTIME_CONFIG}/`) && specifier !== RUNTIME_CONFIG) {
    return;
  }

  const expectedByConsumer = new Map([
    [
      GAME_API,
      [
        `${RUNTIME_CONFIG}/game`,
        `${RUNTIME_CONFIG}/security`,
        `${RUNTIME_CONFIG}/model`,
      ],
    ],
    [
      GAME_SERVER,
      [
        `${RUNTIME_CONFIG}/game`,
        `${RUNTIME_CONFIG}/security`,
        `${RUNTIME_CONFIG}/model`,
      ],
    ],
    [AMBIENT_WORKER, [`${RUNTIME_CONFIG}/ambient`, `${RUNTIME_CONFIG}/model`]],
    [`${SCOPE}recovery-worker`, [`${RUNTIME_CONFIG}/recovery`]],
    [`${SCOPE}infrastructure`, [`${RUNTIME_CONFIG}/deployment`]],
    [TEST_SUPPORT, [`${RUNTIME_CONFIG}/test`]],
    [DATABASE, [`${RUNTIME_CONFIG}/database`]],
    [DATABASE_ADMIN, [`${RUNTIME_CONFIG}/operator`]],
    [MODEL_RUNTIME, [`${RUNTIME_CONFIG}/model`]],
  ]);
  const expected = expectedByConsumer.get(packageDefinition.name);
  if (expected && !expected.includes(specifier)) {
    addViolation(
      violations,
      "invalid_runtime_config_import",
      `${packageDefinition.name} must import runtime configuration through ${expected.join(" or ")}.`,
      filePath,
    );
  }
}

const FORBIDDEN_DATABASE_SPECIFIERS_FOR_RULES = new Set([
  DATABASE,
  `${DATABASE}/client`,
  `${DATABASE}/transaction`,
  `${DATABASE}/errors`,
]);

/**
 * `packages/rules` must stay free of a real database client (§1.1 of the
 * Phase 2 execution plan): it may only import the type/constant subpaths
 * `./schema`, `./brands`, `./domains`, never the bare specifier or
 * `./client`/`./transaction`/`./errors`.
 */
function validateRulesDatabaseImport(
  packageDefinition,
  specifier,
  violations,
  filePath,
) {
  if (packageDefinition.name !== RULES) return;
  if (!FORBIDDEN_DATABASE_SPECIFIERS_FOR_RULES.has(specifier)) return;

  addViolation(
    violations,
    "forbidden_rules_database_import",
    `${RULES} may only import ${DATABASE}/schema, ${DATABASE}/brands, or ${DATABASE}/domains.`,
    filePath,
  );
}

const SECURITY_CONFIG_SPECIFIER = `${RUNTIME_CONFIG}/security`;
const SECURITY_CONFIG_ALLOWED_PACKAGES = new Set([GAME_SERVER, GAME_API]);

/**
 * `runtime-config/security` (D3-C) holds the judge code, invite-derivation
 * keys, session-token pepper, and IP-hash secret. Only the two units on the
 * request path that need them may import it; every other package — most
 * importantly `apps/web` and the ambient/recovery workers — has no import
 * path to it even by accident.
 */
function validateSecurityConfigImport(
  packageDefinition,
  specifier,
  violations,
  filePath,
) {
  if (specifier !== SECURITY_CONFIG_SPECIFIER) return;
  if (SECURITY_CONFIG_ALLOWED_PACKAGES.has(packageDefinition.name)) return;

  addViolation(
    violations,
    "forbidden_security_config_import",
    `${SECURITY_CONFIG_SPECIFIER} may only be imported by ${GAME_SERVER} or ${GAME_API}.`,
    filePath,
  );
}

const MODEL_CONFIG_SPECIFIER = `${RUNTIME_CONFIG}/model`;
const MODEL_CONFIG_ALLOWED_PACKAGES = new Set([
  MODEL_RUNTIME,
  GAME_SERVER,
  GAME_API,
  AMBIENT_WORKER,
]);

/**
 * `runtime-config/model` (`D4-C`) carries no credential, but it still names
 * the only packages that call a model. Only they may import it — most
 * importantly `apps/web` and `packages/rules` have no import path to it even
 * by accident, matching `D4-A`'s "no model dependency in the browser or the
 * pure rules layer" boundary.
 */
function validateModelConfigImport(packageDefinition, specifier, violations, filePath) {
  if (specifier !== MODEL_CONFIG_SPECIFIER) return;
  if (MODEL_CONFIG_ALLOWED_PACKAGES.has(packageDefinition.name)) return;

  addViolation(
    violations,
    "forbidden_model_config_import",
    `${MODEL_CONFIG_SPECIFIER} may only be imported by ${MODEL_RUNTIME}, ${GAME_SERVER}, ${GAME_API}, or ${AMBIENT_WORKER}.`,
    filePath,
  );
}

function validateManifest(
  rootDir,
  packageDefinition,
  manifest,
  internalNames,
  violations,
) {
  const manifestPath = path.join(rootDir, packageDefinition.path, "package.json");
  const requiredFields = {
    name: packageDefinition.name,
    version: "0.0.0",
    private: true,
    license: "MIT",
  };

  for (const [field, expected] of Object.entries(requiredFields)) {
    if (manifest[field] !== expected) {
      addViolation(
        violations,
        `invalid_package_${field}`,
        `${packageDefinition.path} must set ${field} to ${JSON.stringify(expected)}.`,
        manifestPath,
      );
    }
  }

  if (packageDefinition.kind === "deployment") {
    if ("exports" in manifest) {
      addViolation(
        violations,
        "deployment_exports",
        `${packageDefinition.path} is a deployment unit and must not publish exports.`,
        manifestPath,
      );
    }
  } else if (!isDeepStrictEqual(manifest.exports, packageDefinition.exports)) {
    addViolation(
      violations,
      "invalid_exports",
      `${packageDefinition.path} must expose only its declared dist outputs.`,
      manifestPath,
    );
  }

  for (const section of INTERNAL_SECTIONS) {
    for (const [dependencyName, version] of Object.entries(manifest[section] ?? {})) {
      if (!internalNames.has(dependencyName)) continue;

      if (version !== "workspace:*") {
        addViolation(
          violations,
          "invalid_workspace_protocol",
          `${dependencyName} in ${section} must use workspace:* instead of ${version}.`,
          manifestPath,
        );
      }

      if (dependencyName === TEST_SUPPORT && section !== "devDependencies") {
        addViolation(
          violations,
          "forbidden_test_support_dependency",
          `${TEST_SUPPORT} may only be referenced from devDependencies.`,
          manifestPath,
        );
      } else if (!isAllowedDependency(packageDefinition, dependencyName, section)) {
        addViolation(
          violations,
          "forbidden_dependency",
          `${packageDefinition.name} may not depend on ${dependencyName}.`,
          manifestPath,
        );
      }
    }
  }
}

function validateSourceImports(
  rootDir,
  packageDefinition,
  manifest,
  definitionsByName,
  definitionsByPath,
  violations,
) {
  const packageRoot = path.join(rootDir, packageDefinition.path);
  const sourceFiles = walkFiles(packageRoot, (filePath) =>
    SOURCE_EXTENSIONS.has(path.extname(filePath)),
  );

  for (const sourceFile of sourceFiles) {
    const contents = fs.readFileSync(sourceFile, "utf8");
    for (const specifier of collectSpecifiers(contents)) {
      if (specifier.startsWith(".")) {
        const resolved = path.resolve(path.dirname(sourceFile), specifier);
        for (const [packagePath, otherDefinition] of definitionsByPath) {
          if (otherDefinition.name === packageDefinition.name) continue;
          const otherRoot = path.join(rootDir, packagePath);
          if (
            resolved === otherRoot ||
            resolved.startsWith(`${otherRoot}${path.sep}`)
          ) {
            addViolation(
              violations,
              "cross_package_relative_import",
              `${packageDefinition.name} must import ${otherDefinition.name} by package name.`,
              sourceFile,
            );
          }
        }
        continue;
      }

      const dependencyName = getInternalPackageName(specifier);
      if (!dependencyName || dependencyName === packageDefinition.name) continue;

      const dependencyDefinition = definitionsByName.get(dependencyName);
      if (!dependencyDefinition) {
        addViolation(
          violations,
          "unknown_internal_import",
          `${specifier} uses the repository scope but is not a workspace package.`,
          sourceFile,
        );
        continue;
      }

      const section = findDeclaredSection(manifest, dependencyName);
      if (!section) {
        addViolation(
          violations,
          "undeclared_internal_import",
          `${packageDefinition.name} imports ${dependencyName} without declaring it.`,
          sourceFile,
        );
      } else if (!isAllowedDependency(packageDefinition, dependencyName, section)) {
        addViolation(
          violations,
          "forbidden_dependency",
          `${packageDefinition.name} may not import ${dependencyName}.`,
          sourceFile,
        );
      }

      validateRuntimeConfigImport(packageDefinition, specifier, violations, sourceFile);
      validateRulesDatabaseImport(packageDefinition, specifier, violations, sourceFile);
      validateSecurityConfigImport(
        packageDefinition,
        specifier,
        violations,
        sourceFile,
      );
      validateModelConfigImport(packageDefinition, specifier, violations, sourceFile);
    }
  }
}

export function validateWorkspace(rootDir) {
  const resolvedRoot = path.resolve(rootDir);
  const violations = [];
  const definitionsByName = new Map(
    EXPECTED_PACKAGES.map((entry) => [entry.name, entry]),
  );
  const definitionsByPath = new Map(
    EXPECTED_PACKAGES.map((entry) => [entry.path, entry]),
  );
  const internalNames = new Set(definitionsByName.keys());
  const manifests = new Map();

  const workspacePath = path.join(resolvedRoot, "pnpm-workspace.yaml");
  if (!fs.existsSync(workspacePath)) {
    addViolation(
      violations,
      "missing_workspace_config",
      "pnpm-workspace.yaml is required.",
      workspacePath,
    );
  } else {
    const actualGlobs = parseWorkspaceGlobs(fs.readFileSync(workspacePath, "utf8"));
    if (!isDeepStrictEqual(actualGlobs, EXPECTED_WORKSPACE_GLOBS)) {
      addViolation(
        violations,
        "invalid_workspace_globs",
        `Workspace packages must be: ${EXPECTED_WORKSPACE_GLOBS.join(", ")}.`,
        workspacePath,
      );
    }
  }

  const lockfilePath = path.join(resolvedRoot, "pnpm-lock.yaml");
  if (!fs.existsSync(lockfilePath)) {
    addViolation(
      violations,
      "missing_lockfile",
      "pnpm-lock.yaml is required.",
      lockfilePath,
    );
  } else {
    const actualImporters = parseLockfileImporters(
      fs.readFileSync(lockfilePath, "utf8"),
    ).sort();
    const expectedImporters = [...EXPECTED_IMPORTERS].sort();
    if (!isDeepStrictEqual(actualImporters, expectedImporters)) {
      addViolation(
        violations,
        "invalid_lockfile_importers",
        "The lockfile must contain the root and every declared workspace package.",
        lockfilePath,
      );
    }
  }

  const discoveredManifestPaths = walkFiles(
    resolvedRoot,
    (filePath) => path.basename(filePath) === "package.json",
  ).map((filePath) => path.relative(resolvedRoot, filePath).split(path.sep).join("/"));
  const expectedManifestPaths = new Set([
    "package.json",
    ...EXPECTED_PACKAGES.map((entry) => `${entry.path}/package.json`),
  ]);
  for (const manifestPath of discoveredManifestPaths) {
    if (!expectedManifestPaths.has(manifestPath)) {
      addViolation(
        violations,
        "unexpected_package_manifest",
        `${manifestPath} is not a declared workspace package.`,
        path.join(resolvedRoot, manifestPath),
      );
    }
  }

  for (const packageDefinition of EXPECTED_PACKAGES) {
    const manifestPath = path.join(
      resolvedRoot,
      packageDefinition.path,
      "package.json",
    );
    if (!fs.existsSync(manifestPath)) {
      addViolation(
        violations,
        "missing_package_manifest",
        `${packageDefinition.path} is missing package.json.`,
        manifestPath,
      );
      continue;
    }

    const manifest = readJson(manifestPath, violations);
    if (!manifest) continue;
    manifests.set(packageDefinition.name, manifest);
    validateManifest(
      resolvedRoot,
      packageDefinition,
      manifest,
      internalNames,
      violations,
    );
  }

  const seenNames = new Map();
  for (const packageDefinition of EXPECTED_PACKAGES) {
    const manifest = manifests.get(packageDefinition.name);
    if (!manifest?.name) continue;
    const previousPath = seenNames.get(manifest.name);
    if (previousPath) {
      addViolation(
        violations,
        "duplicate_package_name",
        `${manifest.name} is used by both ${previousPath} and ${packageDefinition.path}.`,
        path.join(resolvedRoot, packageDefinition.path, "package.json"),
      );
    } else {
      seenNames.set(manifest.name, packageDefinition.path);
    }
  }

  for (const packageDefinition of EXPECTED_PACKAGES) {
    const manifest = manifests.get(packageDefinition.name);
    if (!manifest) continue;
    validateSourceImports(
      resolvedRoot,
      packageDefinition,
      manifest,
      definitionsByName,
      definitionsByPath,
      violations,
    );
  }

  return violations.sort((left, right) =>
    `${left.path ?? ""}:${left.code}:${left.message}`.localeCompare(
      `${right.path ?? ""}:${right.code}:${right.message}`,
    ),
  );
}

function runCli() {
  const rootDir = process.argv[2] ?? process.cwd();
  const violations = validateWorkspace(rootDir);
  if (violations.length === 0) {
    console.log("Workspace boundaries are valid.");
    return;
  }

  console.error(
    `Workspace boundary check failed with ${violations.length} violation(s):`,
  );
  for (const violation of violations) {
    const location = violation.path
      ? ` (${path.relative(rootDir, violation.path)})`
      : "";
    console.error(`- [${violation.code}] ${violation.message}${location}`);
  }
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  runCli();
}
