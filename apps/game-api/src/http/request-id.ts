/**
 * Opaque per-request identifier.
 *
 * It is always generated here and never read from the request. A
 * client-controlled identifier would flow straight into the log stream, and a
 * correlation identifier is not worth that.
 */

import { randomUUID } from "node:crypto";

const REQUEST_ID_PREFIX = "req_";

export function createRequestId(): string {
  const bytes = Buffer.from(randomUUID().replaceAll("-", ""), "hex");
  return `${REQUEST_ID_PREFIX}${bytes.toString("base64url")}`;
}
