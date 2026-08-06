import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { canonicalJson } from "./canonical-json.js";
import {
  DomainSeparatorError,
  base64UrlUtf8,
  domainSeparatedDigest,
  domainSeparatedPreimage,
  sha256Base64Url,
} from "./digest.js";

const PLAYER_VIEW_DOMAIN = "player-view:v1";

describe("sha256Base64Url", () => {
  it("matches the reference digest for known text", () => {
    expect(sha256Base64Url("")).toBe(
      createHash("sha256").update("").digest("base64url"),
    );
    expect(sha256Base64Url("the town remembers")).toBe(
      createHash("sha256").update("the town remembers", "utf8").digest("base64url"),
    );
  });

  it("uses unpadded base64url", () => {
    const digest = sha256Base64Url("bell");
    expect(digest).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(digest).toHaveLength(43);
  });

  it("hashes text as UTF-8 bytes", () => {
    expect(sha256Base64Url("🔔")).toBe(sha256Base64Url(Buffer.from("🔔", "utf8")));
  });
});

describe("domainSeparatedPreimage", () => {
  it("builds the exact accepted pre-image", () => {
    expect(domainSeparatedPreimage("claim-key:v1", ["a", "b"])).toBe(
      'claim-key:v1\n["a","b"]',
    );
  });

  it("rejects a separator that could collide with another domain", () => {
    for (const invalid of ["", "player-view", "player-view:1", "Player-View:v1"]) {
      expect(() => domainSeparatedPreimage(invalid, {})).toThrow(DomainSeparatorError);
    }
  });

  it("rejects a separator containing the delimiter", () => {
    expect(() => domainSeparatedPreimage("a:v1\nb:v1", {})).toThrow(
      DomainSeparatorError,
    );
  });
});

describe("domainSeparatedDigest", () => {
  it("separates domains that share a payload", () => {
    const payload = { town: "town_1" };
    expect(domainSeparatedDigest(PLAYER_VIEW_DOMAIN, payload)).not.toBe(
      domainSeparatedDigest("claim-key:v1", payload),
    );
  });

  it("ignores object key order but not array order", () => {
    expect(domainSeparatedDigest(PLAYER_VIEW_DOMAIN, { a: 1, b: 2 })).toBe(
      domainSeparatedDigest(PLAYER_VIEW_DOMAIN, { b: 2, a: 1 }),
    );
    expect(domainSeparatedDigest(PLAYER_VIEW_DOMAIN, [1, 2])).not.toBe(
      domainSeparatedDigest(PLAYER_VIEW_DOMAIN, [2, 1]),
    );
  });

  it("matches an independent digest of the same pre-image in another process", () => {
    const payload = {
      viewVersionInput: { map: [{ id: "loc_2" }, { id: "loc_1" }], town: "🔔" },
    };
    const preimage = domainSeparatedPreimage(PLAYER_VIEW_DOMAIN, payload);
    const script = [
      `import { createHash } from "node:crypto";`,
      `const preimage = Buffer.from(${JSON.stringify(Buffer.from(preimage, "utf8").toString("base64"))}, "base64");`,
      `process.stdout.write(createHash("sha256").update(preimage).digest("base64url"));`,
    ].join("");

    const external = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      { encoding: "utf8" },
    );

    expect(external).toBe(domainSeparatedDigest(PLAYER_VIEW_DOMAIN, payload));
  });

  it("produces the same canonical pre-image bytes in another process", () => {
    const payload = { b: [2, 1], a: { d: "🔔", c: null } };
    const modulePath = fileURLToPath(new URL("./canonical-json.ts", import.meta.url));
    const script = [
      `const { canonicalJson } = await import(${JSON.stringify(modulePath)});`,
      `process.stdout.write(canonicalJson(${JSON.stringify(payload)}));`,
    ].join("");

    const external = execFileSync(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", script],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );

    expect(external).toBe(canonicalJson(payload));
  });
});

describe("base64UrlUtf8", () => {
  it("encodes the accepted promise-offer representation", () => {
    const encoded = base64UrlUtf8("promise-offer:v1\naction_123\n0");
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(encoded, "base64url").toString("utf8")).toBe(
      "promise-offer:v1\naction_123\n0",
    );
  });

  it("round-trips non-ASCII text", () => {
    expect(Buffer.from(base64UrlUtf8("Mära 🔔"), "base64url").toString("utf8")).toBe(
      "Mära 🔔",
    );
  });
});
