/**
 * The single repair-input builder (Decision 010, "Structured repair"). It
 * assembles the original trusted context, the original untrusted text, the
 * rejected output, and this package's own sanitized errors — and refuses
 * outright when the failure it's building a repair for was itself already a
 * repair attempt. There is no repair-of-repair call.
 */

import {
  buildClaimNormalizationRepairInput,
  buildNpcDialogueRepairInput,
  type ClaimNormalizationRepairInputV1,
  type ClaimNormalizationTrustedContext,
  type NpcDialogueRepairInputV1,
  type NpcDialogueTrustedContext,
  type RepairValidationError,
} from "@the-town-remembers/model-contracts";

/** Which attempt just failed and needs a repair built for it. */
export type ModelAttemptKind = "original" | "repair";

export class RepairOfRepairError extends Error {
  constructor() {
    super(
      "Cannot build a repair input from an attempt that was itself already a repair.",
    );
    this.name = "RepairOfRepairError";
  }
}

function assertNotRepairOfRepair(failedAttemptKind: ModelAttemptKind): void {
  if (failedAttemptKind === "repair") throw new RepairOfRepairError();
}

export interface BuildRepairFromFailureParams<TrustedContext> {
  readonly failedAttemptKind: ModelAttemptKind;
  readonly trustedContext: TrustedContext;
  readonly untrustedPlayerText?: string;
  /** The exact rejected output, carried as opaque quoted data — never parsed or re-interpreted here. */
  readonly rawInvalidOutput: string;
  readonly validationErrors: readonly RepairValidationError[];
}

export function buildClaimNormalizationRepairFromFailure(
  params: BuildRepairFromFailureParams<ClaimNormalizationTrustedContext>,
): ClaimNormalizationRepairInputV1 {
  assertNotRepairOfRepair(params.failedAttemptKind);
  return buildClaimNormalizationRepairInput({
    trustedContext: params.trustedContext,
    ...(params.untrustedPlayerText === undefined
      ? {}
      : { untrustedPlayerText: params.untrustedPlayerText }),
    untrustedInvalidOutput: params.rawInvalidOutput,
    validationErrors: params.validationErrors,
  });
}

export function buildNpcDialogueRepairFromFailure(
  params: BuildRepairFromFailureParams<NpcDialogueTrustedContext>,
): NpcDialogueRepairInputV1 {
  assertNotRepairOfRepair(params.failedAttemptKind);
  return buildNpcDialogueRepairInput({
    trustedContext: params.trustedContext,
    ...(params.untrustedPlayerText === undefined
      ? {}
      : { untrustedPlayerText: params.untrustedPlayerText }),
    untrustedInvalidOutput: params.rawInvalidOutput,
    validationErrors: params.validationErrors,
  });
}
