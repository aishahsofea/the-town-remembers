import { claimKeyV1 } from "@the-town-remembers/content";
import {
  CLAIM_PREDICATES,
  type ClaimNormalizationTrustedContext,
} from "@the-town-remembers/model-contracts";
import { describe, expect, it } from "vitest";

import { validateClaimNormalization } from "./normalization.js";

const TRUSTED_CONTEXT: ClaimNormalizationTrustedContext = {
  speaker_actor_id: "actor_lark",
  canonical_entities: [
    {
      entity_id: "ent_corin",
      kind: "character",
      display_name: "Corin Hale",
      aliases: [],
    },
    { entity_id: "ent_bell", kind: "item", display_name: "the bell", aliases: [] },
    {
      entity_id: "ent_chapel",
      kind: "location",
      display_name: "Old Chapel",
      aliases: [],
    },
    {
      entity_id: "ent_protect_lark",
      kind: "motive",
      display_name: "Protecting Lark",
      aliases: [],
    },
  ],
  canonical_actors: [
    { actor_id: "actor_lark", actor_kind: "player", display_name: "Lark", aliases: [] },
    {
      actor_id: "npc_corin",
      actor_kind: "npc",
      display_name: "Corin Hale",
      aliases: [],
    },
  ],
  predicate_signatures: [],
  allowed_contexts: [
    { context_key: "festival_night", aliases: [] },
    { context_key: "current", aliases: [] },
  ],
  default_context_key: "festival_night",
};

const VALID_ENTITY_BY_PREDICATE: Record<
  (typeof CLAIM_PREDICATES)[number],
  { subject: string; object: string }
> = {
  was_at: { subject: "ent_corin", object: "ent_chapel" },
  moved: { subject: "ent_corin", object: "ent_bell" },
  damaged: { subject: "ent_corin", object: "ent_bell" },
  is_at: { subject: "ent_bell", object: "ent_chapel" },
  acted_for: { subject: "ent_corin", object: "ent_protect_lark" },
};

function normalizedOutput(overrides: Record<string, unknown> = {}) {
  return {
    status: "normalized" as const,
    subject_entity_id: "ent_corin",
    predicate: "was_at" as const,
    object_entity_id: "ent_chapel",
    polarity: "positive" as const,
    context_key: "festival_night",
    alleged_source_actor_id: null,
    reason_code: null,
    ...overrides,
  };
}

describe("validateClaimNormalization: predicate signatures", () => {
  it.each(CLAIM_PREDICATES)(
    "accepts %s with its correct subject/object kinds",
    (predicate) => {
      const { subject, object } = VALID_ENTITY_BY_PREDICATE[predicate];
      const result = validateClaimNormalization(
        normalizedOutput({
          predicate,
          subject_entity_id: subject,
          object_entity_id: object,
        }),
        TRUSTED_CONTEXT,
      );
      expect(result.valid).toBe(true);
    },
  );

  it.each(CLAIM_PREDICATES)(
    "rejects %s when the subject/object kinds are swapped",
    (predicate) => {
      const { subject, object } = VALID_ENTITY_BY_PREDICATE[predicate];
      // Every fixture predicate here has a subject kind different from its
      // object kind, so swapping the two entities always breaks that specific
      // predicate's own required signature, regardless of what any other
      // predicate would accept.
      const result = validateClaimNormalization(
        normalizedOutput({
          predicate,
          subject_entity_id: object,
          object_entity_id: subject,
        }),
        TRUSTED_CONTEXT,
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.map((error) => error.code)).toContain(
          "invalid_predicate_signature",
        );
      }
    },
  );

  it("never coerces an invalid signature into a normalizedKey", () => {
    const result = validateClaimNormalization(
      normalizedOutput({
        predicate: "was_at",
        subject_entity_id: "ent_bell",
        object_entity_id: "ent_chapel",
      }),
      TRUSTED_CONTEXT,
    );
    expect(result.valid).toBe(false);
  });
});

