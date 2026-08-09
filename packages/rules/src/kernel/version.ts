/**
 * `RULES_REGISTRY`: one frozen object naming every numeric constant Decision
 * 008 fixes for `mvp-rules-v1`.
 *
 * Every field that already exists elsewhere is re-exported **by reference**,
 * not restated by value (`G2`): `version.test.ts` asserts each one with `===`
 * against its source, so a future edit to `database/domains` or `content`
 * cannot silently diverge from what this registry reports. Only fields with
 * no existing home are defined here for the first time.
 */

import { DIRECT_OBSERVATION_WEIGHT, RULES_VERSION } from "@the-town-remembers/content";
import {
  BELIEF_LABEL_BANDS,
  HOP_RANGE,
  IMPORTANCE_RANGE,
  MAXIMUM_NPC_RECIPIENT_HOP,
  SCORE_RANGE,
} from "@the-town-remembers/database/domains";
import {
  AMBIENT_CANDIDATE_SHORTLIST_SIZE,
  AMBIENT_MAXIMUM_SELECTIONS,
} from "@the-town-remembers/model-contracts";

export const RULES_REGISTRY = Object.freeze({
  rulesVersion: RULES_VERSION,

  // --- Re-exported by reference from database/domains -------------------
  scoreRange: SCORE_RANGE,
  importanceRange: IMPORTANCE_RANGE,
  hopRange: HOP_RANGE,
  maximumNpcRecipientHop: MAXIMUM_NPC_RECIPIENT_HOP,
  beliefLabelBands: BELIEF_LABEL_BANDS,

  // --- Re-exported by reference from model-contracts ---------------------
  ambientShortlistSize: AMBIENT_CANDIDATE_SHORTLIST_SIZE,
  ambientMaximumSelections: AMBIENT_MAXIMUM_SELECTIONS,

  // --- Re-exported by reference from content ------------------------------
  directObservationWeight: DIRECT_OBSERVATION_WEIGHT,

  // --- Evidence weights and formulas (P2-04) ------------------------------
  physicalClueMagnitude: 70,
  testimonyFormula: Object.freeze({
    playerBase: Object.freeze({ base: 35, trustDivisor: 10, minimum: 25, maximum: 45 }),
    npcBase: Object.freeze({ base: 40, trustDivisor: 10, minimum: 30, maximum: 50 }),
    hopPenaltyPerHop: 10,
    minimumTestimonyWeight: 10,
  }),
  corroboration: Object.freeze({ perSourceWeight: 15, maximumAdditionalSources: 2 }),

  // --- Belief thresholds (P2-05) ------------------------------------------
  selectedBelief: Object.freeze({ minimumScore: 20, minimumLead: 20 }),

  // --- Relationship deltas (P2-06) ----------------------------------------
  relationshipDeltas: Object.freeze({
    verified_testimony: Object.freeze({ trust: 10, suspicion: -5 }),
    evidence_presented: Object.freeze({ trust: 5, suspicion: -5 }),
    requested_item_given: Object.freeze({ trust: 15, suspicion: -5 }),
    promise_fulfilled: Object.freeze({ trust: 25, suspicion: -15 }),
    lie_established: Object.freeze({ trust: -30, suspicion: 40 }),
    promise_broken: Object.freeze({ trust: -40, suspicion: 35 }),
  }),
  stanceThresholds: Object.freeze({
    suspicionSuspicious: 40,
    trustTrusting: 40,
    trustWary: -20,
  }),

  // --- Disclosure thresholds (P2-07) --------------------------------------
  disclosureThresholds: Object.freeze({
    guarded: Object.freeze({ minimumTrust: 20, maximumSuspicionExclusive: 40 }),
    confidential: Object.freeze({ minimumTrust: 40, maximumSuspicionExclusive: 20 }),
  }),

  // --- Chapel access (P2-08) ----------------------------------------------
  chapelAccess: Object.freeze({
    nessaRouteA: Object.freeze({ minimumTrust: 40, maximumSuspicionExclusive: 40 }),
    corinRouteB: Object.freeze({ minimumTrust: 40, maximumSuspicionExclusive: 20 }),
  }),

  // --- Recall (P2-12) -------------------------------------------------------
  recall: Object.freeze({
    weights: Object.freeze({
      similarity: 0.45,
      recency: 0.15,
      importance: 0.15,
      directness: 0.1,
      commitmentOrGrievance: 0.1,
      activeContradiction: 0.05,
    }),
    recencyHalfLifeHours: 168,
    importanceMinimums: Object.freeze({
      directObservation: 90,
      hop0HeardTestimony: 60,
      hop1: 50,
      hop2Or3OrOrdinaryInteraction: 40,
      fulfilledPromiseOrUniqueItemTransfer: 85,
      brokenPromiseOrEstablishedLie: 100,
      otherConsequentialEvent: 80,
    }),
    activeContradictionEffectiveImportanceFloor: 80,
    directnessWeights: Object.freeze({
      directObservationOrItemOrPromiseOrConsequence: 1,
      hop0OriginalTestimony: 0.6,
      hop1PlusHearsay: 0.3,
      ordinaryInteractionWithoutClaim: 0.5,
    }),
    candidatePool: Object.freeze({
      maximumVectorCandidates: 30,
      maximumStructuredAnchors: 10,
    }),
    maximumResults: 8,
  }),

  // --- Ambient priority (P2-13) ---------------------------------------------
  ambient: Object.freeze({
    priorityWeights: Object.freeze({
      triggeringEventMatch: 50,
      recipientHoldsContradictoryBelief: 20,
      trustDivisor: 10,
      hopPenaltyPerHop: 10,
    }),
    speakerBeliefFloor: 20,
  }),

  // --- Case gate and resolution (P2-16) --------------------------------------
  caseGateRequiredClueCount: 3,
  resolutionReservationMinutes: 10,

  /** The exact boundary set Decision 008 requires exercised, quoted verbatim. */
  boundaryTestValues: Object.freeze([-20, 19, 20, 39, 40, 59, 60]),
} as const);

export type RulesRegistry = typeof RULES_REGISTRY;
