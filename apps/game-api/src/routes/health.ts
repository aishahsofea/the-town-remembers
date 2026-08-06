/**
 * `GET /api/v1/health`.
 *
 * Liveness, build identity, and server time only. The handler performs no I/O
 * and imports no dependency client, so it cannot report a readiness it did not
 * check. CockroachDB, Bedrock, SQS, and Secrets Manager readiness belong to
 * the phases that own those dependencies.
 */

import type { HealthResponse } from "@the-town-remembers/http-contracts";
import { HealthResponseSchema } from "@the-town-remembers/http-contracts";

export interface HealthContext {
  readonly buildId: string;
  readonly now: () => Date;
}

export function buildHealthResponse(context: HealthContext): HealthResponse {
  return HealthResponseSchema.parse({
    status: "ok",
    build: context.buildId,
    time: context.now().toISOString(),
  });
}
