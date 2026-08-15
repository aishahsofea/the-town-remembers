import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { EXPECTED_PACKAGES, validateWorkspace } from "./check-workspace-boundaries.mjs";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createValidFixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "town-workspace-"));
  temporaryDirectories.push(rootDir);

  writeJson(path.join(rootDir, "package.json"), {
    name: "the-town-remembers",
    version: "0.0.0",
    private: true,
    license: "MIT",
  });
  fs.writeFileSync(
    path.join(rootDir, "pnpm-workspace.yaml"),
    [
      "packages:",
      "  - apps/*",
      "  - packages/*",
      "  - infrastructure",
      "",
      "nodeVersion: 24.18.0",
      "engineStrict: true",
      "pmOnFail: error",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(rootDir, "pnpm-lock.yaml"),
    [
      "lockfileVersion: '9.0'",
      "",
      "importers:",
      "",
      "  .: {}",
      ...EXPECTED_PACKAGES.map((entry) => `  ${entry.path}: {}`),
      "",
    ].join("\n"),
  );

  for (const definition of EXPECTED_PACKAGES) {
    const manifest = {
      name: definition.name,
      version: "0.0.0",
      private: true,
      license: "MIT",
    };
    if (definition.exports) {
      manifest.exports = structuredClone(definition.exports);
    }
    writeJson(path.join(rootDir, definition.path, "package.json"), manifest);
  }

  return rootDir;
}

function mutateManifest(rootDir, packagePath, mutate) {
  const manifestPath = path.join(rootDir, packagePath, "package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  mutate(manifest);
  writeJson(manifestPath, manifest);
}

function assertViolation(rootDir, code) {
  const violations = validateWorkspace(rootDir);
  assert.ok(
    violations.some((violation) => violation.code === code),
    `Expected ${code}; received ${JSON.stringify(violations, null, 2)}`,
  );
}

test("accepts the declared workspace skeleton", () => {
  const rootDir = createValidFixture();
  assert.deepEqual(validateWorkspace(rootDir), []);
});

test("rejects a web dependency on server runtime configuration", () => {
  const rootDir = createValidFixture();
  mutateManifest(rootDir, "apps/web", (manifest) => {
    manifest.dependencies = {
      "@the-town-remembers/runtime-config": "workspace:*",
    };
  });

  assertViolation(rootDir, "forbidden_dependency");
});

test("rejects dependencies between application deployment units", () => {
  const rootDir = createValidFixture();
  mutateManifest(rootDir, "apps/web", (manifest) => {
    manifest.dependencies = {
      "@the-town-remembers/game-api": "workspace:*",
    };
  });

  assertViolation(rootDir, "forbidden_dependency");
});

test("allows test support only as a development dependency", () => {
  const rootDir = createValidFixture();
  mutateManifest(rootDir, "apps/game-api", (manifest) => {
    manifest.dependencies = {
      "@the-town-remembers/test-support": "workspace:*",
    };
  });

  assertViolation(rootDir, "forbidden_test_support_dependency");
});

test("accepts test support as a workspace development dependency", () => {
  const rootDir = createValidFixture();
  mutateManifest(rootDir, "apps/game-api", (manifest) => {
    manifest.devDependencies = {
      "@the-town-remembers/test-support": "workspace:*",
    };
  });

  assert.deepEqual(validateWorkspace(rootDir), []);
});

test("requires workspace protocol for internal dependencies", () => {
  const rootDir = createValidFixture();
  mutateManifest(rootDir, "apps/web", (manifest) => {
    manifest.dependencies = {
      "@the-town-remembers/http-contracts": "0.0.0",
    };
  });

  assertViolation(rootDir, "invalid_workspace_protocol");
});

test("rejects relative imports across package roots", () => {
  const rootDir = createValidFixture();
  const sourcePath = path.join(rootDir, "apps/web/src/bad.ts");
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(
    sourcePath,
    'export { contract } from "../../../packages/http-contracts/src/index.js";\n',
  );

  assertViolation(rootDir, "cross_package_relative_import");
});

test("rejects runtime configuration imported through the wrong role", () => {
  const rootDir = createValidFixture();
  mutateManifest(rootDir, "infrastructure", (manifest) => {
    manifest.dependencies = {
      "@the-town-remembers/runtime-config": "workspace:*",
    };
  });
  const sourcePath = path.join(rootDir, "infrastructure/src/config.ts");
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(
    sourcePath,
    'import "@the-town-remembers/runtime-config/operator";\n',
  );

  assertViolation(rootDir, "invalid_runtime_config_import");
});

test("rejects security configuration imported outside game-server and game-api", () => {
  const rootDir = createValidFixture();
  mutateManifest(rootDir, "infrastructure", (manifest) => {
    manifest.dependencies = {
      "@the-town-remembers/runtime-config": "workspace:*",
    };
  });
  const sourcePath = path.join(rootDir, "infrastructure/src/config.ts");
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(
    sourcePath,
    'import "@the-town-remembers/runtime-config/security";\n',
  );

  assertViolation(rootDir, "forbidden_security_config_import");
});

test("accepts security configuration imported by game-api", () => {
  const rootDir = createValidFixture();
  mutateManifest(rootDir, "apps/game-api", (manifest) => {
    manifest.dependencies = {
      "@the-town-remembers/runtime-config": "workspace:*",
    };
  });
  const sourcePath = path.join(rootDir, "apps/game-api/src/config.ts");
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(
    sourcePath,
    'import "@the-town-remembers/runtime-config/security";\n',
  );

  assert.deepEqual(validateWorkspace(rootDir), []);
});

test("rejects model configuration imported outside its allowed packages", () => {
  const rootDir = createValidFixture();
  mutateManifest(rootDir, "infrastructure", (manifest) => {
    manifest.dependencies = {
      "@the-town-remembers/runtime-config": "workspace:*",
    };
  });
  const sourcePath = path.join(rootDir, "infrastructure/src/config.ts");
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, 'import "@the-town-remembers/runtime-config/model";\n');

  assertViolation(rootDir, "forbidden_model_config_import");
});

