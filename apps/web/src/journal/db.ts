/**
 * `PendingActionJournal` (Decision 011 §"Local action journal"), one
 * IndexedDB store keyed by `[townId, playerId]` — at most one pending entry
 * per player at a time, matching the server's own "at most one action may
 * be `processing` for a player" invariant. Carries no cookie, invite token,
 * join secret, or server credential; only what's needed to resend or poll
 * the exact same action.
 */

import type { ActionRequest } from "@the-town-remembers/http-contracts";

export interface PendingActionJournalEntry {
  readonly townId: string;
  readonly playerId: string;
  readonly idempotencyKey: string;
  readonly requestBody: ActionRequest;
  readonly createdAt: string;
  readonly actionId?: string;
  readonly statusLocation?: string;
  readonly pollAfterMs: number;
  readonly takeoverPostSent: boolean;
}

const DB_NAME = "ttr-action-journal";
const DB_VERSION = 1;
const STORE_NAME = "pendingActions";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: ["townId", "playerId"] });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open the journal."));
  });
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        const request = run(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Journal operation failed."));
        transaction.oncomplete = () => db.close();
      }),
  );
}

export async function writeJournalEntry(entry: PendingActionJournalEntry): Promise<void> {
  await runTransaction("readwrite", (store) => store.put(entry));
}

export async function readJournalEntry(
  townId: string,
  playerId: string,
): Promise<PendingActionJournalEntry | undefined> {
  const result = await runTransaction<PendingActionJournalEntry | undefined>(
    "readonly",
    (store) => store.get([townId, playerId]) as IDBRequest<PendingActionJournalEntry | undefined>,
  );
  return result;
}

export async function deleteJournalEntry(townId: string, playerId: string): Promise<void> {
  await runTransaction("readwrite", (store) => store.delete([townId, playerId]));
}
