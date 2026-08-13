import { describe, expect, it } from "vitest";

import {
  buildRendering,
  RenderingValidationError,
  type RenderingBundleSets,
} from "./renderings.js";
import { authoredTemplateText } from "./safe-text.js";

const EMPTY_SETS: RenderingBundleSets = {
  allBundleIds: new Set(),
  approvedDisclosureIds: new Set(),
  approvedOutcomeIds: new Set(),
  approvedEpisodeIds: new Set(),
  approvedEntityIds: new Set(),
  approvedActorIds: new Set(),
};

function baseInput(overrides: Partial<Parameters<typeof buildRendering>[0]> = {}) {
  return {
    templateKey: "mara_public_bell_not_at_square_1",
    text: authoredTemplateText("The bell's gone from the square, plain as that."),
    responseKind: "answer",
    disclosureIds: [],
    outcomeIds: [],
    episodeIds: [],
    entityIds: [],
    actorIds: [],
    styleTags: ["plain"],
    ...overrides,
  };
}

describe("buildRendering", () => {
  it("builds a valid record from safe authored text", () => {
    const record = buildRendering(baseInput(), EMPTY_SETS);
    expect(record.text).toBe("The bell's gone from the square, plain as that.");
    expect(record.responseKind).toBe("answer");
  });

  it("rejects empty or whitespace-only text", () => {
    expect(() =>
      buildRendering(baseInput({ text: authoredTemplateText("   ") }), EMPTY_SETS),
    ).toThrow(RenderingValidationError);
    try {
      buildRendering(baseInput({ text: authoredTemplateText("") }), EMPTY_SETS);
    } catch (error) {
      expect((error as RenderingValidationError).code).toBe("empty_text");
    }
  });

  it.each([
    ["bold markdown", "**important**"],
    ["a code fence", "```danger```"],
    ["a heading", "# Announcement"],
    ["a markdown link", "[click here](http://example.com)"],
  ])("rejects %s", (_label, text) => {
    const error = catchError(() =>
      buildRendering(baseInput({ text: authoredTemplateText(text) }), EMPTY_SETS),
    );
    expect(error).toBeInstanceOf(RenderingValidationError);
    expect((error as RenderingValidationError).code).toBe("markdown_detected");
  });

  it("rejects a UUID inside the text", () => {
    const text = authoredTemplateText(
      "Row 3f2504e0-4f89-11d3-9a0c-0305e82c3301 confirmed it.",
    );
    const error = catchError(() => buildRendering(baseInput({ text }), EMPTY_SETS));
    expect((error as RenderingValidationError).code).toBe("uuid_leak");
  });

  it("rejects text that leaks any bundle id, even one this rendering doesn't reference", () => {
    const sets: RenderingBundleSets = {
      ...EMPTY_SETS,
      allBundleIds: new Set(["d1", "o2"]),
    };
    const text = authoredTemplateText("The disclosure is tagged d1 internally.");
    const error = catchError(() => buildRendering(baseInput({ text }), sets));
    expect((error as RenderingValidationError).code).toBe("internal_id_leak");
  });

  it("rejects an unsupported response kind", () => {
    const error = catchError(() =>
      buildRendering(baseInput({ responseKind: "monologue" }), EMPTY_SETS),
    );
    expect((error as RenderingValidationError).code).toBe("response_kind_unsupported");
  });

  it("rejects text longer than the accepted word limit", () => {
    const longText = authoredTemplateText(
      Array.from({ length: 81 }, () => "word").join(" "),
    );
    const error = catchError(() =>
      buildRendering(baseInput({ text: longText }), EMPTY_SETS),
    );
    expect((error as RenderingValidationError).code).toBe("text_too_long");
  });

  it.each([
    ["disclosureIds", "unapproved_disclosure_id"],
    ["outcomeIds", "unapproved_outcome_id"],
    ["episodeIds", "unapproved_episode_id"],
    ["entityIds", "unapproved_entity_id"],
    ["actorIds", "unapproved_actor_id"],
  ] as const)("rejects an unapproved %s entry", (field, code) => {
    const error = catchError(() =>
      buildRendering(baseInput({ [field]: ["nope"] }), EMPTY_SETS),
    );
    expect((error as RenderingValidationError).code).toBe(code);
  });

  it("accepts ids that are present in the approved sets", () => {
    const sets: RenderingBundleSets = {
      allBundleIds: new Set(["d1", "o1", "e1"]),
      approvedDisclosureIds: new Set(["d1"]),
      approvedOutcomeIds: new Set(["o1"]),
      approvedEpisodeIds: new Set(["e1"]),
      approvedEntityIds: new Set(["ent_bell"]),
      approvedActorIds: new Set(["npc_mara"]),
    };
    const record = buildRendering(
      baseInput({
        disclosureIds: ["d1"],
        outcomeIds: ["o1"],
        episodeIds: ["e1"],
        entityIds: ["ent_bell"],
        actorIds: ["npc_mara"],
      }),
      sets,
    );
    expect(record.disclosureIds).toStrictEqual(["d1"]);
  });
});

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected fn to throw");
}
