/**
 * The one fetch wrapper every API call in `apps/web` goes through.
 *
 * Every request is same-origin and relative (matching `useHealth.ts`'s own
 * convention — never an absolute URL, so the browser can only ever reach the
 * origin that served the page). A `ProblemResponse` body is parsed and
 * thrown as {@link ApiError} rather than treated as a successful call, so
 * every caller handles the "request succeeded but the action was refused"
 * case the same way.
 */

import type { ProblemResponse } from "@the-town-remembers/http-contracts";
import { ProblemResponseSchema } from "@the-town-remembers/http-contracts";

export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemResponse;
  readonly headers: Headers;

  constructor(status: number, problem: ProblemResponse, headers: Headers = new Headers()) {
    super(problem.detail);
    this.name = "ApiError";
    this.status = status;
    this.problem = problem;
    this.headers = headers;
  }
}

/** A transport-level failure — offline, DNS, aborted — never a server response. */
export class NetworkError extends Error {
  constructor() {
    super("The request could not reach the server.");
    this.name = "NetworkError";
  }
}

export interface ApiRequestInit {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

export interface ApiResponse<T> {
  readonly status: number;
  readonly headers: Headers;
  readonly body: T;
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Issues one request and returns its parsed JSON body. A `2xx` with no body
 * (a `304`) resolves with `body: undefined`. Any non-`2xx` response is parsed
 * as a `ProblemResponse` and thrown as {@link ApiError} — the schema itself
 * enforces that only a real problem body reaches a caller as one.
 */
export async function apiRequest<T = unknown>(
  path: string,
  init: ApiRequestInit = {},
): Promise<ApiResponse<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method ?? "GET",
      headers: {
        accept: "application/json",
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      ...(init.signal ? { signal: init.signal } : {}),
    });
  } catch {
    // The underlying reason is discarded on purpose: a fetch rejection's
    // message can carry a resolved URL, which has nothing safe to show.
    throw new NetworkError();
  }

  if (response.status === 304) {
    return { status: response.status, headers: response.headers, body: undefined as T };
  }

  if (response.ok) {
    const parsed = await parseJson(response);
    return { status: response.status, headers: response.headers, body: parsed as T };
  }

  const parsedProblem = ProblemResponseSchema.safeParse(await parseJson(response));
  if (!parsedProblem.success) {
    throw new ApiError(
      response.status,
      {
        type: "https://the-town-remembers/errors/internal-error",
        status: 500,
        code: "INTERNAL_ERROR",
        title: "Internal error",
        detail: "An unexpected error occurred.",
        requestId: "unknown",
        fieldErrors: [],
      },
      response.headers,
    );
  }
  throw new ApiError(response.status, parsedProblem.data, response.headers);
}

/** Fills `{param}` placeholders in a `ROUTE_TEMPLATES` entry. */
export function buildPath(
  template: string,
  params: Readonly<Record<string, string>>,
): string {
  return Object.entries(params).reduce(
    (path, [name, value]) => path.replace(`{${name}}`, encodeURIComponent(value)),
    template,
  );
}
