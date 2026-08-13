/**
 * Semantic validation for `npc_dialogue_v1` (Decision 010). The model
 * selects and orders exact application-supplied rendering IDs; application
 * code derives every disclosure/outcome/episode/entity/actor reference from
 * the selected records and builds the exact concatenated text — the model
 * never contributes prose. Every check here runs on the model's
 * `{response_kind, rendering_ids}` selection against the same
 * `NpcDialogueTrustedContext` sent with the call.
 */

import type {
  NpcDialogueTrustedContext,
  NpcDialogueV1,
  RepairValidationError,
} from "@the-town-remembers/model-contracts";

import { buildValidationError } from "./errors.js";

export interface DialogueValidationSuccess {
  readonly valid: true;
  readonly result: NpcDialogueV1;
  /** The selected renderings, in the model's chosen order. */
  readonly selectedRenderings: readonly NpcDialogueTrustedContext["approved_renderings"][number][];
  readonly concatenatedText: string;
  readonly expressedDisclosureIds: readonly string[];
  readonly expressedOutcomeIds: readonly string[];
  readonly expressedEpisodeIds: readonly string[];
  readonly expressedEntityIds: readonly string[];
  readonly expressedActorIds: readonly string[];
}

export interface DialogueValidationFailure {
  readonly valid: false;
  readonly errors: readonly RepairValidationError[];
}

export type DialogueValidationResult =
  DialogueValidationSuccess | DialogueValidationFailure;

