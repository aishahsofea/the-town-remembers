/**
 * The EventBridge scheduled-invocation envelope.
 *
 * Recovery runs once per minute on a schedule. It accepts nothing else: a
 * hand-crafted event of a different shape must not be able to trigger a sweep.
 */

import { z } from "zod";

export const RECOVERY_SCHEDULE_INTERVAL_MINUTES = 1;

export const ScheduledEventSchema = z.looseObject({
  source: z.literal("aws.events"),
  "detail-type": z.literal("Scheduled Event"),
  time: z.iso.datetime(),
});

export type ScheduledEvent = z.infer<typeof ScheduledEventSchema>;

export type EnvelopeRejectionCode = "invalid_envelope";

export type EnvelopeResult =
  | { readonly parsed: true; readonly event: ScheduledEvent }
  | { readonly parsed: false; readonly code: EnvelopeRejectionCode };

export function parseScheduledEvent(candidate: unknown): EnvelopeResult {
  const result = ScheduledEventSchema.safeParse(candidate);
  return result.success
    ? { parsed: true, event: result.data }
    : { parsed: false, code: "invalid_envelope" };
}
