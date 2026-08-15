/** Types for the plain-JavaScript database-suite ownership lock. */

export interface DbSuiteLockRecord {
  readonly pid: number;
  readonly kind: string;
  readonly runId: string;
  readonly startedAt: string;
}

export declare const LOCK_PATH: string;

export declare function readOwner(lockPath?: string): DbSuiteLockRecord | undefined;

export declare class DbSuiteOwnershipError extends Error {
  readonly owner: DbSuiteLockRecord;
  constructor(owner: DbSuiteLockRecord, lockPath: string);
}

export declare function assertNoActiveOwner(lockPath?: string): void;

export declare function acquire(
  kind: string,
  options?: { lockPath?: string; pid?: number },
): DbSuiteLockRecord;

export declare function release(
  record: DbSuiteLockRecord,
  options?: { lockPath?: string },
): void;
