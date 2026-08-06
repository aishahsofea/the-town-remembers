/**
 * Ambient Tick worker shell.
 *
 * PHASE 0 SHELL — Phase 5 owns ambient processing. This handler parses the
 * versioned envelope and stops. It publishes nothing, claims nothing,
 * processes nothing, retries nothing, quarantines nothing, and touches no
 * persistence, so it cannot report a successful effect it did not have.
 *
 * The absence of a database, queue, or model client in this package's
 * dependencies is part of that guarantee.
 */

import process from "node:process";

import type { SQSEvent } from "aws-lambda";
import {
  AMBIENT_QUEUE,
  loadAmbientConfig,
} from "@the-town-remembers/runtime-config/ambient";

import { parseAmbientJobMessage, type EnvelopeRejectionCode } from "./envelope.js";
import { logEvent } from "./observability/log.js";

export const OWNING_PHASE = 5 as const;

/**
 * The minimal shape this shell reads. Declaring it structurally rather than
 * accepting the full `SQSEvent` keeps the absent-batch case honestly
 * conditional: a real invocation is not guaranteed to match its declared type.
 */
export interface AmbientQueueEvent {
  readonly Records?: readonly { readonly body: string }[];
}

export interface AmbientInvocationResult {
  readonly outcome: "unsupported" | "rejected";
  readonly code: EnvelopeRejectionCode | "phase_5_owns_ambient_processing";
  readonly ownerPhase: typeof OWNING_PHASE;
}

export interface AmbientHandlerOptions {
  readonly environment?: NodeJS.ProcessEnv;
}

export function handleAmbientEvent(
  event: AmbientQueueEvent,
  options: AmbientHandlerOptions = {},
): AmbientInvocationResult {
  const config = loadAmbientConfig(options.environment ?? process.env);
  const records = event.Records ?? [];

  const result = ((): AmbientInvocationResult => {
    if (records.length === 0) {
      return { outcome: "rejected", code: "no_records", ownerPhase: OWNING_PHASE };
    }
    if (records.length !== AMBIENT_QUEUE.lambdaBatchSize) {
      return {
        outcome: "rejected",
        code: "unexpected_batch_size",
        ownerPhase: OWNING_PHASE,
      };
    }

    const parsed = parseAmbientJobMessage(records[0]!.body);
    if (!parsed.parsed) {
      return { outcome: "rejected", code: parsed.code, ownerPhase: OWNING_PHASE };
    }
    return {
      outcome: "unsupported",
      code: "phase_5_owns_ambient_processing",
      ownerPhase: OWNING_PHASE,
    };
  })();

  logEvent({
    event: "ambient_invocation",
    outcome: result.outcome,
    code: result.code,
    recordCount: records.length,
    build: config.buildId,
    environment: config.environment,
  });

  return result;
}

export async function handler(event: SQSEvent): Promise<AmbientInvocationResult> {
  return await Promise.resolve(handleAmbientEvent(event));
}