const MARKDOWN_PATTERN = /\*\*|__|`|^#{1,6}\s|^[-*+]\s|\[.+?]\(.+?\)/m;
/** A single word or short phrase wrapped in single asterisks, e.g. `*sighs*` — a common stage-direction convention distinct from `**bold**`. */
const STAGE_DIRECTION_PATTERN = /\*[^*\n]+\*/;

function countSentences(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  const matches = trimmed.match(/[^.!?]+[.!?]+(\s|$)/gu);
  return matches ? matches.length : 1;
}

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/u)
    .filter((word) => word.length > 0).length;
}

export function validateNpcDialogueSelection(
  output: NpcDialogueV1,
  trustedContext: NpcDialogueTrustedContext,
): DialogueValidationResult {
  const shapeErrors: RepairValidationError[] = [];
  const renderingById = new Map(
    trustedContext.approved_renderings.map((rendering) => [
      rendering.rendering_id,
      rendering,
    ]),
  );
  const allowedResponseKinds = new Set(trustedContext.allowed_response_kinds);

  if (!allowedResponseKinds.has(output.response_kind)) {
    shapeErrors.push(buildValidationError("response_kind_conflict", "$.response_kind"));
  }

  const { rendering_ids: renderingIds } = output;
  const limits = trustedContext.response_limits;
  if (
    renderingIds.length < limits.minimum_renderings ||
    renderingIds.length > limits.maximum_renderings
  ) {
    shapeErrors.push(
      buildValidationError("rendering_limit_exceeded", "$.rendering_ids"),
    );
  }
  if (new Set(renderingIds).size !== renderingIds.length) {
    shapeErrors.push(buildValidationError("duplicate_choice", "$.rendering_ids"));
  }

  const selectedRenderings: NpcDialogueTrustedContext["approved_renderings"][number][] =
    [];
  renderingIds.forEach((renderingId, index) => {
    const rendering = renderingById.get(renderingId);
    if (!rendering) {
      shapeErrors.push(
        buildValidationError("unknown_rendering_id", `$.rendering_ids[${index}]`),
      );
      return;
    }
    if (rendering.response_kind !== output.response_kind) {
      shapeErrors.push(
        buildValidationError("response_kind_conflict", `$.rendering_ids[${index}]`),
      );
      return;
    }
    selectedRenderings.push(rendering);
  });

  // A gate result other than "passed" means the deterministic gate already
  // denied something; a substantive "answer" selected anyway contradicts
  // that denial. approved_renderings is itself pre-filtered to gate-passing
  // content by bundle assembly (P4-02), so this is the one remaining case
  // this validator alone can still catch: the response kind disagreeing
  // with a denial gate result.
  if (
    trustedContext.dialogue_directive.gate_result !== "passed" &&
    output.response_kind === "answer"
  ) {
    shapeErrors.push(buildValidationError("gate_result_conflict", "$.response_kind"));
  }

  if (shapeErrors.length > 0) return { valid: false, errors: shapeErrors };

  const expressedDisclosureIds = dedupeInOrder(
    selectedRenderings.flatMap((rendering) => rendering.disclosure_ids),
  );
  const expressedOutcomeIds = dedupeInOrder(
    selectedRenderings.flatMap((rendering) => rendering.outcome_ids),
  );
  const expressedEpisodeIds = dedupeInOrder(
    selectedRenderings.flatMap((rendering) => rendering.episode_ids),
  );
  const expressedEntityIds = dedupeInOrder(
    selectedRenderings.flatMap((rendering) => rendering.entity_ids),
  );
  const expressedActorIds = dedupeInOrder(
    selectedRenderings.flatMap((rendering) => rendering.actor_ids),
  );

  const derivedErrors: RepairValidationError[] = [];
  for (const requiredId of trustedContext.required_disclosure_ids) {
    if (!expressedDisclosureIds.includes(requiredId)) {
      derivedErrors.push(
        buildValidationError("missing_required_disclosure", "$.rendering_ids"),
      );
    }
  }
  for (const requiredId of trustedContext.required_outcome_ids) {
    if (!expressedOutcomeIds.includes(requiredId)) {
      derivedErrors.push(
        buildValidationError("missing_required_outcome", "$.rendering_ids"),
      );
    }
  }
  if (
    expressedDisclosureIds.length > limits.maximum_disclosures ||
    expressedOutcomeIds.length > limits.maximum_outcomes ||
    expressedEpisodeIds.length > limits.maximum_episode_references ||
    expressedEntityIds.length > limits.maximum_entity_references ||
    expressedActorIds.length > limits.maximum_actor_references
  ) {
    derivedErrors.push(
      buildValidationError("rendering_limit_exceeded", "$.rendering_ids"),
    );
  }

  const concatenatedText = selectedRenderings
    .map((rendering) => rendering.text)
    .join(" ");

  // Decision 010 requires the Markdown/stage-direction/no-ID checks a
  // second time here, "when the rendering record is constructed and again
  // after concatenation." Every individual rendering already passed the
  // identical checks at construction (P4-02's buildRendering) and
  // plain-space concatenation of already-clean strings cannot introduce
  // new Markdown or a new ID substring — so these three checks are
  // intentional defense-in-depth against a future change to either side (a
  // different separator, a rendering built outside buildRendering) rather
  // than reachable in the current pipeline. There is no more specific code
  // among the eighteen for "concatenated text carries Markdown/stage
  // direction/an ID", so response_too_long — the one code Decision 010
  // groups with this exact bullet — is reused for all three.
  if (MARKDOWN_PATTERN.test(concatenatedText)) {
    derivedErrors.push(buildValidationError("response_too_long", "$.rendering_ids"));
  }
  if (STAGE_DIRECTION_PATTERN.test(concatenatedText)) {
    derivedErrors.push(buildValidationError("response_too_long", "$.rendering_ids"));
  }
  const allIds = [
    ...trustedContext.approved_disclosures.map((d) => d.disclosure_id),
    ...trustedContext.approved_outcomes.map((o) => o.outcome_id),
    ...trustedContext.approved_episodes.map((e) => e.episode_id),
    ...trustedContext.approved_renderings.map((r) => r.rendering_id),
  ];
  if (allIds.some((id) => concatenatedText.includes(id))) {
    derivedErrors.push(buildValidationError("response_too_long", "$.rendering_ids"));
  }
  if (
    countSentences(concatenatedText) > limits.maximum_sentences ||
    countWords(concatenatedText) > limits.maximum_words
  ) {
    derivedErrors.push(buildValidationError("response_too_long", "$.rendering_ids"));
  }

  if (derivedErrors.length > 0) return { valid: false, errors: derivedErrors };

  return {
    valid: true,
    result: output,
    selectedRenderings,
    concatenatedText,
    expressedDisclosureIds,
    expressedOutcomeIds,
    expressedEpisodeIds,
    expressedEntityIds,
    expressedActorIds,
  };
}

function dedupeInOrder(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}
