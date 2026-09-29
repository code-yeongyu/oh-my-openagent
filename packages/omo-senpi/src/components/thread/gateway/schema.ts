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
    `CREATE TABLE bindings (
      binding_id TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL DEFAULT 1,
      revision INTEGER NOT NULL CHECK (revision >= 1),
      status TEXT NOT NULL CHECK (status IN ('active', 'detached', 'expired')),
      platform TEXT NOT NULL CHECK (platform IN ('discord', 'telegram', 'slack', 'herdr', 'custom')),
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
    `CREATE TABLE outbox (
      cursor INTEGER PRIMARY KEY AUTOINCREMENT,
      binding_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      event_kind TEXT NOT NULL CHECK (event_kind IN ('milestone', 'report', 'question', 'completion')),
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
    "ALTER TABLE outbox ADD COLUMN question_state TEXT CHECK (question_state IS NULL OR question_state IN ('pending', 'answered'))",
    "ALTER TABLE outbox ADD COLUMN answer TEXT",
    "ALTER TABLE outbox ADD COLUMN answered_at INTEGER",
    "ALTER TABLE outbox ADD COLUMN outcome TEXT CHECK (outcome IS NULL OR outcome IN ('completed', 'failed', 'cancelled'))",
    "CREATE UNIQUE INDEX outbox_reply_token ON outbox (reply_token) WHERE reply_token IS NOT NULL",
    `CREATE TABLE outbox_cursors (
      binding_id TEXT PRIMARY KEY,
      acked_cursor INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE completion_arms (
      session_durable_id TEXT NOT NULL,
      binding_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      text TEXT NOT NULL,
      armed_at INTEGER NOT NULL,
      PRIMARY KEY (session_durable_id, binding_id)
    )`,
    "INSERT OR IGNORE INTO gateway_meta (key, value) VALUES ('realm_id', 'realm-' || lower(hex(randomblob(16))))",
    "INSERT OR IGNORE INTO gateway_meta (key, value) VALUES ('token_secret', lower(hex(randomblob(32))))",
  ],
  // v3: which extension UI request a question row answers (the answer's wire shape depends on it;
  // NULL reads as `question`), and whether a claimed answer is still being handed over (`in_flight`)
  // or reached the session (`delivered`; NULL on rows answered before v3).
  [
    "ALTER TABLE outbox ADD COLUMN ui_request_kind TEXT CHECK (ui_request_kind IS NULL OR ui_request_kind IN ('question', 'select', 'confirm', 'input', 'editor'))",
    "ALTER TABLE outbox ADD COLUMN answer_state TEXT CHECK (answer_state IS NULL OR answer_state IN ('in_flight', 'delivered'))",
  ],
]

export const GATEWAY_TABLES = ["deliveries", "receipts", "causal_roots", "causal_edges", "rate_buckets", "session_meta", "bindings", "outbox", "gateway_meta", "outbox_cursors", "completion_arms"] as const
