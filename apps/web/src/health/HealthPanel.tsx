/**
 * The foundation diagnostic panel.
 *
 * This is not the accepted game shell from Decision 011. It exists to prove
 * that the browser can reach the API through the same `/api` path shape the
 * deployed application uses, and it says so on the page.
 */

import type { BrowserConfig } from "@the-town-remembers/browser-config";

import { resolveAssetKey } from "../assets/manifest.js";
import type { HealthState } from "./useHealth.js";

export interface HealthPanelProps {
  readonly state: HealthState;
  readonly config: BrowserConfig;
  readonly onRetry: () => void;
  /** Rendered to prove the manifest fallback path; not final artwork. */
  readonly illustrationKey: string;
}

function StatusRegion({ state, onRetry }: Pick<HealthPanelProps, "state" | "onRetry">) {
  if (state.status === "loading") {
    return (
      <p className="health-status" role="status" aria-live="polite">
        Checking the API…
      </p>
    );
  }

  if (state.status === "unavailable") {
    return (
      <div className="health-status health-status--unavailable">
        <p role="status" aria-live="polite">
          The API did not answer. Nothing is wrong with your town; this page only checks
          that the local API is running.
        </p>
        <button type="button" onClick={onRetry}>
          Check again
        </button>
      </div>
    );
  }

  return (
    <dl
      className="health-status health-status--healthy"
      role="status"
      aria-live="polite"
    >
      <div>
        <dt>API</dt>
        <dd>Responding</dd>
      </div>
      <div>
        <dt>Server build</dt>
        <dd>{state.health.build}</dd>
      </div>
      <div>
        <dt>Server time</dt>
        <dd>
          <time dateTime={state.health.time}>{state.health.time}</time>
        </dd>
      </div>
    </dl>
  );
}

export function HealthPanel({
  state,
  config,
  onRetry,
  illustrationKey,
}: HealthPanelProps) {
  const illustration = resolveAssetKey(illustrationKey);

  return (
    <main className="health-panel">
      <h1>The Town Remembers</h1>
      <p className="health-panel__scope">
        Foundation diagnostic. It reports API liveness and build identity only, and
        makes no claim about the database, the model, or the queue.
      </p>

      <figure className="health-panel__illustration">
        <img src={illustration.source} alt="" />
        {illustration.state === "fallback" ? (
          <figcaption>{illustration.label}</figcaption>
        ) : null}
      </figure>

      <StatusRegion state={state} onRetry={onRetry} />

      <dl className="health-panel__build">
        <div>
          <dt>Browser build</dt>
          <dd>{config.buildId}</dd>
        </div>
        <div>
          <dt>Environment</dt>
          <dd>{config.environment}</dd>
        </div>
      </dl>
    </main>
  );
}