describe("validateClaimNormalization: membership", () => {
  it("rejects an unknown subject entity id", () => {
    const result = validateClaimNormalization(
      normalizedOutput({ subject_entity_id: "ent_nope" }),
      TRUSTED_CONTEXT,
    );
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors.map((e) => e.code)).toContain("unknown_entity_id");
  });

  it("rejects an unallowed context key", () => {
    const result = validateClaimNormalization(
      normalizedOutput({ context_key: "not_a_real_context" }),
      TRUSTED_CONTEXT,
    );
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors.map((e) => e.code)).toContain("invalid_context_key");
  });

  it("rejects an alleged source actor id outside canonical_actors", () => {
    const result = validateClaimNormalization(
      normalizedOutput({ alleged_source_actor_id: "npc_nope" }),
      TRUSTED_CONTEXT,
    );
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors.map((e) => e.code)).toContain("unknown_entity_id");
  });

  it("accepts a valid alleged source actor id", () => {
    const result = validateClaimNormalization(
      normalizedOutput({ alleged_source_actor_id: "npc_corin" }),
      TRUSTED_CONTEXT,
    );
    expect(result.valid).toBe(true);
  });
});

describe("validateClaimNormalization: status/reason combinations", () => {
  it("rejects a normalized result that also carries a reason_code", () => {
    const result = validateClaimNormalization(
      normalizedOutput({ reason_code: "ambiguous_subject" }),
      TRUSTED_CONTEXT,
    );
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors.map((e) => e.code)).toContain("invalid_status_combination");
  });

  it("rejects a normalized result missing a claim field", () => {
    const result = validateClaimNormalization(
      normalizedOutput({ polarity: null }),
      TRUSTED_CONTEXT,
    );
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors.map((e) => e.code)).toContain("invalid_status_combination");
  });

  it("accepts needs_clarification with an ambiguity reason and every claim field null", () => {
    const result = validateClaimNormalization(
      {
        status: "needs_clarification",
        subject_entity_id: null,
        predicate: null,
        object_entity_id: null,
        polarity: null,
        context_key: null,
        alleged_source_actor_id: null,
        reason_code: "ambiguous_subject",
      },
      TRUSTED_CONTEXT,
    );
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.normalizedKey).toBeNull();
  });

  it("rejects needs_clarification using an unsupported-only reason code", () => {
    const result = validateClaimNormalization(
      {
        status: "needs_clarification",
        subject_entity_id: null,
        predicate: null,
        object_entity_id: null,
        polarity: null,
        context_key: null,
        alleged_source_actor_id: null,
        reason_code: "unknown_entity",
      },
      TRUSTED_CONTEXT,
    );
    expect(result.valid).toBe(false);
  });

  it("accepts unsupported with a partial-claim reason and every claim field null", () => {
    const result = validateClaimNormalization(
      {
        status: "unsupported",
        subject_entity_id: null,
        predicate: null,
        object_entity_id: null,
        polarity: null,
        context_key: null,
        alleged_source_actor_id: null,
        reason_code: "no_proposition",
      },
      TRUSTED_CONTEXT,
    );
    expect(result.valid).toBe(true);
  });

  it("rejects a non-normalized status that still carries a partial claim", () => {
    const result = validateClaimNormalization(
      {
        status: "unsupported",
        subject_entity_id: "ent_corin",
        predicate: null,
        object_entity_id: null,
        polarity: null,
        context_key: null,
        alleged_source_actor_id: null,
        reason_code: "no_proposition",
      },
      TRUSTED_CONTEXT,
    );
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors.map((e) => e.code)).toContain("invalid_status_combination");
  });
});

describe("validateClaimNormalization: normalized_key", () => {
  it("computes the exact claim-key:v1 representation, never reading one from output", () => {
    const result = validateClaimNormalization(normalizedOutput(), TRUSTED_CONTEXT);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.normalizedKey).toBe(
        claimKeyV1({
          subjectEntityType: "character",
          subjectEntityKey: "ent_corin",
          predicate: "was_at",
          objectEntityType: "location",
          objectEntityKey: "ent_chapel",
          polarity: "positive",
          contextKey: "festival_night",
        }),
      );
    }
  });
});
