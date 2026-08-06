/**
 * `GET /api/v1/health` reports API liveness, build identity, and server time.
 *
 * The shape is deliberately closed: it has no room for a database, model,
 * queue, or secret-store field, so the route cannot grow into a dependency
 * readiness probe without an explicit contract change.
 */

import { z } from "zod";

import { BuildIdSchema, IsoTimeSchema } from "./primitives.js";

export const HealthResponseSchema = z.strictObject({
  status: z.literal("ok"),
  build: BuildIdSchema,
  time: IsoTimeSchema,
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
