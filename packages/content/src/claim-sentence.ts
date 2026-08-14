/**
 * Deterministic, template-rendered prose for a normalized claim tuple.
 *
 * `claim_normalization_v1` never returns prose — only canonical IDs
 * (Decision 010). A freshly normalized claim is not guaranteed to be one of
 * `content/claims.ts`'s hand-authored `AuthoredClaim`s (a player may state a
 * true grammatical tuple nobody wrote a `sentence` for), so the player-facing
 * `canonicalText` this module builds is generated from a fixed per-predicate
 * template and the same authored entity display names/context labels every
 * other player-safe surface uses — never model output, never player text.
 */

import type { EntityType } from "./entities.js";
import type { ContentRegistry } from "./registry.js";

export interface ClaimSentenceInput {
  readonly subjectEntityKey: string;
  readonly predicate: "was_at" | "moved" | "damaged" | "is_at" | "acted_for";
  readonly objectEntityKey: string;
  readonly polarity: "positive" | "negative";
  readonly contextKey: string;
}

type Phrase = (subject: string, object: string) => string;

const PREDICATE_TEMPLATES: Record<
  ClaimSentenceInput["predicate"],
  { readonly positive: Phrase; readonly negative: Phrase }
> = {
  was_at: {
    positive: (subject, object) => `${subject} was at ${object}`,
    negative: (subject, object) => `${subject} was not at ${object}`,
  },
  moved: {
    positive: (subject, object) => `${subject} moved ${object}`,
    negative: (subject, object) => `${subject} did not move ${object}`,
  },
  damaged: {
    positive: (subject, object) => `${subject} damaged ${object}`,
    negative: (subject, object) => `${subject} did not damage ${object}`,
  },
  is_at: {
    positive: (subject, object) => `${subject} is at ${object}`,
    negative: (subject, object) => `${subject} is not at ${object}`,
  },
  acted_for: {
    positive: (subject, object) => `${subject} acted out of ${object}`,
    negative: (subject, object) => `${subject} did not act out of ${object}`,
  },
};

export class UnknownClaimEntityError extends Error {
  constructor(entityKey: string) {
    super(`No authored entity is registered for key "${entityKey}".`);
    this.name = "UnknownClaimEntityError";
  }
}

export class UnknownClaimContextError extends Error {
  constructor(contextKey: string) {
    super(`No authored context is registered for key "${contextKey}".`);
    this.name = "UnknownClaimContextError";
  }
}

function displayNameFor(
  content: ContentRegistry,
  entityKey: string,
): { readonly displayName: string; readonly entityType: EntityType } {
  const entity = content.storyEntities.find(
    (candidate) => candidate.entityKey === entityKey,
  );
  if (entity === undefined) throw new UnknownClaimEntityError(entityKey);
  return { displayName: entity.displayName, entityType: entity.entityType };
}

export function renderClaimSentence(
  content: ContentRegistry,
  input: ClaimSentenceInput,
): string {
  const subject = displayNameFor(content, input.subjectEntityKey);
  const object = displayNameFor(content, input.objectEntityKey);
  const context = content.claimContexts.find(
    (candidate) => candidate.contextKey === input.contextKey,
  );
  if (context === undefined) throw new UnknownClaimContextError(input.contextKey);

  const sentence = PREDICATE_TEMPLATES[input.predicate][input.polarity](
    subject.displayName,
    object.displayName,
  );
  return `${sentence} (${context.displayLabel}).`;
}
