import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HealthPanel } from "./HealthPanel.js";
import type { HealthState } from "./useHealth.js";

const CONFIG = { environment: "local", buildId: "web-build" } as const;
const KNOWN_KEY = "bell-mystery-v1/scenes/festival-square";

const HEALTHY: HealthState = {
  status: "healthy",
  health: { status: "ok", build: "api-build", time: "2026-08-02T00:00:00.000Z" },
};

afterEach(cleanup);

function renderPanel(state: HealthState, illustrationKey = KNOWN_KEY) {
  const onRetry = vi.fn();
  render(
    <HealthPanel
      state={state}
      config={CONFIG}
      onRetry={onRetry}
      illustrationKey={illustrationKey}
    />,
  );
  return { onRetry };
}

describe("health panel states", () => {
  it("announces the loading state politely", () => {
    renderPanel({ status: "loading" });
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toContain("Checking the API");
  });

  it("shows API liveness, build identity, and server time when healthy", () => {
    renderPanel(HEALTHY);
    expect(screen.getByText("Responding")).toBeTruthy();
    expect(screen.getByText("api-build")).toBeTruthy();
    expect(screen.getByText("2026-08-02T00:00:00.000Z")).toBeTruthy();
  });

  it("offers a retry control and no error detail when unavailable", () => {
    const { onRetry } = renderPanel({ status: "unavailable" });
    const button = screen.getByRole("button", { name: "Check again" });
    button.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toMatch(
      /ECONNREFUSED|TypeError|fetch failed/,
    );
  });

  it("says on the page that it checks liveness only", () => {
    renderPanel(HEALTHY);
    expect(document.body.textContent).toContain("makes no claim about the database");
  });
});

describe("health panel safety", () => {
  it.each(["loading", "unavailable"] as const)(
    "claims no dependency readiness in the %s state",
    (status) => {
      renderPanel({ status });
      const rendered = document.body.textContent.toLowerCase();
      expect(rendered).not.toContain("database: ok");
      expect(rendered).not.toContain("bedrock");
      expect(rendered).not.toContain("cockroach");
      expect(rendered).not.toContain("queue is");
    },
  );

  it("renders no secret-shaped value", () => {
    renderPanel(HEALTHY);
    const rendered = document.body.innerHTML;
    for (const marker of ["secret", "token", "password", "postgresql://", "Bearer "]) {
      expect(rendered.toLowerCase()).not.toContain(marker.toLowerCase());
    }
  });

  it("shows only the two public configuration values", () => {
    renderPanel(HEALTHY);
    expect(screen.getByText("web-build")).toBeTruthy();
    expect(screen.getByText("local")).toBeTruthy();
  });

  it("marks the illustration decorative so it adds no announced content", () => {
    renderPanel(HEALTHY);
    const image = document.querySelector("img");
    expect(image?.getAttribute("alt")).toBe("");
    expect(image?.getAttribute("src")?.startsWith("data:image/svg+xml")).toBe(true);
  });
});
