/**
 * Safe structured logging for the Recovery worker.
 *
 * The event type is closed and carries a stable outcome code only. The
 * scheduled event itself, and later the rows it sweeps, have no field here.
 */

import process from "node:process";

import type { EnvelopeRejectionCode } from "../envelope.js";

export type RecoveryOutcome = "no_work" | "rejected";

export interface RecoveryInvocationLogEvent {
  readonly event: "recovery_invocation";
  readonly outcome: RecoveryOutcome;
  readonly code: EnvelopeRejectionCode | "phase_5_owns_recovery_processing";
  readonly build: string;
  readonly environment: string;
}

export function logEvent(event: RecoveryInvocationLogEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}
