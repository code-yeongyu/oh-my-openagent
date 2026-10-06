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
]
