/**
 * Captures structured log output so redaction can be asserted rather than
 * assumed.
 *
 * Server shells write one JSON object per line to stdout. Tests need the exact
 * bytes those shells emit, not a mocked logger, because the risk being checked
 * is that a real emission carries a secret.
 */

import process from "node:process";

export interface CapturedLogs {
  /** Every chunk written to stdout during the capture, joined. */
  readonly raw: string;
  /** Parsed JSON lines. A non-JSON line is reported as a parse failure. */
  readonly events: readonly Record<string, unknown>[];
  readonly unparsedLines: readonly string[];
}

function parseLines(raw: string): Pick<CapturedLogs, "events" | "unparsedLines"> {
  const events: Record<string, unknown>[] = [];
  const unparsedLines: string[] = [];

  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    try {
      events.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      unparsedLines.push(line);
    }
  }
  return { events, unparsedLines };
}

/** Runs `body` with stdout captured and restores the stream afterwards. */
export async function captureStdout(
  body: () => Promise<void> | void,
): Promise<CapturedLogs> {
  const chunks: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.stdout.write = (chunk: string | Uint8Array): boolean => {
    chunks.push(
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"),
    );
    return true;
  };

  try {
    await body();
  } finally {
    process.stdout.write = originalWrite;
  }

  const raw = chunks.join("");
  return { raw, ...parseLines(raw) };
}
