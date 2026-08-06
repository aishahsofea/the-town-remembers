/**
 * Recovery worker shell.
 *
 * PHASE 0 SHELL — Phase 5 owns recovery processing. This handler validates the
 * scheduled envelope and reports that there is no work. It republishes no
 * outbox row, abandons no delivery, quarantines no execution, and clears no
 * join secret.
 *
 * The absence of a database and queue client in this package's dependencies is
 * part of that guarantee.
 */

import process from "node:process";

import type { ScheduledEvent as AwsScheduledEvent } from "aws-lambda";
import { loadRecoveryConfig } from "@the-town-remembers/runtime-config/recovery";

import { parseScheduledEvent, type EnvelopeRejectionCode } from "./envelope.js";
import { logEvent } from "./observability/log.js";

export const OWNING_PHASE = 5 as const;

export interface RecoveryInvocationResult {
  readonly outcome: "no_work" | "rejected";
  readonly code: EnvelopeRejectionCode | "phase_5_owns_recovery_processing";
  readonly ownerPhase: typeof OWNING_PHASE;
}

export interface RecoveryHandlerOptions {
  readonly environment?: NodeJS.ProcessEnv;
}

export function handleRecoveryEvent(
  event: unknown,
  options: RecoveryHandlerOptions = {},
): RecoveryInvocationResult {
  const config = loadRecoveryConfig(options.environment ?? process.env);
  const parsed = parseScheduledEvent(event);

  const result: RecoveryInvocationResult = parsed.parsed
    ? {
        outcome: "no_work",
        code: "phase_5_owns_recovery_processing",
        ownerPhase: OWNING_PHASE,
      }
    : { outcome: "rejected", code: parsed.code, ownerPhase: OWNING_PHASE };

  logEvent({
    event: "recovery_invocation",
    outcome: result.outcome,
    code: result.code,
    build: config.buildId,
    environment: config.environment,
  });

  return result;
}

export async function handler(
  event: AwsScheduledEvent,
): Promise<RecoveryInvocationResult> {
  return await Promise.resolve(handleRecoveryEvent(event));
}
