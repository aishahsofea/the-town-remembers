/**
 * The transport-agnostic request and response shapes every route handles.
 *
 * `apps/game-api`'s own `HttpRequest`/`HttpResponse` are written to this exact
 * shape rather than importing it: a library cannot be imported by the
 * deployment units that depend on it, so this is the one place the contract is
 * declared and the adapters' declarations must keep in step with it.
 */

export interface HttpRequest {
  readonly method: string;
  /** Path only, already stripped of its query string. */
  readonly path: string;
  /** Lowercased names, already filtered to `HEADER_ALLOWLIST` by the adapter. */
  readonly headers: ReadonlyMap<string, string>;
  readonly body: string | undefined;
  readonly sourceIp: string | undefined;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  /** Never flattened into `headers`: one entry per `Set-Cookie` line. */
  readonly cookies: readonly string[];
}
