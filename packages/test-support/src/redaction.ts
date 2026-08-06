/**
 * Shared redaction expectations for server shells.
 *
 * Every server package references this list so one place defines what must
 * never appear in a log line, a response body, or a synthesized template.
 */

/**
 * Marker values a test injects into a request or event. Any appearance in
 * captured output is a leak, whatever the surrounding structure.
 */
export const SENSITIVE_TEST_MARKERS = {
  cookie: "SENSITIVE-COOKIE-MARKER",
  authorization: "SENSITIVE-AUTHORIZATION-MARKER",
  inviteToken: "SENSITIVE-INVITE-TOKEN-MARKER",
  joinSecret: "SENSITIVE-JOIN-SECRET-MARKER",
  requestBody: "SENSITIVE-BODY-MARKER",
  queryValue: "SENSITIVE-QUERY-MARKER",
  environmentValue: "SENSITIVE-ENVIRONMENT-MARKER",
  payload: "SENSITIVE-PAYLOAD-MARKER",
} as const;

export type SensitiveMarker =
  (typeof SENSITIVE_TEST_MARKERS)[keyof typeof SENSITIVE_TEST_MARKERS];

/** Returns every marker found in the text, so a failure names what leaked. */
export function findSensitiveMarkers(text: string): string[] {
  return Object.values(SENSITIVE_TEST_MARKERS).filter((marker) =>
    text.includes(marker),
  );
}

/**
 * Property names a safe log event must never carry. The deployment tier and
 * build identity are safe and deliberately absent from this list; raw request
 * and queue material is not.
 */
export const FORBIDDEN_LOG_PROPERTIES: readonly string[] = [
  "url",
  "rawUrl",
  "rawPath",
  "path",
  "query",
  "queryString",
  "queryStringParameters",
  "headers",
  "cookie",
  "cookies",
  "authorization",
  "body",
  "payload",
  "requestEvent",
  "record",
  "records",
  "token",
  "secret",
];
