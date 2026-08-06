/**
 * Runtime parameter values accepted by Decision 007.
 *
 * These are typed constants only. Phase 0 exposes them so later phases share
 * one source; it implements none of the workflows they govern. Changing a
 * timeout here requires updating the coupled claim duration, SQS visibility,
 * transition-deadline analysis, tests, and CDK configuration together.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** Synchronous player request budget. */
export const PLAYER_API_TIMING = {
  apiGatewayIntegrationTimeoutMs: 30 * SECOND,
  lambdaHardTimeoutMs: 28 * SECOND,
  applicationBudgetMs: 24 * SECOND,
  reservedCommitWindowMs: 4 * SECOND,
  responseSerializationReserveMs: 500,
  processingClaimMs: 35 * SECOND,
  processingRetryAfterSeconds: 2,
  browserPollIntervalMs: 2 * SECOND,
  automaticRecoveryWindowMs: 70 * SECOND,
  simultaneousProcessingActionsPerPlayer: 1,
} as const;

/** SQS FIFO delivery parameters for the ambient tick. */
export const AMBIENT_QUEUE = {
  queueDeliveryDelaySeconds: 20,
  messageGroupIdSource: "town_id",
  deduplicationIdSource: "job_key",
  lambdaBatchSize: 1,
  eventSourceMaximumConcurrency: 5,
  functionReservedConcurrency: 5,
  visibilityTimeoutSeconds: 180,
  maximumReceiveCount: 5,
  sourceRetentionDays: 4,
  deadLetterRetentionDays: 14,
} as const;

/** Ambient Tick Lambda budget. Its claim outlives its worker. */
export const AMBIENT_WORKER_TIMING = {
  lambdaHardTimeoutMs: 30 * SECOND,
  applicationBudgetMs: 24 * SECOND,
  reservedCommitWindowMs: 4 * SECOND,
  processingClaimMs: 45 * SECOND,
} as const;

/** Bounded player transition after a departure with eligible work. */
export const AMBIENT_TRANSITION = {
  hardDeadlineMs: 5 * MINUTE,
  notBeforeDelayMs: 20 * SECOND,
} as const;

/** Best-effort post-commit publication and its durable retry path. */
export const OUTBOX_PUBLICATION = {
  initialSendBudgetMs: 2 * SECOND,
  sendClaimMs: 30 * SECOND,
} as const;

export const RECOVERY = {
  scheduleIntervalMs: 1 * MINUTE,
  lambdaHardTimeoutMs: 30 * SECOND,
  rowsPerInvocation: 25,
  failedSendBackoffMs: [1 * MINUTE, 2 * MINUTE],
} as const;

export const DATABASE = {
  connectionTimeoutMs: 3 * SECOND,
  maximumStatementTimeoutMs: 3 * SECOND,
  maximumTransactionDeadlineMs: 5 * SECOND,
  poolSizePerWarmEnvironment: 2,
  serializationRetryLimit: 3,
  serializationRetryDelaysMs: [25, 75, 225],
} as const;

export const MODEL_RETRIES = {
  townRevisionRerunLimit: 1,
  transportRetryLimit: 1,
  semanticRepairLimit: 1,
  processingTakeoverAttemptLimit: 3,
} as const;
