import { browserConfig } from "./config.js";
import { HealthPanel } from "./health/HealthPanel.js";
import { useHealth } from "./health/useHealth.js";
import { Router } from "./routing/router.js";
import { JoinBootstrap } from "./screens/JoinBootstrap.js";
import { Join } from "./screens/Join.js";
import { Shell } from "./screens/Shell.js";

/** One authored key, so the manifest lookup path is exercised on every load. */
const DIAGNOSTIC_ILLUSTRATION_KEY = "bell-mystery-v1/scenes/festival-square";

/** The Phase 0 foundation diagnostic — still `/`'s own page, unrelated to the game routes below. */
function HealthRoot() {
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

function NotFound() {
  return (
    <main>
      <h1>The Town Remembers</h1>
      <p role="status">Reopen the invite link to continue.</p>
    </main>
  );
}

export function App() {
  if (window.location.pathname === "/") return <HealthRoot />;

  return (
    <Router
      renderNotFound={() => <NotFound />}
      renderRoute={(match) => {
        switch (match.name) {
          case "joinBootstrap":
            return <JoinBootstrap inviteToken={match.params["inviteToken"]!} />;
          case "join":
            return <Join />;
          case "map":
          case "location":
          case "encounter":
          case "board":
          case "betweenVisits":
          case "resolution":
            return <Shell match={match} />;
        }
      }}
    />
  );
}
