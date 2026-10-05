export class GatewaySchemaVersionError extends Error {
  readonly code = "gateway_schema_too_new"
  constructor(readonly found: number, readonly supported: number, scope = "Gateway") {
    super(`${scope} schema ${found} is newer than this binary's supported version ${supported}.`)
  }
}

export const GATEWAY_MIGRATIONS: readonly (readonly string[])[] = [
  [
    `CREATE TABLE deliveries (
      delivery_id TEXT PRIMARY KEY,
      target_durable_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      sender TEXT NOT NULL,
      sender_turn TEXT,
      envelope TEXT NOT NULL,
      body TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      mode_requested TEXT NOT NULL CHECK (mode_requested IN ('auto', 'steer', 'follow_up')),
      mode_effective TEXT CHECK (mode_effective IS NULL OR mode_effective IN ('steer', 'follow_up')),
      expected_turn_id INTEGER,
      state TEXT NOT NULL CHECK (state IN ('queued', 'admitting', 'admitted', 'applied', 'refused', 'uncertain')),
      reason TEXT,
      admitted_by TEXT,
      claimed_at INTEGER,
      attempt INTEGER NOT NULL DEFAULT 0,
      admission_kind TEXT,
      turn_epoch INTEGER,
      root_id TEXT NOT NULL,
      hop INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      binding_id TEXT,
      binding_revision INTEGER,
      UNIQUE (target_durable_id, seq)
    )`,
    "CREATE INDEX deliveries_target_state_seq ON deliveries (target_durable_id, state, seq)",
    "CREATE INDEX deliveries_root ON deliveries (root_id)",
    "CREATE INDEX deliveries_sender_turn ON deliveries (sender, sender_turn)",
    `CREATE TABLE receipts (
      principal TEXT NOT NULL,
      operation TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      args_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('prepared', 'completed', 'uncertain')),
      delivery_id TEXT,
      owner_instance TEXT NOT NULL,
      result TEXT,
      error_note TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (principal, operation, idempotency_key)
    )`,
    "CREATE INDEX receipts_expiry ON receipts (expires_at)",
    `CREATE TABLE causal_roots (
      root_id TEXT PRIMARY KEY,
      origin_principal TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`,
    `CREATE TABLE causal_edges (
      root_id TEXT NOT NULL,
      from_durable_id TEXT NOT NULL,
      to_durable_id TEXT NOT NULL,
      delivery_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (root_id, from_durable_id, to_durable_id)
    )`,
    `CREATE TABLE rate_buckets (
      sender TEXT NOT NULL,
      target_durable_id TEXT NOT NULL,
      tokens REAL NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (sender, target_durable_id)
    )`,
    `CREATE TABLE session_meta (
      durable_id TEXT PRIMARY KEY,
      next_seq INTEGER NOT NULL,
      applied_seq INTEGER NOT NULL DEFAULT 0
    )`,
    // `seq` is the rowid the bindings snapshot watermarks on (`store-relay-ops.ts` `listBindings`):
    // AUTOINCREMENT never hands a deleted binding's rowid to a later one, so a binding made after a
    // snapshot can never fall under its watermark, even when retention deleted the newest row.
    `CREATE TABLE bindings (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      binding_id TEXT NOT NULL UNIQUE,
      schema_version INTEGER NOT NULL DEFAULT 1,
      revision INTEGER NOT NULL CHECK (revision >= 1),
      status TEXT NOT NULL CHECK (status IN ('active', 'detached', 'expired')),
      platform TEXT NOT NULL CHECK (platform IN ('discord', 'telegram', 'slack', 'notion', 'feishu', 'herdr', 'custom')),
      account_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      root_message_id TEXT,
      progress_message_id TEXT,
      session_realm_id TEXT NOT NULL,
      session_durable_id TEXT NOT NULL,
      direction_inbound INTEGER NOT NULL CHECK (direction_inbound IN (0, 1)),
      direction_outbound INTEGER NOT NULL CHECK (direction_outbound IN (0, 1)),
      inbound_mode TEXT NOT NULL CHECK (inbound_mode IN ('auto', 'follow_up')),
      outbound_events TEXT NOT NULL,
      policy_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      lease_started_at TEXT NOT NULL,
      ttl_seconds INTEGER,
      expires_at TEXT,
      CHECK (direction_inbound = 1 OR direction_outbound = 1)
    )`,
    "CREATE UNIQUE INDEX bindings_one_active_thread ON bindings (platform, account_id, chat_id, thread_id) WHERE status = 'active'",
    "CREATE INDEX bindings_session ON bindings (session_durable_id, status)",
    // `question_closed` is reserved for question closure (a follow-up writes it when the session's
    // question ends); nothing writes it yet, but a CHECK cannot be widened after release without a rebuild.
    `CREATE TABLE outbox (
      cursor INTEGER PRIMARY KEY AUTOINCREMENT,
      binding_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      event_kind TEXT NOT NULL CHECK (event_kind IN ('milestone', 'report', 'question', 'completion', 'question_closed')),
      payload TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending', 'acked')),
      provider_message_id TEXT,
      created_at INTEGER NOT NULL,
      acked_at INTEGER
    )`,
    "CREATE INDEX outbox_binding_cursor ON outbox (binding_id, cursor)",
    `CREATE TABLE gateway_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  ],
  // v2 (todo 13): the relay side of bindings. Additive only: the session's incarnation (which
  // runtime registered it last, so a reply token outlives neither a restart nor a rebind), the
  // question/answer/completion columns of an outbox row, each binding's consumer cursor, and the
  // completions armed by `thread_report` that the session's next settle turns into outbox rows.
  // The store's realm id and reply-token secret are seeded here, once, so opening a migrated store
  // never takes the write lock.
  [
    "ALTER TABLE session_meta ADD COLUMN incarnation TEXT",
    "ALTER TABLE outbox ADD COLUMN session_durable_id TEXT",
    "ALTER TABLE outbox ADD COLUMN reply_token TEXT",
    "ALTER TABLE outbox ADD COLUMN ui_request_id TEXT",
    "ALTER TABLE outbox ADD COLUMN incarnation TEXT",
    // `expired` and `cancelled` are reserved for question closure (the session's terminal question
    // outcome); nothing writes them yet, but a CHECK cannot be widened after release without a rebuild.
    "ALTER TABLE outbox ADD COLUMN question_state TEXT CHECK (question_state IS NULL OR question_state IN ('pending', 'answered', 'expired', 'cancelled'))",
    "ALTER TABLE outbox ADD COLUMN answer TEXT",
    "ALTER TABLE outbox ADD COLUMN answered_at INTEGER",
    "ALTER TABLE outbox ADD COLUMN outcome TEXT CHECK (outcome IS NULL OR outcome IN ('completed', 'failed', 'cancelled'))",
    "CREATE UNIQUE INDEX outbox_reply_token ON outbox (reply_token) WHERE reply_token IS NOT NULL",
    `CREATE TABLE outbox_cursors (
      binding_id TEXT PRIMARY KEY,
      acked_cursor INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    // One row per arm (`arm_seq`), never one per binding: a later run's arm of the same binding must
    // not replace the arm of a run that settled while its completion write was still outstanding.
    `CREATE TABLE completion_arms (
      arm_seq INTEGER PRIMARY KEY AUTOINCREMENT,
      session_durable_id TEXT NOT NULL,
      binding_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      text TEXT NOT NULL,
      armed_at INTEGER NOT NULL
    )`,
    "CREATE INDEX completion_arms_session ON completion_arms (session_durable_id, armed_at)",
    "INSERT OR IGNORE INTO gateway_meta (key, value) VALUES ('realm_id', 'realm-' || lower(hex(randomblob(16))))",
    "INSERT OR IGNORE INTO gateway_meta (key, value) VALUES ('token_secret', lower(hex(randomblob(32))))",
  ],
  // v3: which extension UI request a question row answers (the answer's wire shape depends on it;
  // NULL when the session declared none), and whether a claimed answer is still being handed over
  // (`in_flight`) or reached the session (`delivered`; NULL on rows answered before v3, which count as
  // a claim made at their `answered_at`).
  [
    "ALTER TABLE outbox ADD COLUMN ui_request_kind TEXT CHECK (ui_request_kind IS NULL OR ui_request_kind IN ('question', 'select', 'confirm', 'input', 'editor'))",
    "ALTER TABLE outbox ADD COLUMN answer_state TEXT CHECK (answer_state IS NULL OR answer_state IN ('in_flight', 'delivered'))",
  ],
  // v4: who answered a question (`answered_by`, the connector's author record as JSON). NULL on a
  // question answered without an author, and on every row answered before v4.
  ["ALTER TABLE outbox ADD COLUMN answered_by TEXT"],
  // v5: the session's published control endpoint, fenced by its existing incarnation.
  [
    "ALTER TABLE session_meta ADD COLUMN endpoint_socket TEXT",
    "ALTER TABLE session_meta ADD COLUMN endpoint_kind TEXT CHECK (endpoint_kind IS NULL OR endpoint_kind IN ('tui', 'rpc_host'))",
  ],
  // v6: the store extension registry (each extension's applied migration version) and the connector
  // author an extension enqueue records on its delivery (`actor_user_id`, NULL without an author).
  [
    "CREATE TABLE extension_schema (name TEXT PRIMARY KEY, version INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
    "ALTER TABLE deliveries ADD COLUMN actor_user_id TEXT",
    "CREATE TABLE extension_objects (type TEXT NOT NULL, name TEXT NOT NULL, owner TEXT, PRIMARY KEY (type, name))",
    "INSERT INTO extension_objects (type, name, owner) SELECT type, name, NULL FROM sqlite_schema",
  ],
  // v7 (#9425): the model of each session the gateway created or re-modelled, and why it runs that
  // model (`auto` from the connected providers, `set` by config/user/lead, `fallback` after a provider
  // error). Keyed by durable id, so every resume path reads the same record. `chosen_*` is the model a
  // fallback overrode, restored on the engine's fallback-revert.
  [
    `CREATE TABLE session_models (
      durable_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      thinking_level TEXT,
      provenance TEXT NOT NULL CHECK (provenance IN ('auto', 'set', 'fallback')),
      set_by TEXT CHECK (set_by IS NULL OR set_by IN ('config', 'user', 'lead')),
      reason TEXT,
      chosen_provider TEXT,
      chosen_model_id TEXT,
      chosen_provenance TEXT CHECK (chosen_provenance IS NULL OR chosen_provenance IN ('auto', 'set')),
      updated_at INTEGER NOT NULL
    )`,
    // Every core migration after v6 reserves the objects it creates, so no extension can register a
    // name that prefixes them. An object an extension already owns keeps its one row: the registry
    // records extension objects in lower case while sqlite_schema keeps the DDL's case, so the match
    // ignores case.
    `INSERT OR IGNORE INTO extension_objects (type, name, owner)
     SELECT s.type, s.name, NULL FROM sqlite_schema s
     WHERE NOT EXISTS (SELECT 1 FROM extension_objects e WHERE e.type = s.type AND e.name = s.name COLLATE NOCASE)`,
  ],
  // v8 (#9429): a revision every write to a session's model record bumps. The command paths swap on
  // it, not on the row's values, so a writer holding an older read can never win after the record
  // moved and came back to the same values (A->B->A).
  ["ALTER TABLE session_models ADD COLUMN revision INTEGER NOT NULL DEFAULT 0"],
  // v9 (#9429): the choice of a set-model the engine held (`pending_*`), so the switch keeps its
  // setter when it lands; any switch that lands clears it, as it clears the engine's hold. Also drops
  // the second, core-owned row a case-sensitive v7 reservation added for a mixed-case extension object.
  [
    "ALTER TABLE session_models ADD COLUMN pending_provider TEXT",
    "ALTER TABLE session_models ADD COLUMN pending_model_id TEXT",
    "ALTER TABLE session_models ADD COLUMN pending_set_by TEXT CHECK (pending_set_by IS NULL OR pending_set_by IN ('config', 'user', 'lead'))",
    `DELETE FROM extension_objects WHERE owner IS NULL AND EXISTS (
       SELECT 1 FROM extension_objects e WHERE e.owner IS NOT NULL AND e.type = extension_objects.type AND e.name = extension_objects.name COLLATE NOCASE)`,
  ],
  // v10 (todo 14): who thread_create'd which session (`thread_creations`, durable so a parent is still
  // recognised after a host handoff or restart), and each store extension's persisted descriptor
  // (`extension_registrations`: module URL, migrations, session-callable ops, wake dir), upserted by
  // name, so an engine process lists the session tools another process registered.
  [
    `CREATE TABLE thread_creations (
      creator_durable_id TEXT NOT NULL,
      created_durable_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (creator_durable_id, created_durable_id)
    )`,
    "CREATE TABLE extension_registrations (name TEXT PRIMARY KEY, descriptor_json TEXT NOT NULL, updated_at INTEGER NOT NULL)",
    `INSERT OR IGNORE INTO extension_objects (type, name, owner)
     SELECT s.type, s.name, NULL FROM sqlite_schema s
     WHERE NOT EXISTS (SELECT 1 FROM extension_objects e WHERE e.type = s.type AND e.name = s.name COLLATE NOCASE)`,
  ],
]

export const GATEWAY_TABLES = ["deliveries", "receipts", "causal_roots", "causal_edges", "rate_buckets", "session_meta", "bindings", "outbox", "gateway_meta", "outbox_cursors", "completion_arms", "extension_schema", "extension_objects", "session_models", "thread_creations", "extension_registrations"] as const
