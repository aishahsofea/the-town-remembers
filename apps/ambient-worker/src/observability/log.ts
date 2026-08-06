/**
 * Safe structured logging for the Ambient Tick worker.
 *
 * The event type is closed and carries identity plus a stable outcome code.
 * A raw SQS record, message body, or attribute set has no field to travel in.
 */

import process from "node:process";

import type { EnvelopeRejectionCode } from "../envelope.js";

export type AmbientOutcome = "unsupported" | "rejected";

export interface AmbientInvocationLogEvent {
  readonly event: "ambient_invocation";
  readonly outcome: AmbientOutcome;
  readonly code: EnvelopeRejectionCode | "phase_5_owns_ambient_processing";
  readonly recordCount: number;
  readonly build: string;
  readonly environment: string;
}

export function logEvent(event: AmbientInvocationLogEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}
