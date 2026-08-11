/**
 * happy-dom carries no `indexedDB` implementation at all — `journal/db.ts`
 * needs one to be testable, so this polyfills it for every test file. Never
 * imported by application code, only by `vitest.config.ts`'s `setupFiles`.
 */

import "fake-indexeddb/auto";
