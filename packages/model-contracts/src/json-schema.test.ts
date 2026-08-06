import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { OUTPUT_SCHEMAS, toBedrockJsonSchema } from "./json-schema.js";
import { OUTPUT_SCHEMA_NAMES } from "./versions.js";

/** Checked-in snapshot path for each accepted output schema name. */
const SNAPSHOT_FILES = {
  [OUTPUT_SCHEMA_NAMES.claimNormalization]: "claim-normalization-v1.schema.json",
  [OUTPUT_SCHEMA_NAMES.npcDialogue]: "npc-dialogue-v1.schema.json",
  [OUTPUT_SCHEMA_NAMES.ambientChoice]: "ambient-choice-v1.schema.json",
} as const;

function readSnapshot(fileName: string): unknown {
  const path = fileURLToPath(
    new URL(`../../../docs/schemas/${fileName}`, import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("Bedrock output schema drift", () => {
  it.each(Object.keys(SNAPSHOT_FILES))(
    "generates %s identically to its checked-in snapshot",
    (schemaName) => {
      const name = schemaName as keyof typeof SNAPSHOT_FILES;
      const generated = toBedrockJsonSchema(OUTPUT_SCHEMAS[name]);
      expect(generated).toStrictEqual(readSnapshot(SNAPSHOT_FILES[name]));
    },
  );

  it("covers exactly the three accepted output schemas", () => {
    expect(Object.keys(OUTPUT_SCHEMAS).toSorted()).toStrictEqual([
      "ambient_choice_v1",
      "claim_normalization_v1",
      "npc_dialogue_v1",
    ]);
  });

  it("closes every generated object so an extra key cannot be returned", () => {
    for (const schema of Object.values(OUTPUT_SCHEMAS)) {
      expect(toBedrockJsonSchema(schema)["additionalProperties"]).toBe(false);
    }
  });

  it("requires every declared property, matching the Bedrock subset", () => {
    for (const schema of Object.values(OUTPUT_SCHEMAS)) {
      const generated = toBedrockJsonSchema(schema);
      const properties = Object.keys(generated["properties"] as object);
      expect(generated["required"]).toStrictEqual(properties);
    }
  });

  it("would fail if a Zod definition drifted from the snapshot", () => {
    const snapshot = readSnapshot(SNAPSHOT_FILES.ambient_choice_v1) as Record<
      string,
      unknown
    >;
    const drifted = { ...snapshot, additionalProperties: true };
    expect(drifted).not.toStrictEqual(
      toBedrockJsonSchema(OUTPUT_SCHEMAS.ambient_choice_v1),
    );
  });
});