test("accepts model configuration imported by game-server and the ambient worker", () => {
  const rootDir = createValidFixture();
  mutateManifest(rootDir, "packages/game-server", (manifest) => {
    manifest.dependencies = {
      "@the-town-remembers/runtime-config": "workspace:*",
    };
  });
  fs.mkdirSync(path.join(rootDir, "packages/game-server/src"), { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, "packages/game-server/src/config.ts"),
    'import "@the-town-remembers/runtime-config/model";\n',
  );

  mutateManifest(rootDir, "apps/ambient-worker", (manifest) => {
    manifest.dependencies = {
      "@the-town-remembers/runtime-config": "workspace:*",
    };
  });
  fs.mkdirSync(path.join(rootDir, "apps/ambient-worker/src"), { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, "apps/ambient-worker/src/config.ts"),
    'import "@the-town-remembers/runtime-config/model";\n',
  );

  assert.deepEqual(validateWorkspace(rootDir), []);
});

test("rejects a missing library export map", () => {
  const rootDir = createValidFixture();
  mutateManifest(rootDir, "packages/http-contracts", (manifest) => {
    delete manifest.exports;
  });

  assertViolation(rootDir, "invalid_exports");
});

test("rejects library exports that expose source files", () => {
  const rootDir = createValidFixture();
  mutateManifest(rootDir, "packages/model-contracts", (manifest) => {
    manifest.exports["."].import = "./src/index.ts";
  });

  assertViolation(rootDir, "invalid_exports");
});

test("rejects duplicate package names", () => {
  const rootDir = createValidFixture();
  mutateManifest(rootDir, "apps/ambient-worker", (manifest) => {
    manifest.name = "@the-town-remembers/game-api";
  });

  assertViolation(rootDir, "duplicate_package_name");
});

test("ignores other git worktrees checked out under .claude", () => {
  const rootDir = createValidFixture();
  writeJson(path.join(rootDir, ".claude/worktrees/some-session/package.json"), {
    name: "the-town-remembers",
    version: "0.0.0",
    private: true,
    license: "MIT",
  });

  assert.deepEqual(validateWorkspace(rootDir), []);
});

test("rejects an unexpected package name at a declared path", () => {
  const rootDir = createValidFixture();
  mutateManifest(rootDir, "packages/serialization", (manifest) => {
    manifest.name = "@the-town-remembers/wire-format";
  });

  assertViolation(rootDir, "invalid_package_name");
});
