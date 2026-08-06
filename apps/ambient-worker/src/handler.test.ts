import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  FORBIDDEN_LOG_PROPERTIES,
  SENSITIVE_TEST_MARKERS,
  captureStdout,
  findSensitiveMarkers,
} from "@the-town-remembers/test-support";
import { describe, expect, it } from "vitest";

import { AMBIENT_ENVELOPE_VERSION } from "./envelope.js";
import { OWNING_PHASE, handleAmbientEvent, type AmbientQueueEvent } from "./handler.js";

const ENVIRONMENT = { TTR_ENV: "local", TTR_BUILD_ID: "local-test" } as const;

const VALID_MESSAGE = {
  version: AMBIENT_ENVELOPE_VERSION,
  townId: "11111111-1111-4111-8111-111111111111",
  outboxId: "22222222-2222-4222-8222-222222222222",
  jobKey: "33333333-3333-4333-8333-333333333333",
};

function sqsEvent(...bodies: string[]): AmbientQueueEvent {
  return { Records: bodies.map((body) => ({ body })) };
}

async function invoke(event: AmbientQueueEvent) {
  let result: ReturnType<typeof handleAmbientEvent> | undefined;
  const captured = await captureStdout(() => {
    result = handleAmbientEvent(event, { environment: { ...ENVIRONMENT } });
  });
  return { result: result!, captured };
}

describe("ambient worker shell", () => {
  it("reports unsupported work for a valid envelope", async () => {
    const { result } = await invoke(sqsEvent(JSON.stringify(VALID_MESSAGE)));
    expect(result).toStrictEqual({
      outcome: "unsupported",
      code: "phase_5_owns_ambient_processing",
      ownerPhase: OWNING_PHASE,
    });
  });

  it.each([
    ["an empty batch", [] as string[], "no_records"],
    ["unparsable JSON", ["not json"], "unparsable_body"],
    [
      "a missing version",
      [JSON.stringify({ ...VALID_MESSAGE, version: undefined })],
      "invalid_envelope",
    ],
    [
      "a wrong version",
      [JSON.stringify({ ...VALID_MESSAGE, version: "ambient-tick/2" })],
      "invalid_envelope",
    ],
    [
      "a non-UUID identifier",
      [JSON.stringify({ ...VALID_MESSAGE, townId: "town_1" })],
      "invalid_envelope",
    ],
    [
      "an extra property",
      [JSON.stringify({ ...VALID_MESSAGE, payload: { hops: 3 } })],
      "invalid_envelope",
    ],
  ])("rejects %s without side effects", async (_label, bodies, code) => {
    const { result } = await invoke(sqsEvent(...bodies));
    expect(result.outcome).toBe("rejected");
    expect(result.code).toBe(code);
  });

  it("rejects a batch larger than the accepted size of one", async () => {
    const { result } = await invoke(
      sqsEvent(JSON.stringify(VALID_MESSAGE), JSON.stringify(VALID_MESSAGE)),
    );
    expect(result.code).toBe("unexpected_batch_size");
  });

  it("never logs the raw message body", async () => {
    const { captured } = await invoke(
      sqsEvent(
        JSON.stringify({ ...VALID_MESSAGE, note: SENSITIVE_TEST_MARKERS.payload }),
      ),
    );
    expect(findSensitiveMarkers(captured.raw)).toStrictEqual([]);
  });

  it("never logs an unparsable body", async () => {
    const { captured } = await invoke(sqsEvent(SENSITIVE_TEST_MARKERS.payload));
    expect(findSensitiveMarkers(captured.raw)).toStrictEqual([]);
  });

  it("emits one closed log event per invocation", async () => {
    const { captured } = await invoke(sqsEvent(JSON.stringify(VALID_MESSAGE)));
    expect(captured.events).toHaveLength(1);
    expect(Object.keys(captured.events[0]!).toSorted()).toStrictEqual([
      "build",
      "code",
      "environment",
      "event",
      "outcome",
      "recordCount",
    ]);

    for (const property of FORBIDDEN_LOG_PROPERTIES) {
      if (property === "event") continue;
      expect(captured.events[0]).not.toHaveProperty(property);
    }
  });
});

describe("ambient worker isolation", () => {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
  ) as { dependencies?: Record<string, string> };

  it("declares no database, queue, or model client", () => {
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      expect(name).not.toMatch(/aws-sdk|@aws-sdk|pg|kysely|bedrock|sqs/i);
    }
  });

  it("reaches no network or filesystem module", () => {
    const source = [
      readFileSync(fileURLToPath(new URL("./handler.ts", import.meta.url)), "utf8"),
      readFileSync(fileURLToPath(new URL("./envelope.ts", import.meta.url)), "utf8"),
    ].join("\n");
    for (const forbidden of [
      "node:net",
      "node:http",
      "node:fs",
      "node:dns",
      "fetch(",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
