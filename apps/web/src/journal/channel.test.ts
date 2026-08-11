import { describe, expect, it } from "vitest";

import { openJournalChannel } from "./channel.js";

describe("journal/channel", () => {
  it("delivers a posted message to a second channel instance's subscribers", async () => {
    const sender = openJournalChannel();
    const receiver = openJournalChannel();
    expect(sender).toBeDefined();
    expect(receiver).toBeDefined();

    const received = new Promise((resolve) => {
      receiver?.subscribe((message) => resolve(message));
    });

    sender?.post({ type: "pending", townId: "town-1", playerId: "player-1" });

    await expect(received).resolves.toStrictEqual({
      type: "pending",
      townId: "town-1",
      playerId: "player-1",
    });

    sender?.close();
    receiver?.close();
  });

  it("subscribe() returns an unsubscribe function that stops delivery", async () => {
    const sender = openJournalChannel();
    const receiver = openJournalChannel();
    let calls = 0;
    const unsubscribe = receiver?.subscribe(() => {
      calls += 1;
    });

    unsubscribe?.();
    sender?.post({ type: "cleared", townId: "town-1", playerId: "player-1" });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(calls).toBe(0);
    sender?.close();
    receiver?.close();
  });
});
