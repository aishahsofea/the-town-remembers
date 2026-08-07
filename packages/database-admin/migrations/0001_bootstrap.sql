-- Roles, schemas, and the conventions every later migration relies on.
--
-- Roles are cluster-scoped in CockroachDB while grants are database-scoped, so
-- role creation is idempotent: a second disposable test database reuses the
-- same three identities. A managed cluster whose operator lacks role
-- administration can pre-create them; the IF NOT EXISTS clauses then no-op.
--
-- They are created as users, meaning WITH LOGIN, because the grant tests must
-- actually connect as each identity to prove a denial. Passwords are attached
-- by Phase 7, which owns Secrets Manager; nothing here stores a credential.

CREATE USER IF NOT EXISTS migration_admin;
CREATE USER IF NOT EXISTS app_runtime;
CREATE USER IF NOT EXISTS inspection_reader;

-- The judge- and developer-facing read model. Decision 005 keeps it in its own
-- schema so read-only access can be granted without naming a base table.
CREATE SCHEMA IF NOT EXISTS inspection;

-- The operator identity may create and alter objects in this database. Grants
-- are schema-scoped rather than database-scoped so no migration has to name a
-- database that is generated per disposable test target.
--
-- Runtime and inspection rights wait for 0013, once the objects they name
-- exist.
GRANT CREATE, USAGE ON SCHEMA public TO migration_admin;
GRANT CREATE, USAGE ON SCHEMA inspection TO migration_admin;
