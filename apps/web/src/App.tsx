import { HealthPanel } from "./health/HealthPanel.js";
import { useHealth } from "./health/useHealth.js";
import { browserConfig } from "./config.js";

/** One authored key, so the manifest lookup path is exercised on every load. */
const DIAGNOSTIC_ILLUSTRATION_KEY = "bell-mystery-v1/scenes/festival-square";

export function App() {
  const { state, retry } = useHealth();

  return (
    <HealthPanel
      state={state}
      config={browserConfig}
      onRetry={retry}
      illustrationKey={DIAGNOSTIC_ILLUSTRATION_KEY}
    />
  );
}
