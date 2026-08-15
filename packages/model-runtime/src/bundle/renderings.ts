/**
 * `RenderingRecord`: one exact, application-supplied voiced alternative
 * Sonnet may select and order, never write. `buildRendering` is the single
 * place a template's authored text is validated before it can enter a
 * bundle — every check here runs at construction, not sampled later.
 *
 * `templateKey` is the content-authored stable key (`DisclosureTemplate
 * #templateKey` etc.) — readable in an error or an eval fixture. It is
 * *not* the opaque `r1`/`r2` id Decision 010's `rendering_ids` names:
 * `bundle/assemble.ts` assigns that ephemeral id (`D4-H`) over the sorted
 * set of template keys a bundle actually includes.
 */

import {
  NPC_DIALOGUE_RESPONSE_LIMITS,
  NPC_RESPONSE_KINDS,
  type NpcResponseKind,
} from "@the-town-remembers/model-contracts";

import { type AuthoredTemplateText } from "./safe-text.js";

export type RenderingValidationErrorCode =
  | "empty_text"
  | "markdown_detected"
  | "internal_id_leak"
  | "uuid_leak"
  | "response_kind_unsupported"
  | "unapproved_disclosure_id"
  | "unapproved_outcome_id"
  | "unapproved_episode_id"
  | "unapproved_entity_id"
  | "unapproved_actor_id"
  | "text_too_long";

export class RenderingValidationError extends Error {
  readonly code: RenderingValidationErrorCode;

  constructor(code: RenderingValidationErrorCode, detail: string) {
    super(detail);
    this.name = "RenderingValidationError";
    this.code = code;
  }
}

export interface RenderingRecord {
  readonly templateKey: string;
  readonly text: string;
  readonly responseKind: NpcResponseKind;
  readonly disclosureIds: readonly string[];
  readonly outcomeIds: readonly string[];
  readonly episodeIds: readonly string[];
  readonly entityIds: readonly string[];
  readonly actorIds: readonly string[];
  readonly styleTags: readonly string[];
}

export interface RenderingTemplateInput {
  readonly templateKey: string;
  readonly text: AuthoredTemplateText;
  readonly responseKind: string;
  readonly disclosureIds: readonly string[];
  readonly outcomeIds: readonly string[];
  readonly episodeIds: readonly string[];
  readonly entityIds: readonly string[];
  readonly actorIds: readonly string[];
  readonly styleTags: readonly string[];
}

/** Every id a rendering is allowed to reference, and every id assigned anywhere in the bundle (for the internal-id-leak check). */
export interface RenderingBundleSets {
  readonly allBundleIds: ReadonlySet<string>;
  readonly approvedDisclosureIds: ReadonlySet<string>;
  readonly approvedOutcomeIds: ReadonlySet<string>;
  readonly approvedEpisodeIds: ReadonlySet<string>;
  readonly approvedEntityIds: ReadonlySet<string>;
  readonly approvedActorIds: ReadonlySet<string>;
}

const RESPONSE_KIND_SET: ReadonlySet<string> = new Set(NPC_RESPONSE_KINDS);

/** A conservative, deliberately over-inclusive scan — authored prose has no reason to ever need real Markdown. */
const MARKDOWN_PATTERN = /\*\*|__|`|^#{1,6}\s|^[-*+]\s|\[.+?]\(.+?\)/m;
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/u)
    .filter((word) => word.length > 0).length;
}

function assertIdsApproved(
  ids: readonly string[],
  approved: ReadonlySet<string>,
  code: RenderingValidationErrorCode,
  templateKey: string,
): void {
  for (const id of ids) {
    if (!approved.has(id)) {
      throw new RenderingValidationError(
        code,
        `${templateKey} references unapproved id ${id}`,
      );
    }
  }
}

export function buildRendering(
  input: RenderingTemplateInput,
  bundleSets: RenderingBundleSets,
): RenderingRecord {
  const text: string = input.text;

  if (text.trim().length === 0) {
    throw new RenderingValidationError(
      "empty_text",
      `${input.templateKey} has empty text`,
    );
  }
  if (MARKDOWN_PATTERN.test(text)) {
    throw new RenderingValidationError(
      "markdown_detected",
      `${input.templateKey} contains Markdown syntax`,
    );
  }
  if (UUID_PATTERN.test(text)) {
    throw new RenderingValidationError(
      "uuid_leak",
      `${input.templateKey} text contains a UUID`,
    );
  }
  for (const bundleId of bundleSets.allBundleIds) {
    if (text.includes(bundleId)) {
      throw new RenderingValidationError(
        "internal_id_leak",
        `${input.templateKey} text contains bundle id ${bundleId}`,
      );
    }
  }
  if (!RESPONSE_KIND_SET.has(input.responseKind)) {
    throw new RenderingValidationError(
      "response_kind_unsupported",
      `${input.templateKey} response kind ${input.responseKind}`,
    );
  }
  if (countWords(text) > NPC_DIALOGUE_RESPONSE_LIMITS.maximumWords) {
    throw new RenderingValidationError(
      "text_too_long",
      `${input.templateKey} exceeds ${NPC_DIALOGUE_RESPONSE_LIMITS.maximumWords} words`,
    );
  }

  assertIdsApproved(
    input.disclosureIds,
    bundleSets.approvedDisclosureIds,
    "unapproved_disclosure_id",
    input.templateKey,
  );
  assertIdsApproved(
    input.outcomeIds,
    bundleSets.approvedOutcomeIds,
    "unapproved_outcome_id",
    input.templateKey,
  );
  assertIdsApproved(
    input.episodeIds,
    bundleSets.approvedEpisodeIds,
    "unapproved_episode_id",
    input.templateKey,
  );
  assertIdsApproved(
    input.entityIds,
    bundleSets.approvedEntityIds,
    "unapproved_entity_id",
    input.templateKey,
  );
  assertIdsApproved(
    input.actorIds,
    bundleSets.approvedActorIds,
    "unapproved_actor_id",
    input.templateKey,
  );

  return {
    templateKey: input.templateKey,
    text,
    responseKind: input.responseKind as NpcResponseKind,
    disclosureIds: input.disclosureIds,
    outcomeIds: input.outcomeIds,
    episodeIds: input.episodeIds,
    entityIds: input.entityIds,
    actorIds: input.actorIds,
    styleTags: input.styleTags,
  };
}
