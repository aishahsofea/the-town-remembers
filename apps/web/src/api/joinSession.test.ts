import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearJoinSession, loadOrCreateJoinSession } from "./joinSession.js";

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  sessionStorage.clear();
});

describe("loadOrCreateJoinSession", () => {
  it("creates a fresh session with a 43-character base64url secret and a UUID key", () => {
    const session = loadOrCreateJoinSession("token-1");
    expect(session.inviteToken).toBe("token-1");
    expect(session.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(session.joinAttemptSecret).toHaveLength(43);
    expect(session.joinAttemptSecret).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("persists the session to sessionStorage", () => {
    loadOrCreateJoinSession("token-1");
    expect(sessionStorage.getItem("ttr.join-session")).not.toBeNull();
  });

  it("reuses the exact same session on a second call for the same token", () => {
    const first = loadOrCreateJoinSession("token-1");
    const second = loadOrCreateJoinSession("token-1");
    expect(second).toStrictEqual(first);
  });

  it("mints a fresh session when the stored one belongs to a different invite token", () => {
    const first = loadOrCreateJoinSession("token-1");
    const second = loadOrCreateJoinSession("token-2");
    expect(second.inviteToken).toBe("token-2");
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("mints a fresh session when the stored value is corrupt", () => {
    sessionStorage.setItem("ttr.join-session", "not json");
    const session = loadOrCreateJoinSession("token-1");
    expect(session.inviteToken).toBe("token-1");
  });
});

describe("clearJoinSession", () => {
  it("removes the stored session entirely", () => {
    loadOrCreateJoinSession("token-1");
    clearJoinSession();
    expect(sessionStorage.getItem("ttr.join-session")).toBeNull();
  });
});
