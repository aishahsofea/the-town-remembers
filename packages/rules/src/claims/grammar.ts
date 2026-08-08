/**
 * The bounded claim grammar (Decision 005) and the cross-package equality
 * fixture `D2-D` requires before any rule depends on any one copy of it.
 *
 * `database/domains#CLAIM_ENTITY_MATRIX`, `content#CLAIM_ENTITY_MATRIX`, and
 * `model-contracts#CLAIM_PREDICATE_SIGNATURES` are three independently
 * authored objects encoding the same five-predicate matrix. This module
 * depends on `content`'s copy for validation (the one `CLAIMS`/
 * `CLAIM_RELATIONS` in this package actually consume), and
 * `assertClaimMatricesAgree` proves all three still agree before that
 * dependency is trusted.
 */

import { CLAIM_ENTITY_MATRIX as CONTENT_CLAIM_ENTITY_MATRIX } from "@the-town-remembers/content";
import { CLAIM_ENTITY_MATRIX as DATABASE_CLAIM_ENTITY_MATRIX } from "@the-town-remembers/database/domains";
import { CLAIM_PREDICATE_SIGNATURES } from "@the-town-remembers/model-contracts";

import type { ReasonCode } from "../kernel/reason-codes.js";

const CLAIM_POLARITIES = ["positive", "negative"] as const;

/**
 * Deep-equality is exactly what `D2-D` requires: the three objects must be
 * the same closed matrix, not merely `===` (they are three distinct object
 * literals by construction).
 */
export function claimMatricesAgree(): boolean {
  const predicates = Object.keys(CONTENT_CLAIM_ENTITY_MATRIX);
  const databasePredicates = Object.keys(DATABASE_CLAIM_ENTITY_MATRIX);
  const contractPredicates = Object.keys(CLAIM_PREDICATE_SIGNATURES);

  if (
    predicates.length !== databasePredicates.length ||
    predicates.length !== contractPredicates.length
  ) {
    return false;
  }

  return predicates.every((predicate) => {
    const fromContent = (
      CONTENT_CLAIM_ENTITY_MATRIX as Record<string, { subject: string; object: string }>
    )[predicate];
    const fromDatabase = (
      DATABASE_CLAIM_ENTITY_MATRIX as Record<
        string,
        { subject: string; object: string }
      >
    )[predicate];
    const fromContracts = (
      CLAIM_PREDICATE_SIGNATURES as Record<string, { subject: string; object: string }>
    )[predicate];
    return (
      fromDatabase !== undefined &&
      fromContracts !== undefined &&
      fromContent!.subject === fromDatabase.subject &&
      fromContent!.object === fromDatabase.object &&
      fromContent!.subject === fromContracts.subject &&
      fromContent!.object === fromContracts.object
    );
  });
}

export class ClaimMatrixDriftError extends Error {
  constructor() {
    super(
      "database/domains#CLAIM_ENTITY_MATRIX, content#CLAIM_ENTITY_MATRIX, and " +
        "model-contracts#CLAIM_PREDICATE_SIGNATURES have drifted apart.",
    );
    this.name = "ClaimMatrixDriftError";
  }
}

/** Fails closed the moment any rule would otherwise depend on a drifted copy. */
export function assertClaimMatricesAgree(): void {
  if (!claimMatricesAgree()) throw new ClaimMatrixDriftError();
}

export interface ClaimTupleCandidate {
  readonly subjectEntityType: string;
  readonly subjectEntityKey: string;
  readonly predicate: string;
  readonly objectEntityType: string;
  readonly objectEntityKey: string;
  readonly polarity: string;
  readonly contextKey: string;
  readonly allegedSourceActorId?: string | null;
}

export type ClaimTupleValidationResult =
  { readonly valid: true } | { readonly valid: false; readonly reasonCode: ReasonCode };

const VALID: ClaimTupleValidationResult = { valid: true };

function invalid(reasonCode: ReasonCode): ClaimTupleValidationResult {
  return { valid: false, reasonCode };
}

/**
 * Validates a candidate claim tuple against the accepted grammar: predicate
 * membership, the predicate's fixed subject/object entity types, polarity,
 * a non-empty context key, and an optional alleged-source shape.
 */
export function validateClaimTuple(
  candidate: ClaimTupleCandidate,
): ClaimTupleValidationResult {
  const roles = (
    CONTENT_CLAIM_ENTITY_MATRIX as Record<
      string,
      { readonly subject: string; readonly object: string } | undefined
    >
  )[candidate.predicate];
  if (roles === undefined) return invalid("INVALID_CLAIM_TUPLE");

  if (candidate.subjectEntityType !== roles.subject)
    return invalid("INVALID_CLAIM_TUPLE");
  if (candidate.objectEntityType !== roles.object)
    return invalid("INVALID_CLAIM_TUPLE");
  if (candidate.subjectEntityKey.length === 0) return invalid("INVALID_CLAIM_TUPLE");
  if (candidate.objectEntityKey.length === 0) return invalid("INVALID_CLAIM_TUPLE");
  if (!(CLAIM_POLARITIES as readonly string[]).includes(candidate.polarity)) {
    return invalid("INVALID_CLAIM_TUPLE");
  }
  if (candidate.contextKey.length === 0) return invalid("INVALID_CLAIM_TUPLE");
  if (
    candidate.allegedSourceActorId !== undefined &&
    candidate.allegedSourceActorId !== null &&
    candidate.allegedSourceActorId.length === 0
  ) {
    return invalid("INVALID_CLAIM_TUPLE");
  }

  return VALID;
}
