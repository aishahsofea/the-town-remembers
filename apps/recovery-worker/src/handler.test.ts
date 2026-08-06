import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  FORBIDDEN_LOG_PROPERTIES,
  SENSITIVE_TEST_MARKERS,
  captureStdout,
  findSensitiveMarkers,
} from "@the-town-remembers/test-support";
import { describe, expect, it } from "vitest";

import { OWNING_PHASE, handleRecoveryEvent } from "./handler.js";

const ENVIRONMENT = { TTR_ENV: "local", TTR_BUILD_ID: "local-test" } as const;

const SCHEDULED_EVENT = {
  source: "aws.events",
  "detail-type": "Scheduled Event",
  time: "2026-08-02T00:00:00Z",
  detail: {},
};

async function invoke(event: unknown) {
  let result: ReturnType<typeof handleRecoveryEvent> | undefined;
  const captured = await captureStdout(() => {
    result = handleRecoveryEvent(event, { environment: { ...ENVIRONMENT } });
  });
  return { result: result!, captured };
}

describe("recovery worker shell", () => {
  it("reports no work for a valid scheduled invocation", async () => {
    const { result } = await invoke(SCHEDULED_EVENT);
    expect(result).toStrictEqual({
      outcome: "no_work",
      code: "phase_5_owns_recovery_processing",
      ownerPhase: OWNING_PHASE,
    });
  });

  it.each([
    ["an empty object", {}],
    ["a foreign source", { ...SCHEDULED_EVENT, source: "aws.sqs" }],
    ["a foreign detail type", { ...SCHEDULED_EVENT, "detail-type": "Manual Trigger" }],
    ["a malformed timestamp", { ...SCHEDULED_EVENT, time: "not a time" }],
    ["a string", "run recovery"],
    ["null", null],
  ])("rejects %s without side effects", async (_label, event) => {
    const { result } = await invoke(event);
    expect(result.outcome).toBe("rejected");
    expect(result.code).toBe("invalid_envelope");
  });

  it("never logs the rejected event", async () => {
    const { captured } = await invoke({
      source: "aws.events",
      "detail-type": SENSITIVE_TEST_MARKERS.payload,
      time: "2026-08-02T00:00:00Z",
    });
    expect(findSensitiveMarkers(captured.raw)).toStrictEqual([]);
  });

  it("emits one closed log event per invocation", async () => {
    const { captured } = await invoke(SCHEDULED_EVENT);
    expect(captured.events).toHaveLength(1);
    expect(Object.keys(captured.events[0]!).toSorted()).toStrictEqual([
      "build",
      "code",
      "environment",
      "event",
      "outcome",
    ]);

    for (const property of FORBIDDEN_LOG_PROPERTIES) {
      if (property === "event") continue;
      expect(captured.events[0]).not.toHaveProperty(property);
    }
  });
});

describe("recovery worker isolation", () => {
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
