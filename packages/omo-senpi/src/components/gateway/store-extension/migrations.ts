/**
 * The `gateway_rules` store extension: omo owns the rendered-block table and the `rules_changed`
 * fanout mechanics; the gateway package computes the rules and calls the ops. The descriptor
 * (name + migrations) lives here so the registering component and the worker-side ops module
 * cannot drift apart.
 */

export const GATEWAY_RULES_EXTENSION_NAME = "gateway_rules"

export const GATEWAY_RULES_MIGRATIONS: readonly (readonly string[])[] = [
  [
    `CREATE TABLE gateway_rules_blocks (
      session_durable_id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      version TEXT NOT NULL,
      block TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
  ],
  [
    `CREATE TABLE gateway_rules_scope_versions (
      scope TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE gateway_rules_scope_members (
      session_durable_id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('lead', 'worker')),
      memory_identity TEXT,
      version INTEGER NOT NULL
    )`,
    `CREATE TABLE gateway_rules_learnings (
      scope TEXT NOT NULL,
      seq INTEGER NOT NULL,
      path TEXT NOT NULL,
      title TEXT NOT NULL,
      by_session TEXT NOT NULL,
      at INTEGER NOT NULL,
      PRIMARY KEY (scope, seq)
    )`,
    `CREATE TABLE gateway_rules_digest_cursors (
      scope TEXT NOT NULL,
      session_durable_id TEXT NOT NULL,
      last_seq INTEGER NOT NULL,
      PRIMARY KEY (scope, session_durable_id)
    )`,
  ],
]
