/** Collapse contract-valid non-UUID opaque IDs before querying UUID columns. */
const DATABASE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function isDatabaseUuid(value: string): boolean {
  return DATABASE_UUID.test(value);
}
