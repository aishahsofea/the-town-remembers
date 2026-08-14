import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Shell } from "./Shell.js";

const NPC = { id: "npc_nessa", actorType: "npc" as const, displayName: "Nessa Reed" };

function encounterView(
  overrides: { availableActionKinds?: readonly string[] } = {},
): unknown {
  return {
    npc: NPC,
    roleLabel: "Gardener",
    portraitKey: "bell-mystery-v1/portraits/nessa-reed",
    openingLine: "I can tell you what I saw, what I heard...",
    stance: "wary",
    availableActionKinds: overrides.availableActionKinds ?? [
      "ask",
      "normalize_claim",
      "tell",
    ],
  };
}

function playerViewBody(
  overrides: { encounters?: unknown[]; activePromises?: unknown[] } = {},
): unknown {
  return {
    viewVersion: "Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmE",
    town: {
      id: "town-1",
      mysteryTitle: "The Missing Festival Bell",
      contentVersion: "bell-mystery-v1",
      tagline: "The bell is gone.",
      status: "active",
    },
    player: {
      id: "p1",
      displayName: "Aishah Sofea",
      visit: { status: "active", visitId: "v1", locationId: "loc-garden" },
    },
    map: [],
    currentLocation: {
      id: "loc-garden",
      displayName: "Reed's Garden",
      inspectables: [],
    },
    encounters: overrides.encounters ?? [encounterView()],
    inventory: [],
    discoveredClues: [],
    activePromises: overrides.activePromises ?? [],
    caseBoard: [],
    caseBoardContradictions: [],
    caseAttempts: [],
    resolution: {
      state: "investigating",
      accusationGate: { state: "locked", message: "Locked." },
    },
    ambientTransition: null,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function completedAsk(text: string, responseMode: string, actionId = "action-ask") {
  return {
    actionId,
    kind: "ask",
    status: "completed",
    outcome: "applied",
    result: {
      dialogue: { npcId: NPC.id, text, responseMode },
      promiseOffers: [],
    },
  };
}

function mountEncounter() {
  return render(
    <Shell match={{ name: "encounter", params: { townId: "town-1", npcId: NPC.id } }} />,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe("Encounter — scene anchor and gated controls (P4-18 acceptance 1, 3)", () => {
  it("renders portrait role stance opening line, and only server-supplied actions as controls", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/player-view")) {
        return Promise.resolve(
          jsonResponse(
            playerViewBody({ encounters: [encounterView({ availableActionKinds: ["ask"] })] }),
          ),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    mountEncounter();

    await screen.findByRole("heading", { name: "Nessa Reed" });
    expect(screen.getByText("Gardener")).toBeTruthy();
    expect(screen.getByText("wary")).toBeTruthy();
    expect(screen.getByText("I can tell you what I saw, what I heard...")).toBeTruthy();

    expect(screen.getByRole("button", { name: "Ask Nessa Reed" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Tell Nessa Reed" })).toBeNull();
  });
});

describe("Encounter — Ask composer (P4-18 acceptance 2)", () => {
  it("never allocates a key for empty input and submits only on Ctrl/Cmd+Enter", async () => {
    let postCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/player-view")) {
        return Promise.resolve(jsonResponse(playerViewBody()));
      }
      if (init?.method === "POST" && url.includes("/actions")) {
        postCount += 1;
        return Promise.resolve(jsonResponse(completedAsk("Where were you?", "selected")));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    mountEncounter();
    fireEvent.click(await screen.findByRole("button", { name: "Ask Nessa Reed" }));

    const textarea = await screen.findByLabelText("Ask Nessa Reed");
    const submitButton = screen.getByRole("button", { name: "Ask Nessa Reed" });
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(postCount).toBe(0);

    fireEvent.change(textarea, { target: { value: "Where were you that night?" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });

    await waitFor(() => expect(postCount).toBe(1));
  });
});

describe("Encounter — no response-mode stigma (P4-18 acceptance 4)", () => {
  it.each(["selected", "repaired", "fallback"] as const)(
    "renders %s dialogue with identical markup to every other response mode",
    async (responseMode) => {
      vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (url.includes("/player-view")) {
          return Promise.resolve(jsonResponse(playerViewBody()));
        }
        if (init?.method === "POST" && url.includes("/actions")) {
          return Promise.resolve(
            jsonResponse(completedAsk("A plain answer.", responseMode)),
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      });

      mountEncounter();
      fireEvent.click(await screen.findByRole("button", { name: "Ask Nessa Reed" }));
      const textarea = await screen.findByLabelText("Ask Nessa Reed");
      fireEvent.change(textarea, { target: { value: "What happened?" } });
      fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });

      const reply = await screen.findByLabelText(`${NPC.id}'s reply`);
      expect(reply.outerHTML).toBe(
        `<article aria-label="${NPC.id}'s reply"><p>A plain answer.</p></article>`,
      );
    },
  );
});

describe("Encounter — exchange survives refresh for the current visit (P4-18 acceptance 5)", () => {
  it("restores the latest completed exchange from a fresh mount after a completed ask", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/player-view")) {
        return Promise.resolve(jsonResponse(playerViewBody()));
      }
      if (init?.method === "POST" && url.includes("/actions")) {
        return Promise.resolve(jsonResponse(completedAsk("Remembered reply.", "selected")));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const first = mountEncounter();
    fireEvent.click(await screen.findByRole("button", { name: "Ask Nessa Reed" }));
    const textarea = await screen.findByLabelText("Ask Nessa Reed");
    fireEvent.change(textarea, { target: { value: "Tell me." } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    await screen.findByText("Remembered reply.");
    first.unmount();

    mountEncounter();
    await screen.findByText("Remembered reply.");
  });
});

describe("Encounter — Tell interpretation (P4-19)", () => {
  function draftedResult(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      actionId: "action-interpret",
      kind: "normalize_claim",
      status: "completed",
      outcome: "applied",
      result: {
        normalizationStatus: "drafted",
        claimDraftId: "draft-1",
        canonicalText: "The festival bell is at Reed's Garden.",
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        ...overrides,
      },
    };
  }

  it("returns to the composer with a notice on needs_revision, allocating no draft", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/player-view")) {
        return Promise.resolve(jsonResponse(playerViewBody()));
      }
      if (init?.method === "POST" && url.includes("/actions")) {
        return Promise.resolve(
          jsonResponse({
            actionId: "action-interpret",
            kind: "normalize_claim",
            status: "completed",
            outcome: "applied",
            result: {
              normalizationStatus: "needs_revision",
              explanation: "Too many claims in one sentence.",
            },
          }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    mountEncounter();
    fireEvent.click(await screen.findByRole("button", { name: "Tell Nessa Reed" }));
    const textarea = await screen.findByLabelText("What do you want to tell Nessa Reed?");
    fireEvent.change(textarea, { target: { value: "Too much at once." } });
    fireEvent.click(screen.getByRole("button", { name: "Interpret claim" }));

    await screen.findByText(
      "The town could not turn that into one supported claim. Too many claims in one sentence.",
    );
    expect(screen.queryByRole("dialog", { name: "Is this what you mean?" })).toBeNull();
    expect((textarea as HTMLTextAreaElement).value).toBe("Too much at once.");
  });

  it("shows Recorded source: You for an original claim and lets Edit statement discard without calling Tell", async () => {
    let telledPosts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/player-view")) {
        return Promise.resolve(jsonResponse(playerViewBody()));
      }
      if (init?.method === "POST" && url.includes("/actions")) {
        const body = JSON.parse(init.body as string) as { kind: string };
        if (body.kind === "tell") telledPosts += 1;
        return Promise.resolve(jsonResponse(draftedResult()));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    mountEncounter();
    fireEvent.click(await screen.findByRole("button", { name: "Tell Nessa Reed" }));
    const textarea = await screen.findByLabelText("What do you want to tell Nessa Reed?");
    fireEvent.change(textarea, {
      target: { value: "The bell is hidden in Reed's Garden." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Interpret claim" }));

    const dialog = await screen.findByRole("dialog", { name: "Is this what you mean?" });
    expect(dialog.textContent).toContain("The bell is hidden in Reed's Garden.");
    expect(dialog.textContent).toContain("The festival bell is at Reed's Garden.");
    expect(dialog.textContent).toContain("Recorded source: You");

    fireEvent.click(screen.getByRole("button", { name: "Edit statement" }));
    expect(screen.queryByRole("dialog", { name: "Is this what you mean?" })).toBeNull();
    const reopenedTextarea = await screen.findByLabelText<HTMLTextAreaElement>(
      "What do you want to tell Nessa Reed?",
    );
    expect(reopenedTextarea.value).toBe("The bell is hidden in Reed's Garden.");
    expect(telledPosts).toBe(0);
  });

  it("shows Alleged source when the normalizer returns one", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/player-view")) {
        return Promise.resolve(jsonResponse(playerViewBody()));
      }
      if (init?.method === "POST" && url.includes("/actions")) {
        return Promise.resolve(
          jsonResponse(
            draftedResult({
              allegedSource: {
                id: "npc_corin",
                actorType: "npc",
                displayName: "Corin Hale",
              },
            }),
          ),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    mountEncounter();
    fireEvent.click(await screen.findByRole("button", { name: "Tell Nessa Reed" }));
    const textarea = await screen.findByLabelText("What do you want to tell Nessa Reed?");
    fireEvent.change(textarea, { target: { value: "Corin said the bell is hidden." } });
    fireEvent.click(screen.getByRole("button", { name: "Interpret claim" }));

    const dialog = await screen.findByRole("dialog", { name: "Is this what you mean?" });
    expect(dialog.textContent).toContain("Alleged source: Corin Hale");
    expect(dialog.textContent).not.toContain("Recorded source: You");
  });

  it("offers Interpret again instead of Tell once the draft has expired, and cannot submit an expired draft", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/player-view")) {
        return Promise.resolve(jsonResponse(playerViewBody()));
      }
      if (init?.method === "POST" && url.includes("/actions")) {
        return Promise.resolve(
          jsonResponse(
            draftedResult({ expiresAt: new Date(Date.now() - 1_000).toISOString() }),
          ),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    mountEncounter();
    fireEvent.click(await screen.findByRole("button", { name: "Tell Nessa Reed" }));
    const textarea = await screen.findByLabelText("What do you want to tell Nessa Reed?");
    fireEvent.change(textarea, { target: { value: "The bell is hidden." } });
    fireEvent.click(screen.getByRole("button", { name: "Interpret claim" }));

    const dialog = await screen.findByRole("dialog", { name: "Is this what you mean?" });
    expect(dialog.textContent).toContain("Interpretation expired");
    expect(screen.queryByRole("button", { name: "Tell Nessa Reed" })).toBeNull();
    expect(screen.getByRole("button", { name: "Interpret again" })).toBeTruthy();
  });

  it("sends Interpret and Tell as two separate actions and closes the sheet only after Tell completes", async () => {
    const postedKinds: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/player-view")) {
        return Promise.resolve(jsonResponse(playerViewBody()));
      }
      if (init?.method === "POST" && url.includes("/actions")) {
        const body = JSON.parse(init.body as string) as { kind: string };
        postedKinds.push(body.kind);
        if (body.kind === "normalize_claim") return Promise.resolve(jsonResponse(draftedResult()));
        return Promise.resolve(
          jsonResponse({
            actionId: "action-tell",
            kind: "tell",
            status: "completed",
            outcome: "applied",
            result: {
              claimDraftId: "draft-1",
              claim: { claimId: "claim-1", text: "The festival bell is at Reed's Garden." },
              dialogue: { npcId: NPC.id, text: "Noted.", responseMode: "selected" },
              promiseOffers: [],
            },
          }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    mountEncounter();
    fireEvent.click(await screen.findByRole("button", { name: "Tell Nessa Reed" }));
    const textarea = await screen.findByLabelText("What do you want to tell Nessa Reed?");
    fireEvent.change(textarea, {
      target: { value: "The bell is hidden in Reed's Garden." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Interpret claim" }));
    await screen.findByRole("dialog", { name: "Is this what you mean?" });

    fireEvent.click(screen.getByRole("button", { name: "Tell Nessa Reed" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await screen.findByText("Noted.");
    expect(postedKinds).toEqual(["normalize_claim", "tell"]);
  });
});
