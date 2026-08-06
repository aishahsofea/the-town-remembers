/**
 * The SQS message envelope for `ambient_tick`.
 *
 * Decision 005 fixes what the queue carries: town, outbox, and job identity
 * only. The authoritative payload, event range, and `not_before` value stay in
 * the outbox row, so a message can never be the source of what gets applied.
 */

import { z } from "zod";

export const AMBIENT_JOB_TYPE = "ambient_tick" as const;
export const AMBIENT_ENVELOPE_VERSION = "ambient-tick/1" as const;

const UuidSchema = z.uuid();

export const AmbientJobMessageSchema = z.strictObject({
  version: z.literal(AMBIENT_ENVELOPE_VERSION),
  townId: UuidSchema,
  outboxId: UuidSchema,
  jobKey: UuidSchema,
});

export type AmbientJobMessage = z.infer<typeof AmbientJobMessageSchema>;

export type EnvelopeRejectionCode =
  "no_records" | "unexpected_batch_size" | "unparsable_body" | "invalid_envelope";

export type EnvelopeResult =
  | { readonly parsed: true; readonly message: AmbientJobMessage }
  | { readonly parsed: false; readonly code: EnvelopeRejectionCode };

/**
 * Parses one record without ever returning the raw body. A caller that only
 * sees a stable rejection code cannot log the payload by mistake.
 */
export function parseAmbientJobMessage(body: string): EnvelopeResult {
  let candidate: unknown;
  try {
    candidate = JSON.parse(body);
  } catch {
    return { parsed: false, code: "unparsable_body" };
  }

  const result = AmbientJobMessageSchema.safeParse(candidate);
  return result.success
    ? { parsed: true, message: result.data }
    : { parsed: false, code: "invalid_envelope" };
}
