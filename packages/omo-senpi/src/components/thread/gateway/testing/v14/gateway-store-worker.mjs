import { createHash as il, randomUUID as fs } from "node:crypto"
import {
  chmodSync as fo,
  closeSync as al,
  existsSync as sl,
  mkdirSync as ys,
  openSync as dl,
  renameSync as ul,
  writeFileSync as ml,
} from "node:fs"
import { dirname as ll, join as pl } from "node:path"
import { setTimeout as ls } from "node:timers/promises"
import { parentPort as cl } from "node:worker_threads"
var wn = 8,
  kn = 5000,
  sr = 16,
  xo = 4,
  Jn = 60000,
  dr = 86400000,
  ur = 604800000,
  mr = 128,
  nn = 1048576,
  Rn = 2592000000,
  ho = 2592000000,
  tn = 256,
  To = 3600000
var Io = "session_control_delivery",
  lr = "session_released"
function Zn(e, n, t) {
  return Object.assign(
    Error(
      `gateway store lock wait exceeded: ${e} waited ${n} ms for the write lock (limit ${t} ms); another process holds it`,
    ),
    { code: "gateway_lock_wait_exceeded" },
  )
}
function Sn(e) {
  return typeof e === "object" && e !== null && e.code === "gateway_lock_wait_exceeded"
}
function wo(e, n, t) {
  let r,
    o = !1,
    i = () => {
      ;((r = setTimeout(() => {
        if (((r = void 0), o)) return
        e().catch((s) => {
          if (o) return
          if (Sn(s)) i()
          else t(s)
        })
      }, n())),
        r.unref?.())
    }
  return (
    i(),
    {
      cancel: () => {
        ;((o = !0), clearTimeout(r))
      },
    }
  )
}
import { join as vn } from "node:path"
function rn(e) {
  return vn(e, "gateway")
}
function et(e) {
  return vn(rn(e), "gateway.sqlite")
}
function nt(e, n) {
  return vn(rn(e), "inbox", n)
}
function ko(e) {
  return vn(rn(e), "wake.marker")
}
function Ro(e) {
  return vn(rn(e), "outbox.marker")
}
import { execFile as Is } from "node:child_process"
var So = "epoch:",
  ws = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
function ks(e) {
  let n = /^[A-Z][a-z]{2} ([A-Z][a-z]{2}) +(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(e.trim())
  if (n === null) return null
  let [, t, r, o, i, s, u] = n,
    a = ws.indexOf(t)
  if (a < 0) return null
  return Date.UTC(Number(u), a, Number(r), Number(o), Number(i), Number(s)) / 1000
}
function pr(e) {
  return new Promise((n) => {
    Is(
      "ps",
      ["-o", "lstart=", "-p", String(e)],
      { env: { ...process.env, LC_ALL: "C", LANG: "C", TZ: "UTC" }, windowsHide: !0, timeout: 5000 },
      (t, r) => {
        let o = t === null ? ks(r) : null
        n(o === null ? null : `${So}${o}`)
      },
    )
  })
}
function Rs(e) {
  try {
    return (process.kill(e, 0), !0)
  } catch (n) {
    return !(n instanceof Error && "code" in n && n.code === "ESRCH")
  }
}
async function On(e) {
  if (!Rs(e.pid)) return !0
  if (e.process_start_time === null || !e.process_start_time.startsWith(So)) return !1
  let n = await pr(e.pid)
  return n !== null && n !== e.process_start_time
}
function tt(e, n) {
  return e.pid === n.pid && e.process_start_time === n.process_start_time && e.instance_id === n.instance_id
}
function vo(e) {
  if (typeof e !== "object" || e === null) return !1
  return (
    "workspace" in e &&
    typeof e.workspace === "string" &&
    e.workspace.trim().length > 0 &&
    "project" in e &&
    typeof e.project === "string" &&
    e.project.trim().length > 0 &&
    (!("lane" in e) || e.lane === void 0 || (typeof e.lane === "string" && e.lane.trim().length > 0)) &&
    (!("session" in e) || e.session === void 0 || (typeof e.session === "string" && e.session.trim().length > 0))
  )
}
var rt = [
  `CREATE TRIGGER IF NOT EXISTS deliveries_require_provenance BEFORE INSERT ON deliveries
    WHEN CASE WHEN json_valid(NEW.envelope) THEN
      coalesce(json_type(NEW.envelope, '$.provenance'), '') != 'object'
      OR coalesce(json_type(NEW.envelope, '$.provenance.workspace'), '') != 'text'
      OR coalesce(length(trim(json_extract(NEW.envelope, '$.provenance.workspace'))), 0) = 0
      OR coalesce(json_type(NEW.envelope, '$.provenance.project'), '') != 'text'
      OR coalesce(length(trim(json_extract(NEW.envelope, '$.provenance.project'))), 0) = 0
      OR coalesce(json_type(NEW.envelope, '$.provenance.lane'), 'text') != 'text'
      OR coalesce(json_type(NEW.envelope, '$.provenance.session'), 'text') != 'text'
    ELSE 1 END
    BEGIN SELECT RAISE(ABORT, 'delivery provenance is required: restart the sending session on the upgraded omo'); END`,
  "INSERT OR IGNORE INTO extension_objects (type, name, owner) VALUES ('trigger', 'deliveries_require_provenance', NULL)",
]
class ce extends Error {
  code = "gateway_schema_too_new"
  details
  constructor(e, n, t) {
    super(
      `${t === void 0 ? "Gateway" : `Extension ${t}`} schema ${e} is newer than this binary's supported version ${n}.`,
    )
    this.details = t === void 0 ? { found: e, supported: n } : { found: e, supported: n, extension: t }
  }
}
var on = [
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
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      binding_id TEXT NOT NULL UNIQUE,
      schema_version INTEGER NOT NULL DEFAULT 1,
      revision INTEGER NOT NULL CHECK (revision >= 1),
      status TEXT NOT NULL CHECK (status IN ('active', 'detached', 'expired')),
      platform TEXT NOT NULL CHECK (platform IN ('discord', 'telegram', 'slack', 'notion', 'feishu', 'herdr', 'custom', 'whatsapp')),
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
  [
    "ALTER TABLE session_meta ADD COLUMN incarnation TEXT",
    "ALTER TABLE outbox ADD COLUMN session_durable_id TEXT",
    "ALTER TABLE outbox ADD COLUMN reply_token TEXT",
    "ALTER TABLE outbox ADD COLUMN ui_request_id TEXT",
    "ALTER TABLE outbox ADD COLUMN incarnation TEXT",
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
  [
    "ALTER TABLE outbox ADD COLUMN ui_request_kind TEXT CHECK (ui_request_kind IS NULL OR ui_request_kind IN ('question', 'select', 'confirm', 'input', 'editor'))",
    "ALTER TABLE outbox ADD COLUMN answer_state TEXT CHECK (answer_state IS NULL OR answer_state IN ('in_flight', 'delivered'))",
  ],
  ["ALTER TABLE outbox ADD COLUMN answered_by TEXT"],
  [
    "ALTER TABLE session_meta ADD COLUMN endpoint_socket TEXT",
    "ALTER TABLE session_meta ADD COLUMN endpoint_kind TEXT CHECK (endpoint_kind IS NULL OR endpoint_kind IN ('tui', 'rpc_host'))",
  ],
  [
    "CREATE TABLE extension_schema (name TEXT PRIMARY KEY, version INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
    "ALTER TABLE deliveries ADD COLUMN actor_user_id TEXT",
    "CREATE TABLE extension_objects (type TEXT NOT NULL, name TEXT NOT NULL, owner TEXT, PRIMARY KEY (type, name))",
    "INSERT INTO extension_objects (type, name, owner) SELECT type, name, NULL FROM sqlite_schema",
  ],
  [
    `CREATE TABLE bindings_v7 (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      binding_id TEXT NOT NULL UNIQUE,
      schema_version INTEGER NOT NULL DEFAULT 1,
      revision INTEGER NOT NULL CHECK (revision >= 1),
      status TEXT NOT NULL CHECK (status IN ('active', 'detached', 'expired')),
      platform TEXT NOT NULL CHECK (platform IN ('discord', 'telegram', 'slack', 'notion', 'feishu', 'herdr', 'custom', 'whatsapp')),
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
    "INSERT INTO bindings_v7 SELECT seq, binding_id, schema_version, revision, status, platform, account_id, chat_id, thread_id, root_message_id, progress_message_id, session_realm_id, session_durable_id, direction_inbound, direction_outbound, inbound_mode, outbound_events, policy_id, created_at, updated_at, lease_started_at, ttl_seconds, expires_at FROM bindings",
    "UPDATE sqlite_sequence SET seq = (SELECT seq FROM sqlite_sequence WHERE name = 'bindings') WHERE name = 'bindings_v7'",
    "DROP TABLE bindings",
    "ALTER TABLE bindings_v7 RENAME TO bindings",
    "CREATE UNIQUE INDEX bindings_one_active_thread ON bindings (platform, account_id, chat_id, thread_id) WHERE status = 'active'",
    "CREATE INDEX bindings_session ON bindings (session_durable_id, status)",
  ],
  rt,
  [
    ...rt,
    `CREATE TABLE IF NOT EXISTS thread_creations (
      creator_durable_id TEXT NOT NULL,
      created_durable_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (creator_durable_id, created_durable_id)
    )`,
    "CREATE TABLE IF NOT EXISTS extension_registrations (name TEXT PRIMARY KEY, descriptor_json TEXT NOT NULL, updated_at INTEGER NOT NULL)",
    `INSERT OR IGNORE INTO extension_objects (type, name, owner)
     SELECT s.type, s.name, NULL FROM sqlite_schema s
     WHERE NOT EXISTS (SELECT 1 FROM extension_objects e WHERE e.type = s.type AND e.name = s.name COLLATE NOCASE)`,
  ],
  [
    ...rt,
    `CREATE TABLE IF NOT EXISTS toolkit_replay_receipts (
      replay_key TEXT PRIMARY KEY,
      op TEXT NOT NULL,
      args_sha256 TEXT NOT NULL,
      result_json TEXT NOT NULL,
      turn_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS toolkit_replay_receipts_turn_at ON toolkit_replay_receipts (turn_at)",
    `INSERT OR IGNORE INTO extension_objects (type, name, owner)
     SELECT s.type, s.name, NULL FROM sqlite_schema s
     WHERE NOT EXISTS (SELECT 1 FROM extension_objects e WHERE e.type = s.type AND e.name = s.name COLLATE NOCASE)`,
  ],
  ["ALTER TABLE deliveries ADD COLUMN wait_kind TEXT CHECK (wait_kind IS NULL OR wait_kind = 'approval')"],
  [
    "ALTER TABLE deliveries ADD COLUMN ledger_id TEXT",
    "ALTER TABLE deliveries ADD COLUMN verbatim_text TEXT",
    "ALTER TABLE deliveries ADD COLUMN verbatim_display_text TEXT",
    "CREATE UNIQUE INDEX deliveries_ledger ON deliveries (ledger_id) WHERE ledger_id IS NOT NULL",
    "INSERT OR IGNORE INTO extension_objects (type, name, owner) VALUES ('index', 'deliveries_ledger', NULL)",
  ],
  [
    `CREATE TABLE IF NOT EXISTS woken_sessions (
      durable_id TEXT PRIMARY KEY,
      session_file TEXT NOT NULL,
      host_instance TEXT,
      state TEXT NOT NULL CHECK (state IN ('requested', 'opening', 'open', 'closing')),
      requested_at INTEGER NOT NULL,
      opened_at INTEGER,
      first_waiting_at INTEGER,
      lease_owner TEXT,
      lease_expires_at INTEGER,
      generation INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER
    )`,
    "CREATE INDEX IF NOT EXISTS woken_sessions_state ON woken_sessions (state)",
    "INSERT OR IGNORE INTO extension_objects (type, name, owner) VALUES ('table', 'woken_sessions', NULL)",
    "INSERT OR IGNORE INTO extension_objects (type, name, owner) VALUES ('index', 'woken_sessions_state', NULL)",
  ],
  [
    `CREATE TABLE IF NOT EXISTS session_wait (
      durable_id TEXT PRIMARY KEY,
      wait TEXT NOT NULL CHECK (wait IN ('held', 'waiting')),
      hold_kinds TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      written_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS wake_counts (
      durable_id TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      human_input_revision INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS intake_marks (
      sender_device TEXT NOT NULL,
      session_id TEXT NOT NULL,
      last_command_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (sender_device, session_id)
    )`,
    "INSERT OR IGNORE INTO extension_objects (type, name, owner) VALUES ('table', 'session_wait', NULL)",
    "INSERT OR IGNORE INTO extension_objects (type, name, owner) VALUES ('table', 'wake_counts', NULL)",
    `CREATE TABLE IF NOT EXISTS intake_commands (
      ledger_id TEXT PRIMARY KEY,
      command_id TEXT NOT NULL
    )`,
    "INSERT OR IGNORE INTO extension_objects (type, name, owner) VALUES ('table', 'intake_marks', NULL)",
    "INSERT OR IGNORE INTO extension_objects (type, name, owner) VALUES ('table', 'intake_commands', NULL)",
  ],
]
function* ot(e) {
  for (let n = 0; n < e.length;) {
    let t = n,
      r = e[n],
      o
    if (r <= " ") {
      o = "space"
      while (n < e.length && e[n] <= " ") n++
    } else if (r === "-" && e[n + 1] === "-") {
      o = "comment"
      while (
        n < e.length &&
        e[n] !==
          `
`
      )
        n++
    } else if (r === "/" && e[n + 1] === "*") {
      ;((o = "comment"), (n += 2))
      while (n < e.length && !(e[n] === "*" && e[n + 1] === "/")) n++
      n = Math.min(n + 2, e.length)
    } else if (r === "'" || r === '"' || r === "`" || r === "[") {
      o = "quoted"
      let i = r === "[" ? "]" : r
      n++
      while (n < e.length) {
        if (e[n++] !== i) continue
        if (r !== "[" && e[n] === i) {
          n++
          continue
        }
        break
      }
    } else if (r === "?" || r === ";") ((o = r === "?" ? "parameter" : "semicolon"), n++)
    else {
      ;((o = "text"), n++)
      while (n < e.length && e[n] > " " && !["'", '"', "`", "[", "?", ";", "-", "/"].includes(e[n])) n++
    }
    yield { kind: o, text: e.slice(t, n) }
  }
}
class fr {
  params = []
  sinkRows = []
  authorizer = null
  db
  constructor(e) {
    ;((this.db = e),
      e.function("gw_p", { deterministic: !1 }, (n) => this.params[n] ?? null),
      e.function("gw_sink", { varargs: !0, deterministic: !1 }, (...n) => (this.sinkRows.push(n), null)))
  }
  exec(e) {
    this.db.exec(e)
  }
  authorized(e, n) {
    let t = this.authorizer
    ;((this.authorizer = e), this.db.setAuthorizer(e))
    try {
      return n()
    } finally {
      ;((this.authorizer = t), this.db.setAuthorizer(t))
    }
  }
  resultColumns(e) {
    return this.authorized(null, () => {
      this.db.exec(`CREATE TEMP VIEW gw_result_columns AS ${cr(e)}
`)
      try {
        return this.all(
          ["name"],
          "SELECT cid, name FROM pragma_table_info('gw_result_columns', 'temp')",
          [],
          "cid",
        ).map((n) => String(n.name))
      } finally {
        this.db.exec("DROP VIEW temp.gw_result_columns")
      }
    })
  }
  run(e, n = []) {
    this.params = n
    try {
      this.db.exec(cr(e))
    } finally {
      this.params = []
    }
    return Number(this.all(["n"], "SELECT changes() AS n")[0]?.n ?? 0)
  }
  all(e, n, t = [], r) {
    ;((this.params = t), (this.sinkRows = []))
    try {
      let o = r === void 0 ? "0" : `row_number() OVER (ORDER BY ${r})`
      return (
        this.db.exec(`SELECT gw_sink(${o}, ${e.join(", ")}) FROM (${cr(n)}
)${r === void 0 ? "" : ` ORDER BY ${r}`}`),
        (r === void 0 ? this.sinkRows : this.sinkRows.toSorted((s, u) => Number(s[0]) - Number(u[0]))).map((s) =>
          Object.fromEntries(e.map((u, a) => [u, s[a + 1] ?? null])),
        )
      )
    } finally {
      ;((this.params = []), (this.sinkRows = []))
    }
  }
  one(e, n, t = []) {
    return this.all(e, n, t)[0]
  }
}
function cr(e) {
  let n = 0,
    t = ""
  for (let r of ot(e)) t += r.kind === "parameter" ? `gw_p(${n++})` : r.text
  return t
}
function it(e) {
  if (typeof e !== "object" || e === null) return !1
  let n = e
  return (
    n.errcode === 5 ||
    n.errcode === 6 ||
    (typeof n.message === "string" && /database is (locked|busy)/i.test(n.message))
  )
}
import { createHash as js, randomUUID as Tr } from "node:crypto"
import {
  closeSync as Gs,
  constants as Er,
  mkdirSync as Ks,
  openSync as Ws,
  readdirSync as Bs,
  readFileSync as Hs,
  rmSync as Ir,
  writeSync as zs,
} from "node:fs"
import { userInfo as Xs } from "node:os"
import { join as ni } from "node:path"
import { existsSync as Oo, readFileSync as $o } from "node:fs"
import { join as No } from "node:path"
function Ao(e) {
  let n = No(e, "mailbox.jsonl")
  if (Oo(n)) return Ss($o(n, "utf8"))
  let t = No(e, "mailbox.json")
  if (!Oo(t)) return null
  let r = JSON.parse($o(t, "utf8"))
  if (!at(r) || !at(r.queues)) throw Error(`invalid legacy mailbox state: ${t}`)
  let o = []
  for (let i of Object.values(r.queues)) {
    if (!Array.isArray(i)) throw Error(`invalid legacy mailbox queue: ${t}`)
    for (let s of i) o.push(yr(s))
  }
  return Lo(o)
}
function Ss(e) {
  let n = e.slice(
      0,
      e.lastIndexOf(`
`) + 1,
    ),
    t = new Map()
  for (let r of n.split(`
`)) {
    if (r.length === 0) continue
    let o = JSON.parse(r)
    if (!at(o) || o.version !== 1) throw Error("invalid legacy mailbox event")
    if (o.kind === "snapshot" && Array.isArray(o.items)) {
      t.clear()
      for (let i of o.items) {
        let s = yr(i)
        t.set(s.message_seq, s)
      }
    } else if (o.kind === "enqueue") {
      let i = yr(o.item)
      t.set(i.message_seq, i)
    } else if (o.kind === "remove" && typeof o.message_seq === "number") t.delete(o.message_seq)
    else throw Error("invalid legacy mailbox event")
  }
  return Lo([...t.values()])
}
function Lo(e) {
  return e.toSorted((n, t) => n.message_seq - t.message_seq)
}
function yr(e) {
  if (
    !at(e) ||
    typeof e.target !== "string" ||
    typeof e.message !== "string" ||
    typeof e.message_seq !== "number" ||
    !Number.isInteger(e.message_seq) ||
    (e.delivery !== "auto" && e.delivery !== "steer" && e.delivery !== "follow_up") ||
    (e.expected_turn_id !== void 0 && typeof e.expected_turn_id !== "string") ||
    typeof e.operation_id !== "string" ||
    typeof e.accepted_at !== "string"
  )
    throw Error("invalid legacy mailbox item")
  return {
    target: e.target,
    message: e.message,
    message_seq: e.message_seq,
    delivery: e.delivery,
    expected_turn_id: e.expected_turn_id === void 0 ? null : vs(e.expected_turn_id),
    operation_id: e.operation_id,
    accepted_at: e.accepted_at,
  }
}
function vs(e) {
  let n = /^turn-(0|[1-9]\d*)$/.exec(e)
  if (n === null) return null
  let t = Number(n[1])
  return Number.isSafeInteger(t) ? t : null
}
function at(e) {
  return typeof e === "object" && e !== null && !Array.isArray(e)
}
import { createHash as Os, createHmac as $s, randomUUID as Uo, timingSafeEqual as Ns } from "node:crypto"
var Co = ["discord", "telegram", "slack", "notion", "feishu", "herdr", "custom", "whatsapp"],
  st = ["milestone", "report", "question", "completion"]
var $n = ["auto", "follow_up"]
var As = 604800,
  Po = 31622400,
  Ls = "@chat",
  Cs = "default",
  Nn = 2592000000,
  Fo = 50,
  qo = 200,
  jo = 100,
  Go = 500,
  An = 32768,
  Mo = 256
function B(e) {
  return new Date(e).toISOString()
}
function fe(e) {
  return { kind: "refused", code: "invalid_arguments", message: e }
}
function an(e, n) {
  if (typeof n !== "string" || n.trim().length === 0) return fe(`${e} must be a non-empty string.`)
  if (n.length > Mo) return fe(`${e} is longer than ${Mo} characters.`)
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(n))
    return fe(`${e} carries a control character or a line separator.`)
  return n
}
function Do(e, n) {
  return n === void 0 || n === null ? null : an(e, n)
}
function Ps(e) {
  return typeof e === "object" && e !== null && e.kind === "refused"
}
function Ko(e) {
  if (!Co.includes(e.platform)) return fe(`platform must be one of ${Co.join(", ")}.`)
  let n = {
    account_id: an("account_id", e.account_id),
    chat_id: an("chat_id", e.chat_id),
    thread_id: an("thread_id", e.thread_id ?? Ls),
    root_message_id: Do("root_message_id", e.root_message_id),
    progress_message_id: Do("progress_message_id", e.progress_message_id),
    session_durable_id: an("session", e.session_durable_id),
    policy_id: an("policy_id", e.policy_id ?? Cs),
  }
  for (let s of Object.values(n)) if (Ps(s)) return s
  let t = e.direction ?? { inbound: !0, outbound: !0 }
  if (t.inbound !== !0 && t.outbound !== !0)
    return fe("A binding needs at least one direction: inbound, outbound, or both.")
  let r = e.inbound_mode ?? "auto"
  if (!$n.includes(r)) return fe(`inbound_mode must be one of ${$n.join(", ")}.`)
  let o = e.outbound_events ?? (t.outbound ? st : [])
  if (o.some((s) => !st.includes(s))) return fe(`outbound_events may only name ${st.join(", ")}.`)
  if (new Set(o).size !== o.length) return fe("outbound_events must not repeat an event.")
  if (t.outbound && o.length === 0) return fe("An outbound binding needs at least one outbound event.")
  let i = e.ttl_seconds === void 0 ? As : e.ttl_seconds
  if (i !== null && (!Number.isInteger(i) || i < 1 || i > Po))
    return fe(`ttl_seconds must be an integer from 1 to ${Po}, or null for a binding that never expires.`)
  return {
    platform: e.platform,
    account_id: n.account_id,
    chat_id: n.chat_id,
    thread_id: n.thread_id,
    root_message_id: n.root_message_id,
    progress_message_id: n.progress_message_id,
    session_durable_id: n.session_durable_id,
    direction: { inbound: t.inbound === !0, outbound: t.outbound === !0 },
    inbound_mode: r,
    outbound_events: st.filter((s) => o.includes(s)),
    policy_id: n.policy_id,
    ttl_seconds: i,
  }
}
function _r(e) {
  if (e === null || typeof e !== "object") return JSON.stringify(e) ?? "null"
  if (Array.isArray(e)) return `[${e.map(_r).join(",")}]`
  let n = e
  return `{${Object.keys(n)
    .filter((t) => n[t] !== void 0)
    .sort()
    .map((t) => `${JSON.stringify(t)}:${_r(n[t])}`)
    .join(",")}}`
}
function Wo(e) {
  return Os("sha256").update(_r(e)).digest("hex")
}
function Bo() {
  return `bnd-${Uo()}`
}
function Ho(e) {
  return Buffer.from(e).toString("base64url")
}
function zo(e, n) {
  return Ho(JSON.stringify({ v: 1, as_of: e, after: n }))
}
function Xo(e) {
  try {
    let n = JSON.parse(Buffer.from(e, "base64url").toString("utf8"))
    if (n.v !== 1 || typeof n.as_of !== "number" || !Number.isInteger(n.as_of)) return null
    let t = n.after
    if (t !== null && !(Array.isArray(t) && t.length === 2 && t.every((r) => typeof r === "string"))) return null
    return { v: 1, as_of: n.as_of, after: t }
  } catch {
    return null
  }
}
var gr = "rt1"
function Vo(e, n) {
  return $s("sha256", e).update(`${gr}.${n}`).digest().subarray(0, 16).toString("base64url")
}
function Yo(e, n) {
  let t = { b: n.binding_id, r: n.revision, s: n.session_durable_id, i: n.incarnation, q: n.ui_request_id, n: Uo() },
    r = Ho(JSON.stringify(t))
  return `${gr}.${r}.${Vo(e, r)}`
}
function Qo(e, n) {
  let t = n.split(".")
  if (t.length !== 3 || t[0] !== gr) return null
  let r = Buffer.from(Vo(e, t[1])),
    o = Buffer.from(t[2])
  if (r.length !== o.length || !Ns(r, o)) return null
  try {
    let i = JSON.parse(Buffer.from(t[1], "base64url").toString("utf8"))
    if (typeof i.b !== "string" || typeof i.r !== "number" || typeof i.s !== "string" || typeof i.q !== "string")
      return null
    if (i.i !== null && typeof i.i !== "string") return null
    return { binding_id: i.b, revision: i.r, session_durable_id: i.s, incarnation: i.i ?? null, ui_request_id: i.q }
  } catch {
    return null
  }
}
var Jo = new WeakMap()
function Ln(e, n, t) {
  return E(
    e,
    "DELETE FROM receipts WHERE principal = ? AND operation = ? AND idempotency_key = ? AND expires_at <= ?",
    [n.principal, n.operation, n.idempotency_key, t],
  )
}
function sn(e, n, t = 0) {
  if (n < (Jo.get(e.sql) ?? Number.NEGATIVE_INFINITY)) return null
  let r = Ms(e, n, Math.max(tn - t, 0)),
    o = r.receipts + t >= tn || Object.values(r).some((i) => i >= tn)
  return (Jo.set(e.sql, o ? n : n + To), r)
}
function Ms(e, n, t = tn) {
  let r = tn,
    o = E(e, "DELETE FROM receipts WHERE rowid IN (SELECT rowid FROM receipts WHERE expires_at <= ? LIMIT ?)", [n, t]),
    i = E(
      e,
      "DELETE FROM deliveries WHERE delivery_id IN (SELECT d.delivery_id FROM deliveries d WHERE d.state IN ('applied', 'refused') AND d.updated_at <= ? AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.delivery_id = d.delivery_id) LIMIT ?)",
      [n - ho, r],
    ),
    s = E(
      e,
      "DELETE FROM causal_edges WHERE rowid IN (SELECT e.rowid FROM causal_edges e JOIN causal_roots r ON r.root_id = e.root_id WHERE r.expires_at <= ? LIMIT ?)",
      [n, r],
    ),
    u = E(
      e,
      "DELETE FROM causal_roots WHERE root_id IN (SELECT r.root_id FROM causal_roots r WHERE r.expires_at <= ? AND NOT EXISTS (SELECT 1 FROM causal_edges e WHERE e.root_id = r.root_id) LIMIT ?)",
      [n, r],
    ),
    a = E(e, "DELETE FROM rate_buckets WHERE rowid IN (SELECT rowid FROM rate_buckets WHERE updated_at <= ? LIMIT ?)", [
      n - wn * kn,
      r,
    ]),
    d = E(
      e,
      `DELETE FROM bindings WHERE binding_id IN (SELECT b.binding_id FROM bindings b WHERE b.status != 'active' AND b.updated_at <= ?
      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.binding_id = b.binding_id)
      AND NOT EXISTS (SELECT 1 FROM completion_arms a WHERE a.binding_id = b.binding_id)
      AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.binding_id = b.binding_id AND d.state IN ${Z}) LIMIT ?)`,
      [B(n - Nn), r],
    ),
    m = E(
      e,
      "DELETE FROM outbox_cursors WHERE binding_id IN (SELECT c.binding_id FROM outbox_cursors c WHERE NOT EXISTS (SELECT 1 FROM bindings b WHERE b.binding_id = c.binding_id) LIMIT ?)",
      [r],
    ),
    l = E(
      e,
      `DELETE FROM session_meta WHERE durable_id IN (SELECT m.durable_id FROM session_meta m WHERE
      m.incarnation IS NULL
      AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.target_durable_id = m.durable_id)
      AND NOT EXISTS (SELECT 1 FROM bindings b WHERE b.session_durable_id = m.durable_id)
      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.session_durable_id = m.durable_id)
      AND NOT EXISTS (SELECT 1 FROM completion_arms a WHERE a.session_durable_id = m.durable_id) LIMIT ?)`,
      [r],
    )
  return {
    receipts: o,
    deliveries: i,
    causal_edges: s,
    causal_roots: u,
    rate_buckets: a,
    bindings: d,
    outbox_cursors: m,
    session_meta: l,
  }
}
var Ds = [
    "invalid_arguments",
    "caller_context_missing",
    "not_found",
    "reply_target_mismatch",
    "ambiguous_target",
    "scope_denied",
    "name_conflict",
    "not_resumable",
    "orphaned",
    "foreign_live_owner",
    "no_active_turn",
    "turn_conflict",
    "turn_active",
    "not_steerable",
    "message_too_large",
    "queue_full",
    "cursor_invalid",
    "cursor_stale",
    "idempotency_conflict",
    "idempotency_in_progress",
    "idempotency_uncertain",
    "delivered_unconfirmed",
    "approval_unavailable",
    "approval_route_locked",
    "partial_commit",
    "unsupported",
    "overloaded",
    "transport_closed",
    "host_unavailable",
    "internal_error",
    "model_not_found",
    "model_ambiguous",
    "thinking_level_unsupported",
    "loop_detected",
    "chain_count_limit",
    "binding_conflict",
    "binding_mismatch",
    "binding_inactive",
    "stale_revision",
    "stale_token",
    "already_answered",
    "answer_in_progress",
    "device_offline",
    "relay_requires_paid_plan",
    "alias_taken",
    "gateway_schema_too_new",
  ],
  Us = new Set(Ds)
function Fs(e) {
  return typeof e === "string" && Us.has(e)
}
function $e(e, n, t, r) {
  if (!Fs(e)) throw Error(`unknown thread error code: ${String(e)}`)
  return { code: e, message: n, next_action: t, ...(r === void 0 ? {} : { details: r }) }
}
var qs = {
  not_steerable: { code: "not_steerable", next: "Send with delivery auto or follow_up; a steer needs a running turn." },
  turn_conflict: {
    code: "turn_conflict",
    next: "Read the target again and retry with its current turn id, or send with delivery auto.",
  },
  expired: {
    code: "not_resumable",
    next: "The target did not take the message within its lifetime; send it again if it still matters.",
  },
  sender_not_admitted: {
    code: "not_resumable",
    next: "The sending device is no longer admitted to this account; sign it in again, then send again.",
  },
  binding_closed: {
    code: "invalid_arguments",
    next: "The binding this message was queued under was detached or rebound; re-read the binding and send again.",
  },
}
function Cn(e, n, t, r, o, i) {
  let s = {
    kind: "ok",
    thread_id: e.target_durable_id,
    delivery_id: e.delivery_id,
    message_seq: e.seq,
    effective_mode: e.mode_effective ?? e.mode_requested,
    endpoint_kind: t,
    deduplicated: r,
  }
  if (i !== void 0 && (e.state === "queued" || e.state === "admitted"))
    return { ...s, delivery: { kind: "queued", queue_position: Math.max(n, 1), waiting_on: i } }
  if (e.state === "admitted" || e.state === "applied") {
    if (e.admission_kind === "started" || e.admission_kind === "steered")
      return { ...s, delivery: { kind: e.admission_kind, turn_id: String(e.turn_epoch ?? 0) } }
    let u = e.envelope.provenance?.device,
      a = e.wait_kind === null ? {} : { waiting_on: { kind: e.wait_kind, ...(u === void 0 ? {} : { device: u }) } }
    return { ...s, delivery: { kind: "queued", queue_position: Math.max(n, 1), ...a } }
  }
  if (e.state === "refused") {
    let u = qs[e.reason ?? ""] ?? {
      code: "internal_error",
      next: "Call thread_list (tool.thread_list() in an eval cell) and check the target.",
    }
    return {
      kind: "error",
      error: $e(u.code, `Delivery ${e.delivery_id} was refused: ${e.reason ?? "unknown"}.`, u.next, {
        delivery_id: e.delivery_id,
      }),
    }
  }
  if (e.state === "uncertain")
    return {
      kind: "error",
      error: $e(
        "idempotency_uncertain",
        `Delivery ${e.delivery_id} may or may not have reached the target.`,
        "Read the target transcript before deciding whether to send again.",
        { delivery_id: e.delivery_id },
      ),
    }
  return { ...s, delivery: { kind: o ? "queued_offline" : "queued", queue_position: Math.max(n, 1) } }
}
var dt = [
    "delivery_id",
    "target_durable_id",
    "seq",
    "sender",
    "sender_turn",
    "envelope",
    "body",
    "bytes",
    "mode_requested",
    "mode_effective",
    "expected_turn_id",
    "state",
    "reason",
    "admitted_by",
    "claimed_at",
    "attempt",
    "admission_kind",
    "wait_kind",
    "turn_epoch",
    "root_id",
    "hop",
    "created_at",
    "updated_at",
    "expires_at",
    "binding_id",
    "binding_revision",
    "actor_user_id",
    "ledger_id",
    "verbatim_text",
    "verbatim_display_text",
  ],
  Z = "('queued', 'admitting', 'admitted')",
  ut = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/
function ee(e, n, t) {
  return { kind: "refused", code: e, message: n, ...(t === void 0 ? {} : { details: t }) }
}
function Vs(e) {
  let n = (t) => (t === null || t === void 0 ? null : Number(t))
  return {
    delivery_id: String(e.delivery_id),
    target_durable_id: String(e.target_durable_id),
    seq: Number(e.seq),
    sender: String(e.sender),
    sender_turn: e.sender_turn === null ? null : String(e.sender_turn),
    envelope: JSON.parse(String(e.envelope)),
    body: String(e.body),
    bytes: Number(e.bytes),
    mode_requested: e.mode_requested,
    mode_effective: e.mode_effective ?? null,
    expected_turn_id: n(e.expected_turn_id),
    state: e.state,
    reason: e.reason === null ? null : String(e.reason),
    admitted_by: e.admitted_by === null ? null : JSON.parse(String(e.admitted_by)),
    claimed_at: n(e.claimed_at),
    attempt: Number(e.attempt),
    admission_kind: e.admission_kind === null ? null : String(e.admission_kind),
    wait_kind: e.wait_kind === "approval" ? "approval" : null,
    turn_epoch: n(e.turn_epoch),
    root_id: String(e.root_id),
    hop: Number(e.hop),
    created_at: Number(e.created_at),
    updated_at: Number(e.updated_at),
    expires_at: Number(e.expires_at),
    binding_id: e.binding_id === null ? null : String(e.binding_id),
    binding_revision: n(e.binding_revision),
    actor_user_id: e.actor_user_id === null ? null : String(e.actor_user_id),
    ledger_id: br(e.ledger_id),
    verbatim_text: br(e.verbatim_text),
    verbatim_display_text: br(e.verbatim_display_text),
  }
}
function br(e) {
  return e === null || e === void 0 ? null : String(e)
}
function xr(e) {
  return e.ledger_id ?? e.delivery_id
}
function ye(e, n, t, r) {
  return e.sql.all(dt, `SELECT ${dt.join(", ")} FROM deliveries WHERE ${n}`, t, r).map(Vs)
}
function he(e, n) {
  return ye(e, "delivery_id = ?", [n])[0]
}
function E(e, n, t = []) {
  let r = e.sql.run(n, t)
  return ((e.stats.writes += r), r)
}
function mt(e, n) {
  if (n.state !== "queued" && n.state !== "admitting" && n.state !== "admitted") return 0
  let t = e.sql.one(
    ["n"],
    `SELECT COUNT(*) AS n FROM deliveries WHERE target_durable_id = ? AND state IN ${Z} AND seq <= ?`,
    [n.target_durable_id, n.seq],
  )
  return Number(t?.n ?? 1)
}
async function ti(e, n, t) {
  if (e.afterCommit !== void 0) return (e.sql.exec("SAVEPOINT gateway_enqueue"), !0)
  let r = Date.now()
  for (;;)
    try {
      return (e.sql.exec("BEGIN IMMEDIATE"), e.stats.transactions++, !0)
    } catch (o) {
      if (!it(o)) throw o
      if ((e.emit({ kind: "busy", op: n }), !t)) return !1
      let i = Date.now() - r
      if (i + 2 * e.config.busy_timeout_ms > e.config.lock_wait_max_ms)
        throw (e.emit({ kind: "lock_wait_exceeded", op: n, waited_ms: i }), Zn(n, i, e.config.lock_wait_max_ms))
      await e.delay(e.config.busy_timeout_ms)
    }
}
function dn(e) {
  try {
    e.sql.exec(e.afterCommit === void 0 ? "ROLLBACK" : "ROLLBACK TO gateway_enqueue; RELEASE gateway_enqueue")
  } catch {
    return
  }
}
async function x(e, n, t) {
  if (e.afterCommit !== void 0) return await t()
  await ti(e, n, !0)
  try {
    let r = await t()
    return (e.sql.exec("COMMIT"), r)
  } catch (r) {
    throw (dn(e), r)
  }
}
function ri(e, n, t, r) {
  let o = nt(e.config.agent_dir, n)
  Ks(o, { recursive: !0, mode: 448 })
  let i = ni(o, t),
    s
  try {
    s = Ws(i, Er.O_CREAT | Er.O_EXCL | Er.O_WRONLY, 384)
  } catch (u) {
    if (r && u instanceof Error && "code" in u && u.code === "EEXIST") return i
    throw u
  }
  try {
    zs(s, JSON.stringify({ pid: e.self.pid, process_start_time: e.self.process_start_time }))
  } finally {
    Gs(s)
  }
  return (e.afterRollback?.push(() => Ir(i, { force: !0 })), i)
}
function je(e, n, t) {
  if (e.afterCommit !== void 0) {
    e.afterCommit.push(() => je({ ...e, afterCommit: void 0 }, n, t))
    return
  }
  let r = ni(nt(e.config.agent_dir, n), t)
  try {
    ;(Ir(r), e.stats.marker_unlinks++)
  } catch (o) {
    if (!(o instanceof Error && "code" in o && o.code === "ENOENT")) throw o
  }
}
function oi(e, n) {
  try {
    return Bs(nt(e.config.agent_dir, n)).filter((t) => !t.startsWith("."))
  } catch (t) {
    if (t instanceof Error && "code" in t && t.code === "ENOENT") return []
    throw t
  }
}
function ii(e, n) {
  let t = e.sql.one(["next_seq"], "SELECT next_seq FROM session_meta WHERE durable_id = ?", [n]),
    r =
      t === void 0
        ? Number(
            e.sql.one(["m"], "SELECT COALESCE(MAX(seq), 0) + 1 AS m FROM deliveries WHERE target_durable_id = ?", [n])
              ?.m ?? 1,
          )
        : Number(t.next_seq)
  return (
    E(
      e,
      "INSERT INTO session_meta (durable_id, next_seq) VALUES (?, ?) ON CONFLICT(durable_id) DO UPDATE SET next_seq = excluded.next_seq",
      [n, r + 1],
    ),
    r
  )
}
function ai(e, n) {
  E(e, `INSERT INTO deliveries (${dt.join(", ")}) VALUES (${dt.map(() => "?").join(", ")})`, [
    n.delivery_id,
    n.target_durable_id,
    n.seq,
    n.sender,
    n.sender_turn,
    JSON.stringify(n.envelope),
    n.body,
    n.bytes,
    n.mode_requested,
    n.mode_effective,
    n.expected_turn_id,
    n.state,
    n.reason,
    n.admitted_by === null ? null : JSON.stringify(n.admitted_by),
    n.claimed_at,
    n.attempt,
    n.admission_kind,
    n.wait_kind,
    n.turn_epoch,
    n.root_id,
    n.hop,
    n.created_at,
    n.updated_at,
    n.expires_at,
    n.binding_id,
    n.binding_revision,
    n.actor_user_id,
    n.ledger_id ?? null,
    n.verbatim_text ?? null,
    n.verbatim_display_text ?? null,
  ])
}
function Ys(e) {
  return js("sha256").update(JSON.stringify(e)).digest("hex")
}
function hr(e) {
  let n = Number(e.sql.one(["user_version"], "SELECT user_version FROM pragma_user_version()")?.user_version ?? 0)
  if (n > on.length) throw new ce(n, on.length)
  return n
}
class si extends Error {
  version
  code = "gateway_migration_failed"
  constructor(e, n) {
    super(n)
    this.version = e
    this.name = "GatewayMigrationError"
  }
}
async function di(e) {
  if (hr(e) >= on.length) return
  for (;;) {
    let n = hr(e)
    if (n >= on.length) return
    let t = Qs.has(n),
      r = t ? Number(e.sql.one(["foreign_keys"], "SELECT foreign_keys FROM pragma_foreign_keys")?.foreign_keys ?? 1) : 1
    if (t) e.sql.exec("PRAGMA foreign_keys = OFF")
    try {
      await x(e, "migrate", () => {
        let o = hr(e)
        if (o !== n) return
        for (let i of on[o]) e.sql.exec(i)
        if (t) {
          if (
            e.sql.all(["parent"], "SELECT parent FROM pragma_foreign_key_check").filter((u) => u.parent === "bindings")
              .length > 0
          )
            throw new si(
              o + 1,
              `gateway schema ${o + 1} would leave a foreign-key violation referencing bindings; staying at v${o}`,
            )
        }
        e.sql.exec(`PRAGMA user_version = ${o + 1}`)
      })
    } finally {
      if (t) e.sql.exec(`PRAGMA foreign_keys = ${r === 0 ? "OFF" : "ON"}`)
    }
  }
}
var Qs = new Set([6])
function wr(e, n, t) {
  let r = e.sql.one(
    ["args_hash", "status", "delivery_id", "owner_instance", "result", "expires_at"],
    "SELECT args_hash, status, delivery_id, owner_instance, result, expires_at FROM receipts WHERE principal = ? AND operation = 'deliver' AND idempotency_key = ?",
    [n, t],
  )
  if (r === void 0) return
  return {
    args_hash: String(r.args_hash),
    status: r.status,
    delivery_id: r.delivery_id === null ? null : String(r.delivery_id),
    owner_instance: String(r.owner_instance),
    result: r.result === null ? null : String(r.result),
    expires_at: Number(r.expires_at),
  }
}
function ui(e, n, t) {
  if (t.args_hash !== n.receipt.args_hash)
    return ee("idempotency_conflict", "The idempotency key was already used with different arguments.")
  if (t.status === "completed" && t.result !== null) return { kind: "replay", result: JSON.parse(t.result) }
  let r = t.delivery_id === null ? void 0 : he(e, t.delivery_id),
    o = r !== void 0 && (r.state === "admitted" || r.state === "applied" || r.state === "refused")
  if (t.status === "prepared" && !o && t.owner_instance === e.config.instance_id)
    return ee("idempotency_in_progress", "The same delivery is already in progress.")
  if (t.status === "prepared" && o) {
    let i = { ...Cn(r, mt(e, r), n.endpoint_kind, !0, !1) }
    return (
      E(
        e,
        "UPDATE receipts SET status = 'completed', result = ?, updated_at = ? WHERE principal = ? AND operation = 'deliver' AND idempotency_key = ?",
        [JSON.stringify(i), n.now, n.sender_principal, n.receipt.idempotency_key],
      ),
      { kind: "replay", result: i }
    )
  }
  if (t.status === "prepared")
    E(
      e,
      "UPDATE receipts SET status = 'uncertain', error_note = ?, updated_at = ? WHERE principal = ? AND operation = 'deliver' AND idempotency_key = ?",
      [
        "the sender lost the acknowledgement before the target admitted the delivery",
        n.now,
        n.sender_principal,
        n.receipt.idempotency_key,
      ],
    )
  return ee("idempotency_uncertain", "The earlier delivery may or may not reach the target; it is never sent twice.", {
    delivery_id: t.delivery_id,
    state: r?.state ?? null,
  })
}
function Js(e, n) {
  let t,
    r =
      n.cause_delivery_id === null
        ? void 0
        : ye(e, "delivery_id = ? OR ledger_id = ?", [n.cause_delivery_id, n.cause_delivery_id])[0]
  if (r !== void 0) {
    if (
      r.target_durable_id !== n.sender_node ||
      (r.state !== "admitting" && r.state !== "admitted" && r.state !== "applied")
    )
      return ee("invalid_arguments", "The delivery this send continues is not one the sender received.", {
        guard: "unknown_cause",
      })
    t = { root_id: r.root_id, hop: Math.max(r.hop, n.inbound_hop ?? 0) + 1, via: [n.sender_node], new_root: !1 }
  } else t = { root_id: `root-${Tr()}`, hop: (n.inbound_hop ?? 0) + 1, via: [n.sender_node], new_root: !0 }
  if (n.claimed_root_id !== null && n.claimed_root_id !== t.root_id)
    return ee("invalid_arguments", "The causal root is derived by the gateway and cannot be chosen by the caller.", {
      guard: "forged_root",
    })
  if (n.target_durable_id === n.sender_node)
    return ee("loop_detected", "A session cannot deliver to itself through the gateway.", { guard: "self_send" })
  if (!t.new_root) {
    let o = e.sql.one(["expires_at"], "SELECT expires_at FROM causal_roots WHERE root_id = ?", [t.root_id])
    if (o === void 0 || Number(o.expires_at) <= n.now) t = { ...t, root_id: `root-${Tr()}`, new_root: !0 }
  }
  return t
}
function Zs(e, n) {
  if (n.sender_turn === null) return
  let t = new Set(
    e.sql
      .all(
        ["t"],
        "SELECT DISTINCT target_durable_id AS t FROM deliveries WHERE sender = ? AND sender_turn = ? AND state != 'refused'",
        [n.sender_principal, n.sender_turn],
      )
      .map((r) => String(r.t)),
  )
  if (t.has(n.target_durable_id) || t.size < sr) return
  return ee("overloaded", `One turn may reach at most ${sr} sessions.`, { budget: "fanout" })
}
function ed(e, n) {
  let t = n.rate_principal ?? n.sender_principal,
    r = e.sql.one(
      ["tokens", "updated_at"],
      "SELECT tokens, updated_at FROM rate_buckets WHERE sender = ? AND target_durable_id = ?",
      [t, n.target_durable_id],
    ),
    o = r === void 0 ? wn : Math.min(wn, Number(r.tokens) + Math.max(0, n.now - Number(r.updated_at)) / kn)
  if (o < 1)
    return ee("overloaded", "Too many deliveries to this session; wait before sending again.", {
      budget: "pair_rate",
      retry_after_ms: Math.ceil((1 - o) * kn),
    })
  E(
    e,
    "INSERT INTO rate_buckets (sender, target_durable_id, tokens, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(sender, target_durable_id) DO UPDATE SET tokens = excluded.tokens, updated_at = excluded.updated_at",
    [t, n.target_durable_id, o - 1, n.now],
  )
  return
}
function nd(e, n) {
  if (n.binding === null) return { expires_at: null }
  let t = e.sql.one(
      ["revision", "status", "session_durable_id", "direction_inbound", "expires_at"],
      "SELECT revision, status, session_durable_id, direction_inbound, expires_at FROM bindings WHERE binding_id = ?",
      [n.binding.binding_id],
    ),
    r = t?.expires_at === null || t?.expires_at === void 0 ? null : Date.parse(String(t.expires_at))
  if (
    t === void 0 ||
    t.status !== "active" ||
    Number(t.revision) !== n.binding.revision ||
    String(t.session_durable_id) !== n.target_durable_id ||
    Number(t.direction_inbound) !== 1 ||
    (r !== null && r <= n.now)
  )
    return ee("invalid_arguments", "The binding is not active for this session at this revision.", {
      binding: n.binding.binding_id,
    })
  return { expires_at: r }
}
async function Pn(e, n, t) {
  if (!vo(n.provenance)) return ee("invalid_arguments", "Delivery provenance is required.")
  if (!ut.test(n.target_durable_id) || !ut.test(n.delivery_id))
    return ee("invalid_arguments", "The target session id is not a durable session id.")
  if (!(await ti(e, "enqueue", !1))) return { kind: "busy" }
  let r = null,
    o = !1,
    i = e.afterCommit?.length ?? 0,
    s = e.afterCommit === void 0 ? "COMMIT" : "RELEASE gateway_enqueue"
  try {
    let u = Ln(
        e,
        { principal: n.sender_principal, operation: "deliver", idempotency_key: n.receipt.idempotency_key },
        n.now,
      ),
      a = wr(e, n.sender_principal, n.receipt.idempotency_key)
    if (a !== void 0) {
      let p = ui(e, n, a)
      return (e.sql.exec(s), (o = !0), p)
    }
    let m = (t === void 0 ? [] : ye(e, "ledger_id = ?", [t.ledger_id]))[0]
    if (t !== void 0 && m !== void 0) {
      let p = t.existing(m, mt(e, m))
      return (e.sql.exec(s), (o = !0), p)
    }
    let l = nd(e, n)
    if ("kind" in l) return (dn(e), l)
    let c = e.sql.one(
        ["n", "b"],
        `SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS b FROM deliveries WHERE target_durable_id = ? AND state IN ${Z}`,
        [n.target_durable_id],
      ),
      g = Buffer.byteLength(n.body)
    if (Number(c?.n ?? 0) >= mr || Number(c?.b ?? 0) + g > nn)
      return (dn(e), ee("queue_full", "The target's delivery backlog is full.", { max_messages: mr, max_bytes: nn }))
    let f = Js(e, n)
    if ("kind" in f) return (dn(e), f)
    let b = Zs(e, n) ?? ed(e, n)
    if (b !== void 0) return (dn(e), b)
    if (f.new_root)
      E(e, "INSERT INTO causal_roots (root_id, origin_principal, created_at, expires_at) VALUES (?, ?, ?, ?)", [
        f.root_id,
        n.sender_principal,
        n.now,
        n.now + ur,
      ])
    let T = {
      delivery_id: n.delivery_id,
      target_durable_id: n.target_durable_id,
      seq: ii(e, n.target_durable_id),
      sender: n.sender_principal,
      sender_turn: n.sender_turn,
      envelope: {
        provenance: n.provenance,
        origin: n.origin,
        actor: n.actor,
        via: f.via,
        root_id: f.root_id,
        hop: f.hop,
        delivery_id: n.delivery_id,
        ...(n.authority === void 0 ? {} : { authority: n.authority }),
      },
      body: n.body,
      bytes: g,
      mode_requested: n.mode,
      mode_effective: null,
      expected_turn_id: n.expected_turn_id,
      state: "queued",
      reason: null,
      admitted_by: null,
      claimed_at: null,
      attempt: 0,
      admission_kind: null,
      wait_kind: null,
      turn_epoch: null,
      root_id: f.root_id,
      hop: f.hop,
      created_at: n.now,
      updated_at: n.now,
      expires_at: Math.min(n.now + dr, l.expires_at ?? Number.POSITIVE_INFINITY),
      binding_id: n.binding?.binding_id ?? null,
      binding_revision: n.binding?.revision ?? null,
      actor_user_id: "external" in n.origin ? (n.origin.external.author?.user_id ?? null) : null,
      ledger_id: t?.ledger_id ?? null,
      verbatim_text: t?.verbatim_text ?? null,
      verbatim_display_text: t?.verbatim_display_text ?? null,
    }
    ai(e, T)
    let N = mt(e, T),
      h = t?.answer(T, N)
    if (
      (E(
        e,
        "INSERT INTO receipts (principal, operation, idempotency_key, args_hash, status, delivery_id, owner_instance, result, created_at, updated_at, expires_at) VALUES (?, 'deliver', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          n.sender_principal,
          n.receipt.idempotency_key,
          n.receipt.args_hash,
          h === void 0 ? "prepared" : "completed",
          T.delivery_id,
          e.config.instance_id,
          h === void 0 ? null : JSON.stringify(h),
          n.now,
          n.now,
          n.now + Rn,
        ],
      ),
      (r = ri(e, T.target_durable_id, T.delivery_id, !1)),
      sn(e, n.now, u),
      e.afterCommit === void 0)
    )
      await e.hook("beforeDbCommit")
    if ((e.sql.exec(s), (o = !0), e.afterCommit === void 0)) await e.hook("afterDbCommit")
    return { kind: "inserted", row: T, queue_position: N }
  } catch (u) {
    if (!o) {
      if ((dn(e), e.afterCommit !== void 0)) e.afterCommit.length = i
      if (r !== null) Ir(r, { force: !0 })
    }
    throw u
  }
}
function mi(e, n) {
  if (e === null) return ""
  let t = n.get(e)
  if (t === void 0) {
    try {
      t = Hs(e, "utf8")
    } catch (r) {
      if (!(r instanceof Error && "code" in r && r.code === "ENOENT")) throw r
      t = ""
    }
    n.set(e, t)
  }
  return t
}
function td(e, n) {
  let t = new Map()
  for (let r of mi(e, n).split(`
`)) {
    if (!r.includes(lr)) continue
    let o
    try {
      o = JSON.parse(r)
    } catch {
      continue
    }
    let i = o
    if (i.type !== "custom" || i.customType !== lr) continue
    let s = i.data?.host_instance,
      u = typeof i.data?.released_at === "string" ? Date.parse(i.data.released_at) : Number.NaN
    if (typeof s !== "string" || s.length === 0 || !Number.isFinite(u)) continue
    t.set(s, Math.max(u, t.get(s) ?? u))
  }
  return t
}
function rd(e, n, t) {
  if (e.runtime_instance === null || n === null) return !1
  let r = t().get(e.runtime_instance)
  return r !== void 0 && n <= r
}
function Zo(e, n, t) {
  for (let r of mi(e, t).split(`
`)) {
    if (!r.includes(n)) continue
    let o
    try {
      o = JSON.parse(r)
    } catch {
      continue
    }
    if (typeof o !== "object" || o === null) continue
    let i = o
    if (i.type === "custom_message" && i.customType === Io && i.details?.delivery_id === n) return !0
  }
  return !1
}
function ei(e) {
  return `${JSON.stringify(e.admitted_by)}#${e.attempt}`
}
var od =
  "admitted_by = NULL, claimed_at = NULL, mode_effective = NULL, admission_kind = NULL, wait_kind = NULL, turn_epoch = NULL"
function Ne(e, n, t, r, o = {}) {
  if (t === "queued") {
    E(e, `UPDATE deliveries SET state = 'queued', ${od}, updated_at = ? WHERE delivery_id = ?`, [r, n.delivery_id])
    return
  }
  if (t === "refused") {
    E(e, "UPDATE deliveries SET state = 'refused', reason = ?, updated_at = ? WHERE delivery_id = ?", [
      o.reason ?? null,
      r,
      n.delivery_id,
    ])
    return
  }
  if (
    (E(e, "UPDATE deliveries SET state = ?, updated_at = ? WHERE delivery_id = ?", [t, r, n.delivery_id]),
    t === "applied")
  )
    E(e, "UPDATE session_meta SET applied_seq = MAX(applied_seq, ?) WHERE durable_id = ?", [n.seq, n.target_durable_id])
}
async function li(e, n) {
  let t = n.target_durable_id,
    r = new Map(),
    o = new Map(),
    i = new Map(),
    s,
    u = () => ((s ??= td(n.session_path, o)), s)
  for (let d of ye(e, "target_durable_id = ? AND state IN ('admitting', 'admitted')", [t])) {
    if (d.admitted_by === null || tt(d.admitted_by, n.self)) continue
    let m = JSON.stringify(d.admitted_by),
      l = i.get(m)
    if (l === void 0) ((l = await On(d.admitted_by)), i.set(m, l))
    let g = !(l || rd(d.admitted_by, d.claimed_at, u)) ? "dual" : Zo(n.session_path, xr(d), o) ? "applied" : "queued"
    r.set(d.delivery_id, { fingerprint: ei(d), to: g })
  }
  let a = new Set()
  for (let d of ye(e, "target_durable_id = ? AND state = 'queued' AND ledger_id IS NOT NULL", [t]))
    if (Zo(n.session_path, xr(d), o)) a.add(d.delivery_id)
  if (e.config.test_hooks.announceBarrier === !0) e.emit({ kind: "barrier", op: "reconcile" })
  return await x(e, "reconcile", () => {
    let d = new Set(n.ledger.pending),
      m = new Set(n.ledger.emitted),
      l = [],
      c = []
    for (let f of ye(e, `target_durable_id = ? AND state IN ${Z}`, [t], "seq")) {
      let b = f.state
      if (f.state === "queued") {
        if (f.ledger_id != null && (a.has(f.delivery_id) || m.has(f.ledger_id)))
          (Ne(e, f, "applied", n.now), l.push({ delivery_id: f.delivery_id, from: f.state, to: "applied" }))
        else if (f.expires_at <= n.now)
          (Ne(e, f, "refused", n.now, { reason: "expired" }),
            l.push({ delivery_id: f.delivery_id, from: f.state, to: "refused" }))
        continue
      }
      if (f.admitted_by !== null && tt(f.admitted_by, n.self)) {
        let T = xr(f)
        b = m.has(T) ? "applied" : d.has(T) ? "admitted" : "queued"
      } else if (f.admitted_by === null) b = "queued"
      else {
        let T = r.get(f.delivery_id)
        if (T === void 0 || T.fingerprint !== ei(f) || T.to === "dual") {
          c.push(f.delivery_id)
          continue
        }
        b = T.to
      }
      if (b === f.state) continue
      ;(Ne(e, f, b, n.now), l.push({ delivery_id: f.delivery_id, from: f.state, to: b }))
    }
    for (let f of oi(e, t))
      if (e.sql.one(["state"], "SELECT state FROM deliveries WHERE delivery_id = ?", [f])?.state !== "queued")
        je(e, t, f)
    return { queued: ye(e, "target_durable_id = ? AND state = 'queued'", [t], "seq"), transitions: l, dual_runtime: c }
  })
}
async function pi(e, n) {
  return await x(e, "claim", () => {
    let t = he(e, n.delivery_id)
    if (t === void 0 || t.state !== "queued") return { kind: "lost", state: t?.state ?? null }
    if (t.expires_at <= n.now)
      return (
        Ne(e, t, "refused", n.now, { reason: "expired" }),
        je(e, t.target_durable_id, t.delivery_id),
        { kind: "lost", state: "refused" }
      )
    return (
      E(
        e,
        "UPDATE deliveries SET state = 'admitting', admitted_by = ?, claimed_at = ?, attempt = attempt + 1, mode_effective = ?, updated_at = ? WHERE delivery_id = ? AND state = 'queued'",
        [JSON.stringify(n.self), n.now, n.lane, n.now, n.delivery_id],
      ),
      je(e, t.target_durable_id, t.delivery_id),
      { kind: "claimed", row: he(e, n.delivery_id) }
    )
  })
}
async function ci(e, n) {
  return await x(e, "record_outcome", () => {
    let t = he(e, n.delivery_id)
    if (
      t === void 0 ||
      (t.state !== "admitting" && t.state !== "admitted") ||
      t.admitted_by === null ||
      !tt(t.admitted_by, n.self)
    )
      return { kind: "lost", state: t?.state ?? null }
    let r = n.outcome
    if (r.kind === "requeue") Ne(e, t, "queued", n.now)
    else if (r.kind === "refused") Ne(e, t, "refused", n.now, { reason: r.reason })
    else if (
      (E(
        e,
        "UPDATE deliveries SET admission_kind = ?, wait_kind = ?, turn_epoch = ?, updated_at = ? WHERE delivery_id = ?",
        [r.admission_kind, r.wait_kind ?? null, r.turn_epoch, n.now, t.delivery_id],
      ),
      t.state !== r.kind)
    )
      Ne(e, t, r.kind, n.now)
    return { kind: "claimed", row: he(e, n.delivery_id) }
  })
}
async function fi(e, n) {
  return await x(e, "refuse", () => {
    let t = he(e, n.delivery_id)
    if (t === void 0 || t.state !== "queued") return !1
    return (Ne(e, t, "refused", n.now, { reason: n.reason }), je(e, t.target_durable_id, t.delivery_id), !0)
  })
}
async function lt(e, n) {
  return await x(
    e,
    "complete_receipt",
    () =>
      E(
        e,
        "UPDATE receipts SET status = 'completed', result = ?, updated_at = ? WHERE principal = ? AND operation = 'deliver' AND idempotency_key = ? AND status = 'prepared' AND owner_instance = ?",
        [JSON.stringify(n.result), n.now, n.principal, n.idempotency_key, e.config.instance_id],
      ) === 1,
  )
}
async function pt(e, n) {
  return await x(
    e,
    "abandon_receipt",
    () =>
      E(
        e,
        "UPDATE receipts SET status = 'uncertain', error_note = ?, updated_at = ? WHERE principal = ? AND operation = 'deliver' AND idempotency_key = ? AND status = 'prepared' AND owner_instance = ?",
        [n.error_note, n.now, n.principal, n.idempotency_key, e.config.instance_id],
      ) === 1,
  )
}
function ct(e, n) {
  let t = wr(e, n.principal, n.idempotency_key)
  if (t === void 0 || t.expires_at <= n.now || t.delivery_id === null) return null
  let r = he(e, t.delivery_id)
  if (r === void 0) return null
  let o = t.status === "completed" && t.result !== null
  return {
    args_hash: t.args_hash,
    completed: o,
    result: o ? JSON.parse(t.result) : null,
    target_durable_id: r.target_durable_id,
    binding_revision: r.binding_revision,
  }
}
async function ft(e, n) {
  return await x(e, "recover_delivery", () => {
    let t = wr(e, n.principal, n.idempotency_key)
    if (t === void 0 || t.expires_at <= n.now) return null
    return ui(
      e,
      {
        now: n.now,
        sender_principal: n.principal,
        endpoint_kind: null,
        receipt: { idempotency_key: n.idempotency_key, args_hash: n.args_hash },
      },
      t,
    )
  })
}
function Mn(e, n) {
  let t = he(e, n)
  return t === void 0 ? null : { row: t, queue_position: mt(e, t) }
}
function yi(e, n) {
  if (n.target_durable_id !== void 0) return ye(e, "target_durable_id = ?", [n.target_durable_id], "seq")
  if (n.root_id !== void 0) return ye(e, "root_id = ?", [n.root_id], "created_at, seq")
  return ye(e, "1 = 1", [], "created_at, seq")
}
function _i(e, n) {
  if (
    Number(
      e.sql.one(["n"], `SELECT COUNT(*) AS n FROM deliveries WHERE target_durable_id = ? AND state IN ${Z}`, [n])?.n ??
        0,
    ) > 0
  )
    return !0
  return (
    Number(
      e.sql.one(["n"], "SELECT COUNT(*) AS n FROM bindings WHERE session_durable_id = ? AND status = 'active'", [n])
        ?.n ?? 0,
    ) > 0 || oi(e, n).length > 0
  )
}
function gi(e) {
  return String(e.sql.one(["journal_mode"], "SELECT journal_mode FROM pragma_journal_mode()")?.journal_mode ?? "")
}
function Ei(e) {
  return { ...e.stats }
}
async function bi(e, n) {
  let t = 0
  for (let r of e.config.legacy_mailbox_directories) {
    let o = `legacy_mailbox:${r}`
    if (e.sql.one(["value"], "SELECT value FROM gateway_meta WHERE key = ?", [o]) !== void 0) continue
    let i
    try {
      i = Ao(r)
    } catch (d) {
      e.emit({ kind: "legacy_mailbox_invalid", directory: r, error: d instanceof Error ? d.message : String(d) })
      continue
    }
    if (i === null) continue
    let s = id(),
      u = i
        .filter((d) => !ut.test(d.target))
        .map((d) => ({ message_seq: d.message_seq, target: d.target, reason: "invalid_target" })),
      a = i.filter((d) => ut.test(d.target))
    if (
      ((t += await x(e, "migrate_legacy", () => {
        let d = 0
        for (let m of a) {
          let l = `legacy-${Ys([r, m.message_seq]).slice(0, 32)}`
          if (he(e, l) !== void 0) continue
          let c = `root-${Tr()}`,
            g = `legacy:${r}`
          E(e, "INSERT INTO causal_roots (root_id, origin_principal, created_at, expires_at) VALUES (?, ?, ?, ?)", [
            c,
            g,
            n,
            n + ur,
          ])
          let f = Date.parse(m.accepted_at)
          ;(ai(e, {
            delivery_id: l,
            target_durable_id: m.target,
            seq: ii(e, m.target),
            sender: g,
            sender_turn: null,
            envelope: {
              provenance: { workspace: "unclassified", project: "legacy-mailbox" },
              origin: {
                external: {
                  platform: "legacy_mailbox",
                  account_id: s,
                  chat_id: r,
                  thread_id: "@chat",
                  message_id: m.operation_id,
                },
              },
              actor: "legacy thread mailbox",
              via: [g],
              root_id: c,
              hop: 1,
              delivery_id: l,
            },
            body: m.message,
            bytes: Buffer.byteLength(m.message),
            mode_requested: m.delivery,
            mode_effective: null,
            expected_turn_id: m.expected_turn_id,
            state: "queued",
            reason: null,
            admitted_by: null,
            claimed_at: null,
            attempt: 0,
            admission_kind: null,
            wait_kind: null,
            turn_epoch: null,
            root_id: c,
            hop: 1,
            created_at: Number.isFinite(f) ? f : n,
            updated_at: n,
            expires_at: n + dr,
            binding_id: null,
            binding_revision: null,
            actor_user_id: null,
          }),
            ri(e, m.target, l, !0),
            d++)
        }
        return (
          E(e, "INSERT INTO gateway_meta (key, value) VALUES (?, ?)", [
            o,
            JSON.stringify({ migrated_at: n, count: d, skipped: u }),
          ]),
          d
        )
      })),
      u.length > 0)
    )
      e.emit({ kind: "legacy_mailbox_skipped", directory: r, items: u })
  }
  return t
}
function id() {
  try {
    return Xs().username
  } catch {
    return "unknown"
  }
}
import { randomUUID as md } from "node:crypto"
import { renameSync as ld, writeFileSync as pd } from "node:fs"
var ad = ["question", "select", "confirm", "input", "editor"]
function hi(e) {
  return typeof e === "string" && ad.includes(e)
}
var Ti = new Map([
  ["yes", !0],
  ["y", !0],
  ["true", !0],
  ["no", !1],
  ["n", !1],
  ["false", !1],
])
function kr(e) {
  return e.replace(/[\s\p{Cf}]/gu, "") === ""
}
function sd(e) {
  let n = Ti.get(e.trim().toLowerCase())
  return n === void 0 ? { value: e, answers: {}, comment: e } : { value: e, answers: {}, comment: e, confirmed: n }
}
function yt(e, n) {
  switch (e) {
    case null:
      return kr(n)
        ? {
            ok: !1,
            reason:
              "The question declared no request kind, so the answer needs text; this one is blank. An input or editor that takes an empty answer must be reported with its request kind.",
          }
        : { ok: !0, fields: sd(n) }
    case "input":
    case "editor":
      return { ok: !0, fields: { value: n } }
    case "select":
      return kr(n)
        ? { ok: !1, reason: "A select answer names one of its options; the text is blank." }
        : { ok: !0, fields: { value: n } }
    case "question":
      return kr(n)
        ? { ok: !1, reason: "A question answer needs text; this one is blank." }
        : { ok: !0, fields: { answers: {}, comment: n } }
    case "confirm": {
      let t = Ti.get(n.trim().toLowerCase())
      return t === void 0
        ? {
            ok: !1,
            reason: "A confirm answer is yes or no (also y/n, true/false; any case, surrounding spaces ignored).",
          }
        : { ok: !0, fields: { confirmed: t } }
    }
    default:
      return dd(e)
  }
}
function dd(e) {
  throw Error(`unknown extension UI request kind: ${String(e)}`)
}
async function Rr(e, n) {
  await x(e, "register_incarnation", () => {
    E(
      e,
      `INSERT INTO session_meta (durable_id, next_seq, incarnation, endpoint_socket, endpoint_kind)
       VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM deliveries WHERE target_durable_id = ?), ?, ?, ?)
       ON CONFLICT(durable_id) DO UPDATE SET incarnation = excluded.incarnation,
       endpoint_socket = excluded.endpoint_socket, endpoint_kind = excluded.endpoint_kind`,
      [n.durable_id, n.durable_id, n.incarnation, n.endpoint?.socket ?? null, n.endpoint?.kind ?? null],
    )
  })
}
async function Ii(e, n) {
  await x(e, "clear_endpoint", () => {
    E(
      e,
      "UPDATE session_meta SET endpoint_socket = NULL, endpoint_kind = NULL WHERE durable_id = ? AND incarnation = ?",
      [n.durable_id, n.incarnation],
    )
  })
}
function wi(e, n) {
  let t = e.sql.one(
    ["incarnation", "endpoint_socket", "endpoint_kind"],
    "SELECT incarnation, endpoint_socket, endpoint_kind FROM session_meta WHERE durable_id = ?",
    [n],
  )
  if (t === void 0 || typeof t.incarnation !== "string") return null
  return {
    incarnation: t.incarnation,
    endpoint:
      typeof t.endpoint_socket === "string" && (t.endpoint_kind === "tui" || t.endpoint_kind === "rpc_host")
        ? { socket: t.endpoint_socket, kind: t.endpoint_kind }
        : null,
  }
}
var _t = [
    "binding_id",
    "schema_version",
    "revision",
    "status",
    "platform",
    "account_id",
    "chat_id",
    "thread_id",
    "root_message_id",
    "progress_message_id",
    "session_realm_id",
    "session_durable_id",
    "direction_inbound",
    "direction_outbound",
    "inbound_mode",
    "outbound_events",
    "policy_id",
    "created_at",
    "updated_at",
    "lease_started_at",
    "ttl_seconds",
    "expires_at",
  ],
  ki = [
    "cursor",
    "binding_id",
    "revision",
    "event_kind",
    "payload",
    "state",
    "provider_message_id",
    "created_at",
    "reply_token",
    "question_state",
    "outcome",
    "answered_by",
    "answer_state",
  ]
function S(e, n, t) {
  return { kind: "refused", code: e, message: n, ...(t === void 0 ? {} : { details: t }) }
}
function ie(e) {
  return e === null || e === void 0 ? null : String(e)
}
function Or(e) {
  return e === null || e === void 0 ? null : JSON.stringify(e)
}
function Si(e) {
  return e === null || e === void 0 ? null : JSON.parse(String(e))
}
function gt(e, n, t, r) {
  if (e.afterCommit !== void 0) {
    e.afterCommit.push(() => gt({ ...e, afterCommit: void 0 }, n, t, r))
    return
  }
  let o = Ro(e.config.agent_dir),
    i = `${o}.${process.pid}.${md()}.tmp`
  ;(pd(i, JSON.stringify({ binding_id: n, cursor: t, written_at: B(r) }), { mode: 384 }), ld(i, o))
}
function cd(e) {
  return {
    schema_version: 1,
    binding_id: String(e.binding_id),
    revision: Number(e.revision),
    status: e.status,
    platform: e.platform,
    account_id: String(e.account_id),
    chat_id: String(e.chat_id),
    thread_id: String(e.thread_id),
    root_message_id: ie(e.root_message_id),
    progress_message_id: ie(e.progress_message_id),
    session_realm_id: String(e.session_realm_id),
    session_durable_id: String(e.session_durable_id),
    direction: { inbound: Number(e.direction_inbound) === 1, outbound: Number(e.direction_outbound) === 1 },
    inbound_mode: e.inbound_mode,
    outbound_events: JSON.parse(String(e.outbound_events)),
    policy_id: String(e.policy_id),
    created_at: String(e.created_at),
    updated_at: String(e.updated_at),
    lease_started_at: String(e.lease_started_at),
    ttl_seconds: e.ttl_seconds === null || e.ttl_seconds === void 0 ? null : Number(e.ttl_seconds),
    expires_at: ie(e.expires_at),
  }
}
function un(e, n, t, r) {
  let o = `SELECT ${_t.join(", ")} FROM bindings WHERE ${n}${r === void 0 ? "" : ` ORDER BY ${r.orderBy} LIMIT ?`}`
  return e.sql.all(_t, o, r === void 0 ? t : [...t, r.limit], r?.orderBy).map(cd)
}
function _e(e, n) {
  return un(e, "binding_id = ?", [n])[0]
}
function $r(e, n) {
  let t = e.sql.one(["value"], "SELECT value FROM gateway_meta WHERE key = ?", [n])
  if (t === void 0) throw Error(`gateway_meta ${n} is missing`)
  return String(t.value)
}
function Ae(e, n) {
  let t = B(n)
  E(
    e,
    "UPDATE bindings SET status = 'expired', updated_at = ? WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?",
    [t, t],
  )
}
function Sr(e, n) {
  ;(E(e, "DELETE FROM outbox WHERE state = 'acked' AND acked_at IS NOT NULL AND acked_at <= ?", [n - Nn]),
    E(
      e,
      "DELETE FROM outbox WHERE state = 'pending' AND binding_id IN (SELECT binding_id FROM bindings WHERE status != 'active' AND updated_at <= ?)",
      [B(n - Nn)],
    ))
}
function vi(e, n) {
  let t = e.sql.one(
    ["args_hash", "status", "owner_instance", "result"],
    "SELECT args_hash, status, owner_instance, result FROM receipts WHERE principal = ? AND operation = ? AND idempotency_key = ?",
    [n.principal, n.operation, n.idempotency_key],
  )
  if (t === void 0) return
  return {
    args_hash: String(t.args_hash),
    status: String(t.status),
    owner_instance: String(t.owner_instance),
    result: ie(t.result),
  }
}
function fd(e, n) {
  if (n === null) return
  let t = vi(e, n)
  if (t === void 0) return
  if (t.args_hash !== n.args_hash)
    return S("idempotency_conflict", "The idempotency key was already used with different arguments.")
  if (t.status === "completed" && t.result !== null) return { ...JSON.parse(t.result), kind: "ok", deduplicated: !0 }
  return S("idempotency_uncertain", "An earlier call under this key did not record its outcome.")
}
function yd(e, n, t, r) {
  if (n === null) return
  E(
    e,
    "INSERT INTO receipts (principal, operation, idempotency_key, args_hash, status, delivery_id, owner_instance, result, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, 'completed', NULL, ?, ?, ?, ?, ?)",
    [n.principal, n.operation, n.idempotency_key, n.args_hash, e.config.instance_id, JSON.stringify(r), t, t, t + Rn],
  )
}
async function Et(e, n, t, r, o) {
  return await x(e, n, () => {
    Ae(e, t)
    let i = r === null ? 0 : Ln(e, r, t),
      s = fd(e, r)
    if (s !== void 0) return s
    let u = o()
    if (u.kind === "ok") yd(e, r, t, { ...u, deduplicated: !1 })
    return (sn(e, t, i), u.kind === "ok" ? { ...u, deduplicated: !1 } : u)
  })
}
async function Oi(e, n) {
  return await x(e, "tool_receipt_begin", () => {
    let t = Ln(e, n, n.now),
      r = _d(e, n)
    return (sn(e, n.now, t), r)
  })
}
function _d(e, n) {
  let t = vi(e, n)
  if (t === void 0)
    return (
      E(
        e,
        "INSERT INTO receipts (principal, operation, idempotency_key, args_hash, status, delivery_id, owner_instance, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, 'prepared', NULL, ?, ?, ?, ?)",
        [n.principal, n.operation, n.idempotency_key, n.args_hash, e.config.instance_id, n.now, n.now, n.now + Rn],
      ),
      { kind: "accepted" }
    )
  if (t.args_hash !== n.args_hash) return { kind: "conflict" }
  if (t.status === "completed") return { kind: "replay", result: t.result === null ? null : JSON.parse(t.result) }
  if (t.status === "prepared" && t.owner_instance === e.config.instance_id) return { kind: "in_progress" }
  if (t.status === "prepared")
    E(
      e,
      "UPDATE receipts SET status = 'uncertain', error_note = ?, updated_at = ? WHERE principal = ? AND operation = ? AND idempotency_key = ?",
      [
        "the process that began this call ended before recording its outcome",
        n.now,
        n.principal,
        n.operation,
        n.idempotency_key,
      ],
    )
  let r = e.sql.one(
    ["error_note"],
    "SELECT error_note FROM receipts WHERE principal = ? AND operation = ? AND idempotency_key = ?",
    [n.principal, n.operation, n.idempotency_key],
  )
  return { kind: "uncertain", error_note: ie(r?.error_note) }
}
async function $i(e, n) {
  return await x(e, "tool_receipt_settle", () => {
    let t = "result" in n
    return (
      E(
        e,
        `UPDATE receipts SET status = ?, ${t ? "result" : "error_note"} = ?, updated_at = ? WHERE principal = ? AND operation = ? AND idempotency_key = ? AND status = 'prepared' AND owner_instance = ?`,
        [
          t ? "completed" : "uncertain",
          t ? JSON.stringify(n.result) : n.error_note,
          n.now,
          n.principal,
          n.operation,
          n.idempotency_key,
          e.config.instance_id,
        ],
      ) === 1
    )
  })
}
async function Ni(e, n) {
  return await x(
    e,
    "tool_receipt_revise",
    () =>
      E(
        e,
        "UPDATE receipts SET result = ?, updated_at = ? WHERE principal = ? AND operation = ? AND idempotency_key = ? AND status = 'completed' AND owner_instance = ?",
        [JSON.stringify(n.result), n.now, n.principal, n.operation, n.idempotency_key, e.config.instance_id],
      ) === 1,
  )
}
async function Ai(e, n) {
  return await x(
    e,
    "tool_receipt_release",
    () =>
      E(
        e,
        "DELETE FROM receipts WHERE principal = ? AND operation = ? AND idempotency_key = ? AND status = 'prepared' AND owner_instance = ?",
        [n.principal, n.operation, n.idempotency_key, e.config.instance_id],
      ) === 1,
  )
}
async function bt(e, n) {
  let t = n.binding
  return await Et(e, "bind", n.now, n.receipt, () => {
    let r = un(e, "platform = ? AND account_id = ? AND chat_id = ? AND thread_id = ? AND status = 'active'", [
      t.platform,
      t.account_id,
      t.chat_id,
      t.thread_id,
    ])[0]
    if (r !== void 0) {
      let s = r.session_durable_id === t.session_durable_id
      return S(
        "binding_conflict",
        s
          ? "This thread is already bound to that session."
          : "This thread is bound to another session; rebind it explicitly to move it.",
        { binding_id: r.binding_id, revision: r.revision, session: r.session_durable_id },
      )
    }
    let o = B(n.now),
      i = {
        schema_version: 1,
        binding_id: Bo(),
        revision: 1,
        status: "active",
        platform: t.platform,
        account_id: t.account_id,
        chat_id: t.chat_id,
        thread_id: t.thread_id,
        root_message_id: t.root_message_id,
        progress_message_id: t.progress_message_id,
        session_realm_id: $r(e, "realm_id"),
        session_durable_id: t.session_durable_id,
        direction: t.direction,
        inbound_mode: t.inbound_mode,
        outbound_events: t.outbound_events,
        policy_id: t.policy_id,
        created_at: o,
        updated_at: o,
        lease_started_at: o,
        ttl_seconds: t.ttl_seconds,
        expires_at: t.ttl_seconds === null ? null : B(n.now + t.ttl_seconds * 1000),
      }
    return (
      E(e, `INSERT INTO bindings (${_t.join(", ")}) VALUES (${_t.map(() => "?").join(", ")})`, [
        i.binding_id,
        i.schema_version,
        i.revision,
        i.status,
        i.platform,
        i.account_id,
        i.chat_id,
        i.thread_id,
        i.root_message_id,
        i.progress_message_id,
        i.session_realm_id,
        i.session_durable_id,
        i.direction.inbound ? 1 : 0,
        i.direction.outbound ? 1 : 0,
        i.inbound_mode,
        JSON.stringify(i.outbound_events),
        i.policy_id,
        i.created_at,
        i.updated_at,
        i.lease_started_at,
        i.ttl_seconds,
        i.expires_at,
      ]),
      { kind: "ok", binding: i }
    )
  })
}
function Ri(e, n) {
  return e.sql
    .all(["delivery_id"], `SELECT delivery_id, seq FROM deliveries WHERE binding_id = ? AND state IN ${Z}`, [n], "seq")
    .map((t) => String(t.delivery_id))
}
async function xt(e, n) {
  return await Et(e, "unbind", n.now, n.receipt, () => {
    let t = _e(e, n.binding_id)
    if (t === void 0) return S("not_found", "No binding has this id.", { binding_id: n.binding_id })
    if (t.status !== "active") return { kind: "ok", binding: t, already_closed: !0, in_flight: Ri(e, t.binding_id) }
    if (t.revision !== n.expected_revision)
      return S("stale_revision", "The binding changed since that revision.", {
        binding_id: t.binding_id,
        revision: t.revision,
      })
    let r = B(n.now)
    return (
      E(
        e,
        "UPDATE bindings SET status = 'detached', revision = revision + 1, updated_at = ? WHERE binding_id = ? AND revision = ?",
        [r, t.binding_id, t.revision],
      ),
      E(e, "DELETE FROM completion_arms WHERE binding_id = ?", [t.binding_id]),
      { kind: "ok", binding: _e(e, t.binding_id), already_closed: !1, in_flight: Ri(e, t.binding_id) }
    )
  })
}
async function ht(e, n) {
  return await Et(e, "rebind", n.now, n.receipt, () => {
    let t = _e(e, n.binding_id)
    if (t === void 0) return S("not_found", "No binding has this id.", { binding_id: n.binding_id })
    if (t.status !== "active")
      return S("binding_inactive", `The binding is ${t.status}.`, { binding_id: t.binding_id, status: t.status })
    if (t.revision !== n.expected_revision)
      return S("stale_revision", "The binding changed since that revision.", {
        binding_id: t.binding_id,
        revision: t.revision,
      })
    if (t.session_durable_id === n.session_durable_id)
      return S("invalid_arguments", "The binding is already attached to that session.", { binding_id: t.binding_id })
    let r = B(n.now),
      o = e.sql
        .all(
          ["delivery_id", "target"],
          "SELECT delivery_id, target_durable_id AS target, seq FROM deliveries WHERE binding_id = ? AND binding_revision = ? AND state = 'queued'",
          [t.binding_id, t.revision],
          "seq",
        )
        .map((i) => ({ delivery_id: String(i.delivery_id), target: String(i.target) }))
    for (let i of o)
      (E(
        e,
        "UPDATE deliveries SET state = 'refused', reason = 'binding_closed', updated_at = ? WHERE delivery_id = ? AND state = 'queued'",
        [n.now, i.delivery_id],
      ),
        je(e, i.target, i.delivery_id))
    return (
      E(
        e,
        "UPDATE bindings SET session_durable_id = ?, revision = revision + 1, lease_started_at = ?, updated_at = ? WHERE binding_id = ? AND revision = ?",
        [n.session_durable_id, r, r, t.binding_id, t.revision],
      ),
      E(e, "DELETE FROM completion_arms WHERE binding_id = ?", [t.binding_id]),
      { kind: "ok", binding: _e(e, t.binding_id), closed: o.map((i) => i.delivery_id) }
    )
  })
}
async function Tt(e, n) {
  let t = n.cursor === void 0 ? null : Xo(n.cursor)
  if (n.cursor !== void 0 && t === null)
    return S("cursor_invalid", "The bindings cursor is not one this gateway issued.")
  let r = Math.min(Math.max(n.limit ?? Fo, 1), qo)
  return await x(e, "list_bindings", () => {
    Ae(e, n.now)
    let o = t?.as_of ?? Number(e.sql.one(["m"], "SELECT COALESCE(MAX(rowid), 0) AS m FROM bindings")?.m ?? 0),
      i = ["rowid <= ?"],
      s = [o],
      u = [
        ["session_durable_id", "session_durable_id"],
        ["platform", "platform"],
        ["account_id", "account_id"],
        ["chat_id", "chat_id"],
        ["thread_id", "thread_id"],
        ["status", "status"],
      ]
    for (let [l, c] of u) {
      let g = n.filter[l]
      if (g === void 0) continue
      ;(i.push(`${c} = ?`), s.push(g))
    }
    if (t?.after != null)
      (i.push("(created_at > ? OR (created_at = ? AND binding_id > ?))"), s.push(t.after[0], t.after[0], t.after[1]))
    let a = un(e, i.join(" AND "), s, { orderBy: "created_at, binding_id", limit: r + 1 }),
      d = a.slice(0, r),
      m = d.at(-1)
    return {
      kind: "ok",
      bindings: d,
      next_cursor: a.length > r && m !== void 0 ? zo(o, [m.created_at, m.binding_id]) : null,
    }
  })
}
async function It(e, n) {
  return await x(e, "binding_view", () => (Ae(e, n.now), _e(e, n.binding_id) ?? null))
}
async function Li(e, n) {
  return await x(
    e,
    "binding_for",
    () => (
      Ae(e, n.now),
      un(e, "platform = ? AND account_id = ? AND chat_id = ? AND thread_id = ? AND status = 'active'", [
        n.platform,
        n.account_id,
        n.chat_id,
        n.thread_id,
      ])[0] ?? null
    ),
  )
}
function Ci(e, n) {
  return ie(e.sql.one(["incarnation"], "SELECT incarnation FROM session_meta WHERE durable_id = ?", [n])?.incarnation)
}
function gd(e, n, t, r) {
  let o = [
      ...new Set(
        t.flatMap((m) => {
          let l = e.sql.one(
              ["binding_id"],
              "SELECT binding_id FROM deliveries WHERE delivery_id = ? AND target_durable_id = ?",
              [m, n],
            ),
            c = ie(l?.binding_id)
          return c === null ? [] : [c]
        }),
      ),
    ].sort(),
    i = e.sql
      .all(
        ["binding_id"],
        "SELECT binding_id FROM bindings WHERE session_durable_id = ? AND status = 'active' AND direction_outbound = 1",
        [n],
        "binding_id",
      )
      .map((m) => String(m.binding_id)),
    [s, ...u] = o
  if (s !== void 0 && u.length > 0)
    return S(
      "invalid_arguments",
      `This session's current run answers messages from ${o.length} bound threads; name binding_id.`,
      { binding_ids: o },
    )
  if (s !== void 0 && r && i.some((m) => m !== s))
    return S(
      "invalid_arguments",
      "This session's current run answers a bound thread's message and a user message (typed in its terminal or sent by an extension) together; name binding_id.",
      { binding_ids: i },
    )
  if (s !== void 0) return { binding_id: s }
  let [a, ...d] = i
  if (a !== void 0 && d.length === 0) return { binding_id: a }
  if (a === void 0)
    return S(
      "invalid_arguments",
      "This session has no active outbound binding and its current run answers no bound message; name binding_id.",
    )
  return S(
    "invalid_arguments",
    `This session has ${i.length} active outbound bindings and its current run answers no bound message; name binding_id.`,
    { binding_ids: i },
  )
}
function vr(e, n) {
  E(
    e,
    "INSERT INTO outbox (binding_id, revision, event_kind, payload, state, provider_message_id, created_at, acked_at, session_durable_id, reply_token, ui_request_id, ui_request_kind, incarnation, question_state, answer, answered_at, outcome) VALUES (?, ?, ?, ?, 'pending', NULL, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)",
    [
      n.binding.binding_id,
      n.binding.revision,
      n.event,
      JSON.stringify({ text: n.text }),
      n.now,
      n.binding.session_durable_id,
      n.reply_token ?? null,
      n.ui_request_id ?? null,
      n.ui_request_kind ?? null,
      n.incarnation ?? null,
      n.reply_token === void 0 ? null : "pending",
      n.outcome ?? null,
    ],
  )
  let t = Number(e.sql.one(["c"], "SELECT last_insert_rowid() AS c")?.c)
  return (gt(e, n.binding.binding_id, t, n.now), t)
}
async function wt(e, n) {
  return await Et(e, "report", n.now, n.receipt, () => {
    let t =
      n.binding_id === null
        ? gd(e, n.session_durable_id, n.origin_delivery_ids, n.origin_local_input === !0)
        : { binding_id: n.binding_id }
    if ("kind" in t) return t
    let r = t.binding_id,
      o = _e(e, r)
    if (o === void 0) return S("not_found", "No binding has this id.", { binding_id: r })
    if (o.session_durable_id !== n.session_durable_id)
      return S("scope_denied", "The binding is attached to another session.", { binding_id: r })
    if (o.status !== "active")
      return S("binding_inactive", `The binding is ${o.status}.`, { binding_id: r, status: o.status })
    if (!o.direction.outbound)
      return S("unsupported", "The binding carries no outbound direction.", { binding_id: r, direction: o.direction })
    if (!o.outbound_events.includes(n.event))
      return S("unsupported", `The binding is not subscribed to ${n.event} events.`, {
        binding_id: r,
        outbound_events: o.outbound_events,
      })
    if (n.ui_request_kind !== null && n.event !== "question")
      return S("invalid_arguments", "Only a question names a request kind.")
    let i = { binding_id: r, revision: o.revision, event: n.event }
    if (n.event === "completion") {
      E(
        e,
        "INSERT INTO completion_arms (session_durable_id, binding_id, revision, text, armed_at) VALUES (?, ?, ?, ?, ?)",
        [n.session_durable_id, r, o.revision, n.text, n.now],
      )
      let u = Number(e.sql.one(["s"], "SELECT last_insert_rowid() AS s")?.s)
      return { kind: "ok", ...i, cursor: null, reply_token: null, armed: !0, arm_seq: u }
    }
    if (n.event === "question") {
      if (n.ui_request_id === null)
        return S("invalid_arguments", "A question names the session's pending extension UI request (request_id).")
      let u = Ci(e, n.session_durable_id),
        a = Yo($r(e, "token_secret"), {
          binding_id: r,
          revision: o.revision,
          session_durable_id: n.session_durable_id,
          incarnation: u,
          ui_request_id: n.ui_request_id,
        }),
        d = vr(e, {
          binding: o,
          event: "question",
          text: n.text,
          now: n.now,
          reply_token: a,
          ui_request_id: n.ui_request_id,
          ...(n.ui_request_kind === null ? {} : { ui_request_kind: n.ui_request_kind }),
          incarnation: u,
        })
      return (Sr(e, n.now), { kind: "ok", ...i, cursor: d, reply_token: a, armed: !1, arm_seq: null })
    }
    let s = vr(e, { binding: o, event: n.event, text: n.text, now: n.now })
    return (Sr(e, n.now), { kind: "ok", ...i, cursor: s, reply_token: null, armed: !1, arm_seq: null })
  })
}
async function kt(e, n) {
  return await x(e, "emit_completions", () => {
    Ae(e, n.now)
    let t = ["arm_seq", "binding_id", "revision", "text"],
      r =
        n.through_arm_seq === void 0
          ? e.sql.all(
              t,
              "SELECT arm_seq, binding_id, revision, text FROM completion_arms WHERE session_durable_id = ?",
              [n.session_durable_id],
              "arm_seq",
            )
          : e.sql.all(
              t,
              "SELECT arm_seq, binding_id, revision, text FROM completion_arms WHERE session_durable_id = ? AND arm_seq <= ?",
              [n.session_durable_id, n.through_arm_seq],
              "arm_seq",
            ),
      o = new Map()
    for (let s of r)
      (E(e, "DELETE FROM completion_arms WHERE arm_seq = ?", [Number(s.arm_seq)]), o.set(String(s.binding_id), s))
    let i = []
    for (let s of [...o.values()].toSorted((u, a) => (String(u.binding_id) < String(a.binding_id) ? -1 : 1))) {
      let u = _e(e, String(s.binding_id))
      if (
        u === void 0 ||
        u.status !== "active" ||
        u.revision !== Number(s.revision) ||
        u.session_durable_id !== n.session_durable_id
      )
        continue
      if (!u.direction.outbound || !u.outbound_events.includes("completion")) continue
      i.push({
        binding_id: u.binding_id,
        cursor: vr(e, { binding: u, event: "completion", text: String(s.text), now: n.now, outcome: n.outcome }),
      })
    }
    return i
  }).then(
    (t) => (
      e.emit({
        kind: "completions_emitted",
        session_durable_id: n.session_durable_id,
        cursors: t.map((r) => r.cursor),
      }),
      t
    ),
  )
}
function Pi(e, n) {
  return Number(e.sql.one(["n"], "SELECT COUNT(*) AS n FROM completion_arms WHERE session_durable_id = ?", [n])?.n ?? 0)
}
function Mi(e, n) {
  let t = e.sql.one(["s"], "SELECT MAX(arm_seq) AS s FROM completion_arms WHERE session_durable_id = ?", [n])?.s
  return t === null || t === void 0 ? null : Number(t)
}
function Ed(e, n) {
  let t = e.event_kind
  return {
    cursor: Number(e.cursor),
    binding_id: String(e.binding_id),
    revision: Number(e.revision),
    event: t,
    text: String(JSON.parse(String(e.payload)).text ?? ""),
    state: e.state,
    created_at: B(Number(e.created_at)),
    edit_message_id: t === "milestone" ? n.progress_message_id : null,
    provider_message_id: ie(e.provider_message_id),
    reply_token: ie(e.reply_token),
    question_state: e.question_state ?? null,
    outcome: e.outcome ?? null,
    answered_by: Si(e.answered_by),
    answer_state: e.answer_state ?? null,
  }
}
function Di(e, n) {
  return Number(
    e.sql.one(["acked_cursor"], "SELECT acked_cursor FROM outbox_cursors WHERE binding_id = ?", [n])?.acked_cursor ?? 0,
  )
}
async function Rt(e, n) {
  let t = Math.min(Math.max(n.limit ?? jo, 1), Go)
  return await x(e, "read_outbox", () => {
    ;(Ae(e, n.now), Sr(e, n.now))
    let r = _e(e, n.binding_id)
    if (r === void 0) return S("not_found", "No binding has this id.", { binding_id: n.binding_id })
    let o = Di(e, r.binding_id),
      i = n.after_cursor ?? o,
      s = e.sql
        .all(
          ki,
          `SELECT ${ki.join(", ")} FROM outbox WHERE binding_id = ? AND cursor > ?${n.pendingOnly ? " AND state = 'pending'" : ""} ORDER BY cursor LIMIT ?`,
          [r.binding_id, i, t],
          "cursor",
        )
        .map((u) => Ed(u, r))
    return (
      sn(e, n.now),
      {
        kind: "ok",
        binding_id: r.binding_id,
        revision: r.revision,
        status: r.status,
        rows: s,
        next_cursor: s.at(-1)?.cursor ?? i,
        acked_cursor: o,
      }
    )
  })
}
async function St(e, n) {
  return await x(e, "ack_outbox", () => {
    Ae(e, n.now)
    let t = _e(e, n.binding_id)
    if (t === void 0) return S("not_found", "No binding has this id.", { binding_id: n.binding_id })
    let r = Di(e, t.binding_id)
    if (n.cursor <= r) return { kind: "ok", binding_id: t.binding_id, acked_cursor: r, changed: !1 }
    if (
      e.sql.one(["cursor"], "SELECT cursor FROM outbox WHERE binding_id = ? AND cursor = ?", [
        t.binding_id,
        n.cursor,
      ]) === void 0
    ) {
      let o = Number(
        e.sql.one(["m"], "SELECT COALESCE(MAX(cursor), 0) AS m FROM outbox WHERE binding_id = ?", [t.binding_id])?.m ??
          0,
      )
      return S(
        "cursor_invalid",
        n.cursor > o
          ? "The cursor is past the newest outbox row of this binding."
          : "The cursor names no outbox row of this binding.",
        { newest: o },
      )
    }
    if (
      (E(
        e,
        "UPDATE outbox SET state = 'acked', acked_at = ? WHERE binding_id = ? AND cursor <= ? AND state = 'pending'",
        [n.now, t.binding_id, n.cursor],
      ),
      E(
        e,
        "INSERT INTO outbox_cursors (binding_id, acked_cursor, updated_at) VALUES (?, ?, ?) ON CONFLICT(binding_id) DO UPDATE SET acked_cursor = excluded.acked_cursor, updated_at = excluded.updated_at",
        [t.binding_id, n.cursor, n.now],
      ),
      n.provider_message_id !== void 0)
    ) {
      if (
        (E(e, "UPDATE outbox SET provider_message_id = ? WHERE binding_id = ? AND cursor = ?", [
          n.provider_message_id,
          t.binding_id,
          n.cursor,
        ]),
        e.sql.one(["event_kind"], "SELECT event_kind FROM outbox WHERE binding_id = ? AND cursor = ?", [
          t.binding_id,
          n.cursor,
        ])?.event_kind === "milestone" && t.progress_message_id === null)
      )
        E(e, "UPDATE bindings SET progress_message_id = ?, updated_at = ? WHERE binding_id = ?", [
          n.provider_message_id,
          B(n.now),
          t.binding_id,
        ])
    }
    return { kind: "ok", binding_id: t.binding_id, acked_cursor: n.cursor, changed: !0 }
  })
}
var bd = 120000,
  Nr = "The session no longer waits for this question (answered or closed elsewhere)"
async function vt(e, n) {
  return await x(e, "claim_answer", () => {
    Ae(e, n.now)
    let t = Qo($r(e, "token_secret"), n.reply_token)
    if (t === null) return S("invalid_arguments", "This is not a reply token this gateway issued.")
    if (t.binding_id !== n.binding_id)
      return S(
        "binding_mismatch",
        "The answer arrived through a different binding than the one that asked the question.",
        { binding_id: n.binding_id },
      )
    let r = e.sql.one(
      [
        "cursor",
        "question_state",
        "answer_state",
        "answer",
        "answered_at",
        "answered_by",
        "ui_request_id",
        "ui_request_kind",
        "session",
      ],
      "SELECT cursor, question_state, answer_state, answer, answered_at, answered_by, ui_request_id, ui_request_kind, session_durable_id AS session FROM outbox WHERE reply_token = ? AND binding_id = ?",
      [n.reply_token, t.binding_id],
    )
    if (r === void 0) return S("not_found", "The question this token belongs to is no longer in the outbox.")
    let o = r.question_state === "answered" && r.answer_state !== "delivered",
      i = o && Number(r.answered_at) + bd <= n.now
    if (o && !i)
      return S("answer_in_progress", "Another answer to this question is still being handed to the session.", {
        cursor: Number(r.cursor),
      })
    if (r.question_state === "answered" && !i)
      return S(
        "already_answered",
        r.answer === null && r.answer_state === "delivered" ? `${Nr}.` : "This question was already answered.",
        { cursor: Number(r.cursor) },
      )
    let s = hi(r.ui_request_kind) ? r.ui_request_kind : null,
      u = yt(s, n.answer)
    if (!u.ok) return S("invalid_arguments", u.reason, { ui_request_kind: s })
    let a = _e(e, t.binding_id)
    if (
      a === void 0 ||
      a.status !== "active" ||
      a.revision !== t.revision ||
      a.session_durable_id !== t.session_durable_id ||
      Ci(e, t.session_durable_id) !== t.incarnation ||
      ie(r.ui_request_id) !== t.ui_request_id
    )
      return S("stale_token", "The binding or the session changed since the question was asked.", {
        binding_id: t.binding_id,
      })
    return (
      E(
        e,
        "UPDATE outbox SET question_state = 'answered', answer_state = 'in_flight', answer = ?, answered_at = ?, answered_by = ? WHERE reply_token = ?",
        [n.answer, n.now, Or(n.answered_by), n.reply_token],
      ),
      {
        kind: "ok",
        session_durable_id: t.session_durable_id,
        ui_request_id: t.ui_request_id,
        ui_request_kind: s,
        cursor: Number(r.cursor),
        claimed_at: n.now,
        taken_over: i
          ? {
              answer: ie(r.answer),
              answered_at: r.answered_at === null || r.answered_at === void 0 ? null : Number(r.answered_at),
              answered_by: Si(r.answered_by),
            }
          : null,
      }
    )
  })
}
function Ar(e, n, t) {
  let r = e.sql.one(["cursor", "binding_id"], "SELECT cursor, binding_id FROM outbox WHERE reply_token = ?", [n])
  if (r !== void 0) gt(e, String(r.binding_id), Number(r.cursor), t)
}
async function Ot(e, n) {
  return await x(e, "release_answer", () => {
    let t =
      E(
        e,
        "UPDATE outbox SET question_state = 'pending', answer_state = NULL, answer = NULL, answered_at = NULL, answered_by = NULL WHERE reply_token = ? AND question_state = 'answered' AND answer_state = 'in_flight' AND answered_at = ?",
        [n.reply_token, n.claimed_at],
      ) === 1
    if (t) Ar(e, n.reply_token, n.claimed_at)
    return t
  })
}
async function $t(e, n) {
  return await x(e, "mark_prior_delivered", () => {
    let t =
      E(
        e,
        "UPDATE outbox SET answer_state = 'delivered', answer = ?, answered_at = ?, answered_by = ? WHERE reply_token = ? AND question_state = 'answered' AND answer_state = 'in_flight' AND answered_at = ?",
        [n.prior.answer, n.prior.answered_at, Or(n.prior.answered_by), n.reply_token, n.claimed_at],
      ) === 1
    if (t) Ar(e, n.reply_token, n.claimed_at)
    return t
  })
}
async function Ui(e, n) {
  return await x(e, "close_question", () => {
    let r = e.sql.all(
      ["cursor", "binding_id"],
      "SELECT cursor, binding_id FROM outbox WHERE event_kind = 'question' AND session_durable_id = ? AND ui_request_id = ? AND (question_state = 'pending' OR (question_state = 'answered' AND answer_state = 'in_flight'))",
      [n.session_durable_id, n.ui_request_id],
      "cursor",
    )
    for (let o of r)
      (E(
        e,
        "UPDATE outbox SET question_state = 'answered', answer_state = 'delivered', answer = NULL, answered_at = ?, answered_by = NULL WHERE cursor = ? AND (question_state = 'pending' OR (question_state = 'answered' AND answer_state = 'in_flight'))",
        [n.now, Number(o.cursor)],
      ),
        gt(e, String(o.binding_id), Number(o.cursor), n.now))
    return r.length
  })
}
async function Nt(e, n) {
  return await x(e, "confirm_answer", () => {
    let t =
      E(
        e,
        "UPDATE outbox SET question_state = 'answered', answer_state = 'delivered', answer = ?, answered_at = ?, answered_by = ? WHERE reply_token = ? AND (answer_state IS NOT 'delivered' OR answer IS NULL)",
        [n.answer, n.claimed_at, Or(n.answered_by), n.reply_token],
      ) === 1
    if (t) Ar(e, n.reply_token, n.claimed_at)
    return t
  })
}
import { existsSync as wd } from "node:fs"
import { extname as kd } from "node:path"
import { fileURLToPath as Rd } from "node:url"
var xd = new Set(["object", "string", "number", "integer", "boolean", "array", "null"]),
  hd = new Set(["title", "description", "default", "examples"]),
  ji = ["minLength", "maxLength", "minItems", "maxItems"],
  Gi = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"],
  Td = new Set([
    "type",
    "properties",
    "required",
    "additionalProperties",
    "enum",
    "const",
    "pattern",
    "items",
    "anyOf",
    ...ji,
    ...Gi,
    ...hd,
  ]),
  ge = (e) => typeof e === "object" && e !== null && !Array.isArray(e)
function Dn(e, n = "parameters") {
  if (!ge(e)) return `${n} must be a schema object`
  for (let m of Object.keys(e))
    if (!m.startsWith("~") && !Td.has(m)) return `${n} uses ${m}, which the store cannot check`
  let { type: t, properties: r, required: o, additionalProperties: i, items: s, anyOf: u, pattern: a } = e,
    d = Array.isArray(t) ? t : t === void 0 ? [] : [t]
  if ((Array.isArray(t) && t.length === 0) || !d.every((m) => typeof m === "string" && xd.has(m)))
    return `${n}.type must name JSON types`
  if (r !== void 0) {
    if (!ge(r)) return `${n}.properties must be an object`
    for (let [m, l] of Object.entries(r)) {
      let c = Dn(l, `${n}.properties.${m}`)
      if (c !== void 0) return c
    }
  }
  if (o !== void 0 && (!Array.isArray(o) || !o.every((m) => typeof m === "string")))
    return `${n}.required must list property names`
  if (i !== void 0 && typeof i !== "boolean") return `${n}.additionalProperties must be true or false`
  if (e.enum !== void 0 && (!Array.isArray(e.enum) || e.enum.length === 0)) return `${n}.enum must be a non-empty array`
  if (a !== void 0 && typeof a !== "string") return `${n}.pattern must be a string`
  for (let m of ji) {
    let l = e[m]
    if (l !== void 0 && (typeof l !== "number" || !Number.isInteger(l) || l < 0))
      return `${n}.${m} must be a non-negative integer`
  }
  for (let m of Gi) {
    let l = e[m]
    if (l !== void 0 && (typeof l !== "number" || !Number.isFinite(l))) return `${n}.${m} must be a finite number`
  }
  if (s !== void 0) {
    let m = Dn(s, `${n}.items`)
    if (m !== void 0) return m
  }
  if (u !== void 0) {
    if (!Array.isArray(u) || u.length === 0) return `${n}.anyOf must be a non-empty array`
    for (let [m, l] of u.entries()) {
      let c = Dn(l, `${n}.anyOf.${m}`)
      if (c !== void 0) return c
    }
  }
  return
}
function Id(e, n) {
  switch (e) {
    case "object":
      return ge(n)
    case "array":
      return Array.isArray(n)
    case "string":
      return typeof n === "string"
    case "boolean":
      return typeof n === "boolean"
    case "null":
      return n === null
    case "number":
      return typeof n === "number" && Number.isFinite(n)
    case "integer":
      return Number.isInteger(n)
    default:
      return !1
  }
}
function At(e, n) {
  if (Object.is(e, n)) return !0
  if (Array.isArray(e) && Array.isArray(n)) return e.length === n.length && e.every((r, o) => At(r, n[o]))
  if (!ge(e) || !ge(n)) return !1
  let t = Object.keys(e)
  return t.length === Object.keys(n).length && t.every((r) => Object.hasOwn(n, r) && At(e[r], n[r]))
}
var qi = (e, n) => `${e}/${String(n).replaceAll("~", "~0").replaceAll("/", "~1")}`
function Un(e, n, t = "") {
  let r = (i) => ({ path: t, message: i }),
    { type: o } = e
  if (o !== void 0) {
    let i = Array.isArray(o) ? o : [o]
    if (!i.some((s) => Id(s, n))) return r(`must be ${i.join(" or ")}`)
  }
  if (e.const !== void 0 && !At(e.const, n)) return r(`must be ${JSON.stringify(e.const)}`)
  if (Array.isArray(e.enum) && !e.enum.some((i) => At(i, n))) return r("must be one of the allowed values")
  if (typeof n === "string") {
    let i = [...n].length
    if (typeof e.minLength === "number" && i < e.minLength) return r(`must have at least ${e.minLength} characters`)
    if (typeof e.maxLength === "number" && i > e.maxLength) return r(`must have at most ${e.maxLength} characters`)
    if (typeof e.pattern === "string" && !new RegExp(e.pattern, "u").test(n))
      return r(`must match pattern ${e.pattern}`)
  }
  if (typeof n === "number") {
    if (typeof e.minimum === "number" && n < e.minimum) return r(`must be >= ${e.minimum}`)
    if (typeof e.maximum === "number" && n > e.maximum) return r(`must be <= ${e.maximum}`)
    if (typeof e.exclusiveMinimum === "number" && n <= e.exclusiveMinimum) return r(`must be > ${e.exclusiveMinimum}`)
    if (typeof e.exclusiveMaximum === "number" && n >= e.exclusiveMaximum) return r(`must be < ${e.exclusiveMaximum}`)
  }
  if (Array.isArray(n)) {
    if (typeof e.minItems === "number" && n.length < e.minItems) return r(`must have at least ${e.minItems} items`)
    if (typeof e.maxItems === "number" && n.length > e.maxItems) return r(`must have at most ${e.maxItems} items`)
    if (ge(e.items))
      for (let [i, s] of n.entries()) {
        let u = Un(e.items, s, qi(t, i))
        if (u !== void 0) return u
      }
  }
  if (ge(n)) {
    let i = ge(e.properties) ? e.properties : {}
    for (let s of Array.isArray(e.required) ? e.required : [])
      if (!Object.hasOwn(n, s)) return r(`must have property ${s}`)
    for (let [s, u] of Object.entries(n)) {
      let a = Object.hasOwn(i, s) ? i[s] : void 0
      if (ge(a)) {
        let d = Un(a, u, qi(t, s))
        if (d !== void 0) return d
      } else if (e.additionalProperties === !1) return r(`must not have property ${s}`)
    }
  }
  if (Array.isArray(e.anyOf) && !e.anyOf.some((i) => ge(i) && Un(i, n, t) === void 0))
    return r("must match one of the allowed shapes")
  return
}
var Lt = ["caller_session_durable_id", "caller_created_target"],
  Lr = /^tor_[a-f0-9]{32}$/,
  Ki = 120000,
  Wi = /^[a-z][a-z0-9_]{1,40}$/,
  Bi = 64,
  Hi = /^[a-z0-9][a-z0-9_-]*$/,
  zi = /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
  Fn = (e) => typeof e === "object" && e !== null && !Array.isArray(e),
  qn = (e) => typeof e === "string" && e.length > 0
function Ct(e, n) {
  return `ext_${e}_${n}`
}
function Te(e) {
  return e.internal !== !0
}
function Sd(e, n) {
  if (e.internal !== !0) return `${n}: internal must be true when present`
  for (let t of ["toolName", "await", "wake"])
    if (e[t] !== void 0) return `${n}: an internal op registers no tool, so it cannot declare ${t}`
  if (e.description !== void 0 && !qn(e.description)) return `${n}: description must be a non-empty string when present`
  return
}
function vd(e, n, t) {
  if (!Fn(e)) return "a sessionCallable entry must be an object"
  let { op: r, toolName: o, description: i, parameters: s, targetArg: u, wake: a } = e,
    d = e.await
  if (!qn(r)) return "op must be a non-empty string"
  let m = e.internal !== void 0
  if (m) {
    let f = Sd(e, r)
    if (f !== void 0) return f
  } else {
    if (typeof o !== "string" || !Wi.test(o)) return `toolName ${String(o)} must match ${Wi.source}`
    if (Ct(n, o).length > Bi) return `${Ct(n, o)} is longer than ${Bi} characters`
    if (!qn(i)) return `${o}: description must be a non-empty string`
  }
  let l = m ? r : String(o)
  if (!Fn(s) || s.type !== "object" || s.additionalProperties !== !1)
    return `${l}: parameters must be an object schema with additionalProperties: false`
  let c = s.properties ?? {}
  if (!Fn(c)) return `${l}: parameters.properties must be an object`
  if (Lt.some((f) => Object.hasOwn(c, f)))
    return `${l}: parameters must not declare ${Lt.join(" or ")}; the store stamps them`
  let g = Dn(s)
  if (g !== void 0) return `${l}: ${g}`
  if (u !== void 0 && (typeof u !== "string" || !Object.hasOwn(c, u)))
    return `${l}: targetArg ${String(u)} must name a field of parameters.properties`
  if (d !== void 0) {
    if (!Fn(d) || !qn(d.statusOp) || !qn(d.expireOp)) return `${l}: await needs statusOp and expireOp`
    let f = d.timeoutMs
    if (typeof f !== "number" || !Number.isInteger(f) || f < 1 || f > Ki)
      return `${l}: await.timeoutMs must be an integer from 1 to ${Ki}`
    if (t === void 0) return `${l}: await needs the registration's wakeDir`
  }
  if (a !== void 0 && (typeof a !== "string" || !zi.test(a)))
    return `${l}: wake must be a plain file name matching ${zi.source}`
  if (a !== void 0 && t === void 0) return `${l}: wake needs the registration's wakeDir`
  return
}
function Pt(e, n) {
  let { name: t, sessionCallable: r, wakeDir: o } = e
  if (o !== void 0 && (typeof o !== "string" || !Hi.test(o)))
    return `wakeDir must be one path segment matching ${Hi.source}`
  if (r === void 0) return
  if (!Array.isArray(r)) return "sessionCallable must be an array"
  let i = new Set(),
    s = new Set()
  for (let u of r) {
    let a = vd(u, t, o)
    if (a !== void 0) return a
    let d = u
    if (Te(d)) {
      if (i.has(d.toolName)) return `toolName ${d.toolName} is declared twice`
      i.add(d.toolName)
    }
    if (s.has(d.op)) return `op ${d.op} is declared twice`
    if ((s.add(d.op), n === void 0)) continue
    let m = Te(d) ? d.await : void 0
    for (let l of [d.op, ...(m === void 0 ? [] : [m.statusOp, m.expireOp])])
      if (!Object.hasOwn(n, l) || typeof n[l] !== "function")
        return `${Te(d) ? d.toolName : d.op}: the module exports no operation ${l}`
  }
  return
}
function Cr(e) {
  let n = new Set()
  for (let t of e?.sessionCallable ?? [])
    if ((n.add(t.op), Te(t) && t.await !== void 0)) for (let r of [t.await.statusOp, t.await.expireOp]) n.add(r)
  return n
}
function Xi(e, n) {
  try {
    let t = JSON.parse(String(n))
    if (!Fn(t) || typeof t.moduleUrl !== "string" || !Array.isArray(t.migrations)) return
    let r = t
    return Pt({ ...r, name: e }) === void 0 ? r : void 0
  } catch {
    return
  }
}
function Pr(e, n) {
  let t = e.sql.one(["descriptor_json"], "SELECT descriptor_json FROM extension_registrations WHERE name = ?", [n])
  return t === void 0 ? void 0 : Xi(n, t.descriptor_json)
}
function Mr(e) {
  return e.sql
    .all(["name", "descriptor_json"], "SELECT name, descriptor_json FROM extension_registrations", [], "name")
    .flatMap((t) => {
      let r = String(t.name)
      return (Xi(r, t.descriptor_json)?.sessionCallable ?? [])
        .filter(Te)
        .map((o) => ({ ...o, extension: r, registeredName: Ct(r, o.toolName) }))
    })
}
function Dr(e, n) {
  let t = new Set((n.sessionCallable ?? []).filter(Te).map((o) => Ct(n.name, o.toolName))),
    r = Mr(e).find((o) => o.extension !== n.name && t.has(o.registeredName))
  return r === void 0 ? void 0 : `tool ${r.registeredName} is already declared by extension ${r.extension}`
}
function Vi(e, n, t, r) {
  let o = Dr(e, n)
  if (o !== void 0) return o
  let i = {
      moduleUrl: n.moduleUrl,
      migrations: n.migrations,
      ...(n.sessionCallable === void 0 ? {} : { sessionCallable: n.sessionCallable }),
      ...(n.wakeDir === void 0 ? {} : { wakeDir: n.wakeDir }),
    },
    s = r === void 0 ? "" : " WHERE excluded.updated_at >= extension_registrations.updated_at"
  e.sql.run(
    `INSERT INTO extension_registrations (name, descriptor_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET descriptor_json = excluded.descriptor_json, updated_at = excluded.updated_at${s}`,
    [n.name, JSON.stringify(i), r ?? t],
  )
  return
}
async function Ur(e) {
  let n = new URL(e)
  if (n.protocol !== "file:" || ![".js", ".mjs", ".cjs"].includes(kd(n.pathname)))
    throw Error("moduleUrl must name a compiled JavaScript file URL.")
  if (!wd(Rd(n))) throw Error(`The extension module ${e} does not exist.`)
  return await import(e)
}
var L = {
  SQLITE_OK: 0,
  SQLITE_DENY: 1,
  SQLITE_CREATE_INDEX: 1,
  SQLITE_CREATE_TABLE: 2,
  SQLITE_CREATE_TRIGGER: 7,
  SQLITE_CREATE_VIEW: 8,
  SQLITE_DELETE: 9,
  SQLITE_DROP_INDEX: 10,
  SQLITE_DROP_TABLE: 11,
  SQLITE_INSERT: 18,
  SQLITE_READ: 20,
  SQLITE_SELECT: 21,
  SQLITE_UPDATE: 23,
  SQLITE_ALTER_TABLE: 26,
  SQLITE_REINDEX: 27,
  SQLITE_FUNCTION: 31,
  SQLITE_RECURSIVE: 33,
}
class H extends Error {
  code = "extension_schema_violation"
}
var Od = ["type", "name", "tbl_name", "sql"],
  q = (e) => e.replace(/[A-Z]/g, (n) => n.toLowerCase()),
  Fr = (e) => `${String(e.type)}:${q(String(e.name))}`
function ae(e) {
  return {
    objects: e.all(Od, "SELECT type, name, tbl_name, sql FROM sqlite_schema", [], "type, name"),
    owners: new Map(
      e
        .all(["type", "name", "owner"], "SELECT type, name, owner FROM extension_objects")
        .map((n) => [Fr(n), n.owner === null ? null : String(n.owner)]),
    ),
  }
}
function qr(e, n) {
  let t = e.all(["name"], "SELECT name FROM extension_objects WHERE owner IS NULL")
  if (["gateway", "thread", "sqlite"].includes(n) || t.some((r) => q(String(r.name)).startsWith(n)))
    throw new H(`Extension name ${n} collides with a core namespace.`)
}
function mn(e, n, t, r) {
  let o = new Map(t.objects.map((u) => [Fr(u), u])),
    i = new Map(r.objects.map((u) => [Fr(u), u])),
    s = [...new Set([...o.keys(), ...i.keys()])].filter((u) => JSON.stringify(o.get(u)) !== JSON.stringify(i.get(u)))
  for (let u of s) {
    let a = o.get(u),
      d = i.get(u)
    if (a !== void 0 && t.owners.get(u) !== n)
      throw new H(`Extension ${n} changed an object it does not own: ${String(a.name)}.`)
    if (d === void 0) continue
    if (d.type === "trigger" || d.type === "view") throw new H("Store extensions cannot create triggers or views.")
    let m = q(String(d.name))
    if (
      (!(d.type === "index" && d.sql === null && m.startsWith(`sqlite_autoindex_${q(String(d.tbl_name))}_`)) &&
        !m.startsWith(`${n}_`)) ||
      (t.owners.has(u) && t.owners.get(u) !== n)
    )
      throw new H(`Extension ${n} created an object outside its namespace: ${String(d.name)}.`)
    if (d.type === "index") {
      let c = `table:${q(String(d.tbl_name))}`,
        g = !o.has(c) && i.has(c) && s.includes(c)
      if (t.owners.get(c) !== n && r.owners.get(c) !== n && !g)
        throw new H(`Extension ${n} indexed a table it does not own: ${String(d.tbl_name)}.`)
    }
  }
  for (let u of s) {
    let a = o.get(u),
      d = i.get(u)
    if (a !== void 0)
      e.run("DELETE FROM extension_objects WHERE type = ? AND name = ? COLLATE NOCASE AND owner = ?", [
        String(a.type),
        String(a.name),
        n,
      ])
    if (d !== void 0)
      e.run(
        "INSERT INTO extension_objects (type, name, owner) VALUES (?, ?, ?) ON CONFLICT(type, name) DO UPDATE SET owner = excluded.owner",
        [String(d.type), q(String(d.name)), n],
      )
  }
}
function Mt(e, n, t) {
  let r = ae(e),
    o = new Map(r.owners),
    i = new Set(r.objects.filter((g) => g.type === "trigger" || g.type === "view").map((g) => q(String(g.name)))),
    s = (g, f) => f !== null && o.get(`${g}:${f}`) === n,
    u = (g, f, b = !1) => {
      if (f === null || (!b && !f.startsWith(`${n}_`)) || o.has(`${g}:${f}`)) return !1
      return (o.set(`${g}:${f}`, n), !0)
    },
    a,
    d = !1,
    m,
    l = L.SQLITE_OK,
    c = (g) => ((m = `Extension ${n} does not own ${g ?? "this SQLite operation"}.`), L.SQLITE_DENY)
  try {
    return e.authorized((g, f, b, T, N) => {
      let h = f === null ? null : q(f),
        p = b === null ? null : q(b),
        I = T === null ? null : q(T),
        D = N === null ? null : q(N)
      if (D !== null && i.has(D)) return c(D)
      switch (g) {
        case L.SQLITE_CREATE_TABLE:
          return ((a = "create"), I === "main" && u("table", h) ? l : c(h))
        case L.SQLITE_CREATE_INDEX:
          return (
            (a = "create"),
            I === "main" && s("table", p) && u("index", h, h?.startsWith(`sqlite_autoindex_${p}_`) === !0) ? l : c(h)
          )
        case L.SQLITE_DROP_TABLE:
          return ((a = "drop"), I === "main" && s("table", h) ? l : c(h))
        case L.SQLITE_DROP_INDEX:
          return ((a = "drop"), I === "main" && s("index", h) && s("table", p) ? l : c(h))
        case L.SQLITE_ALTER_TABLE:
          return ((a = "alter"), h === "main" && s("table", p) ? l : c(p))
        case L.SQLITE_REINDEX:
          return I === "main" && s("index", h) ? l : c(h)
        case L.SQLITE_READ:
        case L.SQLITE_INSERT:
        case L.SQLITE_UPDATE:
        case L.SQLITE_DELETE:
          if (h === "sqlite_master" || h === "sqlite_temp_master") {
            if (g === L.SQLITE_UPDATE && p === "sql") d = !0
            if (g !== L.SQLITE_READ) return l
            return a === "alter" || a === "drop" || (a === "create" && d && p === "rowid") ? l : c(h)
          }
          if (
            a === "alter" &&
            h === "sqlite_sequence" &&
            p === "name" &&
            (g === L.SQLITE_READ || g === L.SQLITE_UPDATE)
          )
            return l
          return (I === "main" || (I === null && g === L.SQLITE_READ && p === "")) && s("table", h) ? l : c(h)
        case L.SQLITE_SELECT:
        case L.SQLITE_RECURSIVE:
          return l
        case L.SQLITE_FUNCTION:
          return p === "load_extension" ? c(p) : l
        case L.SQLITE_CREATE_TRIGGER:
        case L.SQLITE_CREATE_VIEW:
          return c(h)
        default:
          return c(h)
      }
    }, t)
  } catch (g) {
    if (m !== void 0) throw new H(m)
    throw g
  }
}
import { createHash as Gm, randomUUID as Km } from "node:crypto"
var Le = { assign: 0, create: 0, clone: 0, discard: 0, update: 0 }
function Yi(e) {
  return Array.isArray(e)
}
function Qi(e) {
  return A(typeof e, "bigint")
}
function Ad(e) {
  return A(typeof e, "boolean")
}
function Ji(e) {
  return A(e, null)
}
function Zi(e) {
  return Number.isFinite(e)
}
function ea(e) {
  return A(typeof e, "object") && !Ji(e)
}
function jr(e) {
  return A(typeof e, "string")
}
function A(e, n) {
  return e === n
}
function Ld(e) {
  if (!ea(e)) return !1
  let n = globalThis.Object.getPrototypeOf(e)
  if (Ji(n)) return !1
  return (
    A(typeof n.constructor, "function") && !(A(n.constructor, globalThis.Object) || A(n.constructor.name, "Object"))
  )
}
function Gr(e) {
  return A(e, "__proto__") || A(e, "constructor") || A(e, "prototype")
}
function na(e, n) {
  return Gr(n) ? Object.prototype.hasOwnProperty.call(e, n) : n in e
}
function ta(e) {
  return Object.getOwnPropertyNames(e)
}
function Cd(e) {
  return Object.getOwnPropertySymbols(e)
}
function Md(e) {
  return globalThis.ArrayBuffer.isView(e)
}
function Dd(e) {
  return e instanceof globalThis.RegExp
}
function Ud(e) {
  return e instanceof globalThis.Set
}
function Fd(e) {
  return e instanceof globalThis.Map
}
var jd = {
  immutableTypes: !1,
  maxErrors: 8,
  maxParseErrors: 1,
  maxInstantiationCount: 128,
  useAcceleration: !0,
  exactOptionalPropertyTypes: !1,
  enumerableKind: !1,
  correctiveParse: !1,
  unionPrioritySort: !0,
}
function Wr() {
  return jd
}
function pn(e) {
  return Wr().immutableTypes ? Object.freeze(e) : e
}
function Gd(e) {
  return e
}
function Kd(e) {
  return na(e, "~kind") || na(e, "~unsafe")
}
function Wd(e) {
  let n = {}
  for (let t of ta(e)) {
    if (Gr(t)) continue
    let r = Object.getOwnPropertyDescriptor(e, t)
    if (((r.value = Ge(r.value)), A(r.enumerable, !0))) n[t] = r.value
    else Object.defineProperty(n, t, r)
  }
  return n
}
function Bd(e) {
  let n = {}
  for (let t of ta(e)) {
    if (Gr(t)) continue
    n[t] = Ge(e[t])
  }
  for (let t of Cd(e)) n[t] = Ge(e[t])
  return n
}
function Hd(e) {
  return Ld(e) ? Gd(e) : Kd(e) ? Wd(e) : Bd(e)
}
function zd(e) {
  return e.map((n) => Ge(n))
}
function Xd(e) {
  return e.slice()
}
function Vd(e) {
  return new RegExp(e.source, e.flags)
}
function Yd(e) {
  return new Map(Ge([...e.entries()]))
}
function Qd(e) {
  return new Set(Ge([...e.values()]))
}
function Ge(e) {
  return Md(e) ? Xd(e) : Dd(e) ? Vd(e) : Fd(e) ? Yd(e) : Ud(e) ? Qd(e) : Yi(e) ? zd(e) : ea(e) ? Hd(e) : e
}
function Br(e) {
  return ((Le.clone += 1), Ge(e))
}
function Jd(e, n) {
  for (let t of Object.keys(n))
    Object.defineProperty(e, t, { configurable: !0, writable: !0, enumerable: !1, value: n[t] })
  return e
}
function ra(e, n) {
  return { ...e, ...n }
}
function Dt(e, n, t = {}) {
  Le.create += 1
  let r = ra(n, t),
    o = Wr().enumerableKind ? ra(r, e) : Jd(r, e)
  return pn(o)
}
function oa(e, n, t) {
  Le.update += 1
  let r = Wr(),
    o = Br(e)
  for (let i of Object.keys(n))
    Object.defineProperty(o, i, { configurable: !0, writable: !0, enumerable: r.enumerableKind, value: n[i] })
  for (let i of Object.keys(t))
    Object.defineProperty(o, i, { configurable: !0, enumerable: !0, writable: !0, value: t[i] })
  return pn(o)
}
function Zd(e) {
  return oa(e, { "~optional": !0 }, {})
}
function Hr(e, n) {
  return oa(Zd(e), {}, n)
}
function Ut(e, n = {}) {
  return Hr(e, n)
}
function jn(e) {
  return Ut(e)
}
var ia
;(function (e) {
  ;((e[(e.Array = 0)] = "Array"),
    (e[(e.BigInt = 1)] = "BigInt"),
    (e[(e.Boolean = 2)] = "Boolean"),
    (e[(e.Date = 3)] = "Date"),
    (e[(e.Constructor = 4)] = "Constructor"),
    (e[(e.Function = 5)] = "Function"),
    (e[(e.Null = 6)] = "Null"),
    (e[(e.Number = 7)] = "Number"),
    (e[(e.Object = 8)] = "Object"),
    (e[(e.RegExp = 9)] = "RegExp"),
    (e[(e.String = 10)] = "String"),
    (e[(e.Symbol = 11)] = "Symbol"),
    (e[(e.TypeArray = 12)] = "TypeArray"),
    (e[(e.Undefined = 13)] = "Undefined"))
})(ia || (ia = {}))
var vy = BigInt("14695981039346656037"),
  [Oy, $y] = [BigInt("1099511628211"), BigInt("18446744073709551616")],
  Ny = Array.from({ length: 256 }).map((e, n) => BigInt(n)),
  aa = new Float64Array(1),
  Ay = new DataView(aa.buffer),
  Ly = new Uint8Array(aa.buffer)
function zr(e) {
  return Dt({ "~kind": "Boolean" }, { type: "boolean" }, e)
}
var Xr = "-?(?:0|[1-9][0-9]*)"
class ma extends Error {
  constructor(e) {
    super("Invalid Literal value")
    Object.defineProperty(this, "cause", { value: { value: e }, writable: !1, configurable: !1, enumerable: !1 })
  }
}
function ou(e) {
  return Qi(e)
    ? "bigint"
    : Ad(e)
      ? "boolean"
      : Zi(e)
        ? "number"
        : jr(e)
          ? "string"
          : (() => {
              throw new ma(e)
            })()
}
function j(e, n) {
  return Dt({ "~kind": "Literal" }, { type: ou(e), const: e }, n)
}
var Vr = "-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?"
var Yr = ".*"
function ne(e) {
  return Dt({ "~kind": "String" }, { type: "string" }, e)
}
function M(e, n = {}) {
  return Dt({ "~kind": "Union" }, { anyOf: e }, n)
}
var Kt = `^${Xr}$`,
  fa = `^${Vr}$`,
  Ft = `^${Yr}$`
function Zr(e, n) {
  return Array.from({ length: n - e + 1 }, (t, r) => String.fromCharCode(e + r))
}
var wa = [...Zr(97, 122), ...Zr(65, 90)],
  ka = "0",
  Ra = Zr(49, 57),
  _n = [ka, ...Ra]
var gn = "_"
var Sa = "$"
var RI = [..._n, gn]
var em = [...wa, gn, Sa]
var nw = [...em, ..._n]
var pw = [..._n, gn]
var GD = new RegExp("^(?:0|[1-9][0-9]*)$")
var oF = new RegExp(Kt)
var Ba = 32768,
  km = 200
var W2 = ne({
    description:
      "Recipient thread: the thread value of a thread_list row (tool.thread_list() in an eval cell) or of any thread tool result, an alias, a unique name, or the first 8+ characters of a thread value when only one thread starts with them. A name or prefix shared by several threads returns ambiguous_target with candidates. self addresses the caller's own session.",
  }),
  B2 = jn(
    zr({
      description:
        "Address threads in every workspace on this machine instead of only the caller's workspace; left unset, an exact id from another workspace returns scope_denied.",
    }),
  ),
  H2 = jn(
    ne({
      description:
        "Caller-chosen key that makes a retried call return the earlier result instead of repeating the side effect; reusing the key with different arguments returns idempotency_conflict.",
    }),
  ),
  z2 = jn(
    ne({
      description:
        "Turn id the steer applies to; required with delivery steer, and a changed active turn returns turn_conflict with the message held undelivered.",
    }),
  ),
  X2 = jn(
    ne({ maxLength: km, description: "One-line preview shown to the caller when the completion notice arrives." }),
  ),
  V2 = ne({
    maxLength: Ba,
    description: `Instruction to deliver to the target thread; longer than ${Ba} UTF-8 bytes returns message_too_large.`,
  })
var Y2 = ne({ minLength: 1, description: "Id of the chat binding the gateway keeps for the thread." }),
  Q2 = ne({
    description: `Text relayed to or from the external thread; longer than ${An} UTF-8 bytes returns message_too_large.`,
  }),
  ro = "auto",
  J2 = M([j("auto"), j("steer"), j("follow_up")], {
    default: ro,
    description:
      "Omitted: auto. auto steers the running turn when one is active and starts a new turn otherwise; steer requires expected_turn_id and becomes turn_conflict when the active turn changed; follow_up queues the message behind the running turn (pass it only when the message must wait for that turn to end).",
  })
function Ha(e, n, t, r) {
  if (e === "offline") return n === "steer" ? { kind: "refuse", reason: "turn_conflict" } : { kind: "queued_offline" }
  if (n === "steer") {
    if (e !== "mid_turn") return { kind: "refuse", reason: "not_steerable" }
    if (t === null || r === null || t !== r) return { kind: "refuse", reason: "turn_conflict" }
    return { kind: "admit", deliverAs: "steer", expected_turn_id: t, expect: "steered" }
  }
  if (n === "auto" && e === "mid_turn" && r !== null)
    return { kind: "admit", deliverAs: "steer", expected_turn_id: r, expect: "steered" }
  return { kind: "admit", deliverAs: "followUp", expect: e === "idle" ? "started" : "queued" }
}
function za(e, n) {
  let t = e.kind === "session" ? e.name?.trim() : void 0,
    r = { ...n, ...(t ? { session: t } : {}) }
  if (e.kind === "session")
    return {
      provenance: r,
      principal: `session:${e.durable_id}`,
      rate_principal: `session:${e.durable_id}`,
      node: e.durable_id,
      turn: e.turn_id ?? null,
      cause: e.cause_delivery_id ?? null,
      actor: e.name ?? e.durable_id,
      origin: () => ({ session: e.durable_id }),
      binding: null,
    }
  if (e.kind === "person") {
    let s = `person:${e.uid}`
    return {
      provenance: r,
      principal: s,
      rate_principal: s,
      node: s,
      turn: null,
      cause: null,
      actor: e.user,
      origin: (u) => ({
        external: { platform: "cli", account_id: e.user, chat_id: "@person", thread_id: "@chat", message_id: u },
      }),
      binding: null,
    }
  }
  if (e.kind === "cli") {
    let s = `cli:${e.uid}`
    return {
      provenance: r,
      principal: s,
      rate_principal: s,
      node: s,
      turn: null,
      cause: null,
      actor: e.user,
      origin: (u) => ({
        external: { platform: "cli", account_id: e.user, chat_id: "@cli", thread_id: "@chat", message_id: u },
      }),
      binding: null,
    }
  }
  let o = `binding:${e.binding_id}`,
    i = e.origin.author
  return {
    provenance: r,
    principal: o,
    rate_principal: i === void 0 ? o : `${o}#author:${i.platform_user_id}`,
    node: o,
    turn: null,
    cause: null,
    actor: e.origin.account_id,
    origin: () => ({ external: e.origin }),
    binding: { binding_id: e.binding_id, revision: e.binding_revision },
  }
}
import { execFile as Rm } from "node:child_process"
import { existsSync as Xa, readFileSync as Sm, statSync as vm } from "node:fs"
import { homedir as Om } from "node:os"
import {
  basename as $m,
  delimiter as Nm,
  dirname as oo,
  isAbsolute as io,
  join as Am,
  relative as Lm,
  resolve as Ve,
  sep as Cm,
} from "node:path"
var Va = 1000,
  Pm = (e, n) =>
    new Promise((t) => {
      Rm(
        "git",
        [...e],
        { cwd: n.cwd, env: n.env, encoding: "utf8", windowsHide: !0, timeout: n.timeoutMs },
        (r, o, i) => {
          if (r === null) return t({ ok: !0, stdout: o })
          t({ ok: !1, code: r.code ?? null, killed: r.killed === !0, stderr: i, message: r.message })
        },
      )
    })
function Mm(e, n) {
  let t = Am(e, ".git")
  if (!Xa(t)) return !1
  if (vm(t).isDirectory()) return !0
  let r = /^gitdir:\s*(.+?)\s*$/m.exec(n(t))?.[1]
  return r !== void 0 && Xa(Ve(e, r))
}
function Dm(e, n, t, r) {
  if (n.GIT_DIR) return !0
  let o = new Set(
    (n.GIT_CEILING_DIRECTORIES ?? "")
      .split(Nm)
      .filter((i) => io(i))
      .map((i) => Ve(i)),
  )
  try {
    for (let i = Ve(e); ; i = oo(i)) {
      if (Mm(i, r)) return !0
      if (oo(i) === i || o.has(oo(i))) return !1
    }
  } catch (i) {
    return (
      t(
        `finding the sender's repository failed, so git does not classify this send: ${i instanceof Error ? i.message : String(i)}`,
      ),
      !1
    )
  }
}
async function Um(e, n, t, r) {
  if (!Dm(e, n, t, r.readGitFile ?? ((i) => Sm(i, "utf8")))) return
  let o = await (r.execGit ?? Pm)(["remote", "get-url", "origin"], { cwd: e, env: n, timeoutMs: Va })
  if (o.ok) return o.stdout.trim()
  if (o.code === "ENOENT") t("git is not installed for the sender, so git does not classify this send")
  else if (o.killed)
    t(`reading the sender's git origin failed, so git does not classify this send: git did not answer within ${Va} ms`)
  else if (o.code !== 2)
    t(`reading the sender's git origin failed, so git does not classify this send: ${o.stderr.trim() || o.message}`)
  return
}
function Fm(e) {
  if (e === void 0) return
  let n = /^[a-z][a-z0-9+.-]*:\/\//i.test(e) ? URL.parse(e) : null,
    t = n !== null || /^[a-z]:[\\/]/i.test(e) ? void 0 : /^(?:[^/@:]+@)?[^/:]+:(.+)$/.exec(e)?.[1],
    o = (n?.pathname ?? t ?? e).replace(/\\/g, "/").replace(/\/+$/, "").split("/").filter(Boolean),
    i = o?.at(-1)?.replace(/\.git$/, ""),
    s = (n !== null && n.protocol !== "file:") || t !== void 0 ? o.slice(0, -1) : []
  return i ? { owners: s, project: i } : void 0
}
function qm(e, n, t) {
  let r = n === "~" ? t : n.startsWith("~/") ? Ve(t, n.slice(2)) : n
  if (!io(r)) return !1
  let o = Lm(Ve(r), Ve(e))
  return o === "" || (!io(o) && o !== ".." && !o.startsWith(`..${Cm}`))
}
function jm(e, n, t) {
  try {
    return e.loadWorkspaces?.(e.cwd, n) ?? []
  } catch (r) {
    return (
      t(
        `reading provenance.workspaces failed, so the table does not classify this send: ${r instanceof Error ? r.message : String(r)}`,
      ),
      []
    )
  }
}
async function Ya(e) {
  let n = e.env ?? process.env,
    t = n.OMO_PROVENANCE_WORKSPACE?.trim(),
    r = n.OMO_PROVENANCE_PROJECT?.trim(),
    o = n.OMO_PROVENANCE_LANE?.trim(),
    i = o ? { lane: o } : {}
  if (t && r) return { workspace: t, project: r, ...i }
  let s = e.onWarning ?? (() => {}),
    u = Fm(await (e.gitRemote ?? ((f) => Um(f, n, s, e)))(e.cwd)),
    a = r || u?.project || $m(Ve(e.cwd)) || "root"
  if (t) return { workspace: t, project: a, ...i }
  let d = e.workspaces ?? jm(e, n, s),
    m = new Set(u?.owners.map((f) => f.toLowerCase()) ?? []),
    l = m.size === 0 ? void 0 : d.find((f) => f.git_owners?.some((b) => m.has(b.toLowerCase()))),
    c = n.HOME ?? n.USERPROFILE ?? Om()
  return {
    workspace: (l ?? d.find((f) => f.paths?.some((b) => qm(e.cwd, b, c))))?.name ?? "unclassified",
    project: a,
    ...i,
  }
}
var Wm = {
  loop_detected: "A session cannot message itself through the gateway; address another thread.",
  overloaded: "Wait before sending to this session again.",
  queue_full: "Wait for the target to take its queued messages, then send again.",
  idempotency_conflict: "Retry with a new idempotency_key.",
  idempotency_in_progress: "Wait for the earlier call to settle, then retry.",
  idempotency_uncertain: "Read the target transcript before deciding whether to send again; the gateway never resends.",
  invalid_arguments: "Fix the arguments and send again.",
}
function Vn(e, n, t) {
  return {
    kind: "error",
    error: $e(
      e,
      n,
      Wm[e] ?? "Call thread_list (tool.thread_list() in an eval cell) and retry after checking the target.",
      t,
    ),
  }
}
function Bm(e) {
  return Gm("sha256").update(JSON.stringify(e)).digest("hex")
}
function ao(e) {
  return Bm({
    target: e.target,
    text: e.text,
    mode: e.mode,
    expected_turn_id: e.expected_turn_id,
    binding: e.binding,
    author: e.author,
  })
}
function Qa(e) {
  let n = e.store,
    t = e.now ?? n.now
  async function r(o) {
    let i = o.mode ?? ro
    if (i === "steer" && o.expected_turn_id === void 0)
      return Vn("invalid_arguments", "A steer needs expected_turn_id (the target's current turn_epoch).")
    let s = Buffer.byteLength(o.text)
    if (s > nn) return Vn("message_too_large", `The message is ${s} bytes, above the ${nn}-byte limit.`)
    let u = await e.resolve(o.target, { all_scope: o.all_scope })
    if (u.kind === "error") return u
    let a = u.target,
      d = a.liveness === "routable" ? a.endpoint : null
    if (d === null && Ha("offline", i, o.expected_turn_id ?? null, null).kind === "refuse")
      return Vn("turn_conflict", "The target has no live turn to steer.", { thread: a.durable_id })
    let m = za(o.sender, await (e.senderProvenance?.() ?? Ya({ cwd: process.cwd() }))),
      l = Km(),
      c = o.idempotency_key ?? `auto:${l}`,
      g = await n.enqueue({
        provenance: m.provenance,
        now: t(),
        delivery_id: l,
        target_durable_id: a.durable_id,
        sender_principal: m.principal,
        rate_principal: m.rate_principal,
        sender_node: m.node,
        sender_turn: m.turn,
        cause_delivery_id: m.cause,
        ...(o.inbound_hop === void 0 ? {} : { inbound_hop: o.inbound_hop }),
        ...(o.authority === void 0 ? {} : { authority: o.authority }),
        claimed_root_id: o.root_id ?? null,
        origin: m.origin(l),
        actor: m.actor,
        body: o.text,
        mode: i,
        expected_turn_id: o.expected_turn_id ?? null,
        binding: m.binding,
        receipt: {
          idempotency_key: c,
          args_hash: ao({
            target: a.durable_id,
            text: o.text,
            mode: i,
            expected_turn_id: o.expected_turn_id ?? null,
            binding: m.binding,
            author: o.sender.kind === "external" ? o.sender.origin.author : void 0,
          }),
        },
        endpoint_kind: d?.kind ?? null,
      })
    if (g.kind === "busy")
      return Vn("overloaded", "The gateway store is locked by a suspended writer; nothing was sent.", {
        budget: "store_lock",
      })
    if (g.kind === "refused") return Vn(g.code, g.message, g.details)
    if (g.kind === "replay") {
      let b = g.result
      return b.kind === "ok" ? { ...b, deduplicated: !0 } : b
    }
    let f = async (b) => (
      await n.completeReceipt({ now: t(), principal: m.principal, idempotency_key: c, result: b }),
      b
    )
    try {
      if (d === null) return await f(Cn(g.row, g.queue_position, null, !1, !0))
      let b
      try {
        b = await e.endpoints.wake(d, [l])
      } catch {
        b = void 0
      }
      let T = await n.deliveryView(l)
      if (T === null) throw Error(`delivery ${l} vanished after commit`)
      let N = b !== void 0 && b.unroutable === void 0 && (T.row.state !== "queued" || (b.admitted ?? []).length > 0)
      return await f(Cn(T.row, T.queue_position, d.kind, !1, !N))
    } catch (b) {
      throw (
        await n
          .abandonReceipt({
            now: t(),
            principal: m.principal,
            idempotency_key: c,
            error_note: b instanceof Error ? b.message : String(b),
          })
          .catch(() => !1),
        b
      )
    }
  }
  return { deliver: r }
}
function bn(e) {
  let n = !1
  for (let t of ot(e)) {
    if (t.kind === "space" || t.kind === "comment") continue
    if (n) throw new H("An extension SQL call must contain one statement.")
    if (t.kind === "semicolon") n = !0
  }
}
var Hm =
    /^[ \t\r\n]*([A-Za-z_][A-Za-z0-9_]*)(?:[ \t\r\n]+COLLATE[ \t\r\n]+(BINARY|NOCASE|RTRIM))?(?:[ \t\r\n]+(ASC|DESC))?(?:[ \t\r\n]+NULLS[ \t\r\n]+(FIRST|LAST))?[ \t\r\n]*$/i,
  Ja = 80,
  uo = (e) => JSON.stringify(e.length > Ja ? `${e.slice(0, Ja)}…` : e),
  so = (e) => e?.toUpperCase()
function Za(e) {
  return e.split(",").map((n) => {
    let t = Hm.exec(n)
    if (t === null)
      throw new H(
        `orderBy must list the statement's output columns, each optionally with COLLATE BINARY/NOCASE/RTRIM, ASC/DESC or NULLS FIRST/LAST; got ${uo(e)}. Put LIMIT, OFFSET and table-qualified ordering in the statement itself.`,
      )
    return { column: t[1], collate: so(t[2]), direction: so(t[3]), nulls: so(t[4]) }
  })
}
function es(e, n) {
  return e
    .map((t) => {
      let r = n.find((o) => q(o) === q(t.column))
      if (r === void 0)
        throw new H(
          `orderBy must list the statement's output columns; ${uo(t.column)} is not one of them (${uo(n.join(", "))}). Select it in the statement or order by a column it returns.`,
        )
      return [
        `"${r.replaceAll('"', '""')}"`,
        t.collate && `COLLATE ${t.collate}`,
        t.direction,
        t.nulls && `NULLS ${t.nulls}`,
      ]
        .filter(Boolean)
        .join(" ")
    })
    .join(", ")
}
var zm = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/
function mo(e) {
  return { kind: "refused", code: "invalid_arguments", message: e }
}
function lo(e, n, t) {
  if (typeof n !== "string" || n.trim().length === 0) return mo(`author.${e} must be a non-empty string.`)
  if (n.length > t) return mo(`author.${e} is longer than ${t} characters.`)
  if (zm.test(n)) return mo(`author.${e} carries a control character or line break.`)
  return n.trim()
}
function ns(e) {
  let n = lo("platform_user_id", e.platform_user_id, 256)
  if (typeof n !== "string") return n
  let t = lo("display", e.display, 256)
  if (typeof t !== "string") return t
  if (e.user_id === void 0) return { platform_user_id: n, display: t }
  let r = lo("user_id", e.user_id, 256)
  if (typeof r !== "string") return r
  return { platform_user_id: n, display: t, user_id: r }
}
var po =
    "thread_report (tool.thread_report() in an eval cell) without binding_id uses the chat binding the gateway keeps for this session.",
  Xm = {
    binding_conflict:
      "Find the binding that holds this thread with `omo thread bindings`, then rebind it with its revision, or unbind it first.",
    binding_mismatch: "Answer through the binding that asked the question; the question stays pending.",
    binding_inactive:
      "The chat binding is closed: the gateway binds the chat again when its next message arrives, so report through that binding.",
    stale_revision: "Read the binding's current revision with `omo thread bindings` and retry with it.",
    stale_token:
      "The question was asked under an earlier binding revision or session runtime; wait for the session to ask again.",
    already_answered: "Nothing to do: the question has its answer.",
    answer_in_progress:
      "Retry after a moment: another answer is still being handed to the session, and the question goes back to pending if that fails.",
    idempotency_conflict: "Retry with a new idempotency_key.",
    idempotency_uncertain:
      "Read the binding's outbox with thread_outbox (tool.thread_outbox() in an eval cell) to see whether the earlier call took effect, then retry with a new idempotency_key.",
    scope_denied: `That binding belongs to another session: ${po}`,
    unsupported: "Report only the events the binding subscribes to, through a binding with an outbound direction.",
    not_found: `No binding has that id: ${po}`,
    cursor_invalid: "Read thread_outbox (tool.thread_outbox() in an eval cell) again and ack a cursor it returned.",
    host_unavailable: "Retry when the session is running; the question stays pending.",
    invalid_arguments: "Fix the arguments and call again.",
  },
  Vm = new Set(["question_already_resolved", "unknown_extension_ui_request", "unknown_request"])
function K(e, n, t, r) {
  return { kind: "error", error: $e(e, n, r ?? Xm[e] ?? `Retry; ${po}`, t) }
}
function ve(e, n) {
  if (e.kind === "refused") return K(e.code, e.message, e.details, n?.[e.code])
  return e
}
var ts = { not_found: "List the binding ids that exist with `omo thread bindings`." }
function rs(e) {
  if (e === void 0) return
  let n = ns(e)
  return "kind" in n ? K("invalid_arguments", n.message) : n
}
function os(e) {
  let n = Buffer.byteLength(e)
  return n > An ? K("message_too_large", `The text is ${n} bytes, above the ${An}-byte limit.`) : void 0
}
function nr(e, n, t) {
  return e.idempotency_key === void 0
    ? null
    : { principal: e.principal, operation: n, idempotency_key: e.idempotency_key, args_hash: Wo(t) }
}
function is(e) {
  let n = e.store,
    t = e.now ?? n.now,
    r = new Set(),
    o = !1
  async function i(a) {
    await u(() => n.releaseAnswer(a))
  }
  async function s(a) {
    await u(() => n.confirmAnswer(a))
  }
  async function u(a) {
    try {
      await a()
    } catch (d) {
      if (!Sn(d) || o) throw d
      let m = wo(
        () =>
          a().then(() => {
            r.delete(m)
          }),
        () => n.busyTimeoutMs,
        () => {
          r.delete(m)
        },
      )
      r.add(m)
    }
  }
  return {
    bind: async (a) => {
      let d = Ko(a.binding)
      if ("kind" in d) return ve(d)
      return ve(await n.bind({ now: t(), receipt: nr(a, "thread_bind", d), binding: d }))
    },
    unbind: async (a) => {
      let d = { binding_id: a.binding_id, expected_revision: a.expected_revision }
      return ve(await n.unbind({ now: t(), receipt: nr(a, "thread_unbind", d), ...d }), ts)
    },
    rebind: async (a) => {
      let d = {
        binding_id: a.binding_id,
        expected_revision: a.expected_revision,
        session_durable_id: a.session_durable_id,
      }
      return ve(await n.rebind({ now: t(), receipt: nr(a, "thread_rebind", d), ...d }), ts)
    },
    bindings: async (a) => ve(await n.listBindings({ now: t(), ...a })),
    report: async (a) => {
      let d = os(a.text)
      if (d !== void 0) return d
      let m = {
        session_durable_id: a.session_durable_id,
        binding_id: a.binding_id ?? null,
        origin_delivery_ids: a.origin_delivery_ids ?? [],
        origin_local_input: a.origin_local_input === !0,
        event: a.event,
        text: a.text,
        ui_request_id: a.request_id ?? null,
        ui_request_kind: a.request_kind ?? null,
      }
      return ve(await n.report({ now: t(), receipt: nr(a, "thread_report", m), ...m }))
    },
    outbox: async (a) => ve(await n.readOutbox({ now: t(), ...a })),
    ack: async (a) => ve(await n.ackOutbox({ now: t(), ...a })),
    answer: async (a) => {
      let d = os(a.answer)
      if (d !== void 0) return d
      let m = rs(a.author)
      if (m !== void 0 && "kind" in m) return m
      let l = m ?? null,
        c = await n.claimAnswer({
          now: t(),
          binding_id: a.binding_id,
          reply_token: a.reply_token,
          answer: a.answer,
          answered_by: l,
        })
      if (c.kind !== "ok")
        return ve(c, {
          not_found:
            "The question this token belongs to is gone from the outbox: read thread_outbox (tool.thread_outbox() in an eval cell) for a newer question and answer that one.",
        })
      let g = { reply_token: a.reply_token, claimed_at: c.claimed_at },
        f = e.endpoints.respondUi,
        b = null,
        T = ""
      if (f !== void 0)
        try {
          b = await e.locate(c.session_durable_id)
        } catch (p) {
          T = `: ${p instanceof Error ? p.message : String(p)}`
        }
      if (f === void 0 || b === null)
        return (
          await i(g),
          K(
            f === void 0 ? "unsupported" : "host_unavailable",
            `The session that asked is not reachable to take the answer${T}.`,
            { session: c.session_durable_id },
          )
        )
      let N = yt(c.ui_request_kind, a.answer)
      if (!N.ok)
        return (
          await i(g),
          K("invalid_arguments", N.reason, { session: c.session_durable_id, ui_request_kind: c.ui_request_kind })
        )
      let h
      try {
        h = await f(b, { ui_request_id: c.ui_request_id, fields: N.fields })
      } catch (p) {
        return (
          await i(g),
          K(
            "host_unavailable",
            `The answer could not be handed to the session: ${p instanceof Error ? p.message : String(p)}`,
            { session: c.session_durable_id },
          )
        )
      }
      if (!h.delivered) {
        let p = c.taken_over
        if (p !== null && Vm.has(h.error)) {
          if (h.error === "question_already_resolved")
            return (
              await u(() => n.markPriorDelivered({ ...g, prior: p })),
              K("already_answered", `The session already took an earlier answer to this question (${h.error}).`, {
                session: c.session_durable_id,
                reason: h.error,
              })
            )
          return (
            await u(() => n.markPriorDelivered({ ...g, prior: { answer: null, answered_at: g.claimed_at } })),
            K(
              "already_answered",
              `${Nr} (${h.error}).`,
              { session: c.session_durable_id, reason: h.error },
              "Nothing to do: the session no longer waits for this question.",
            )
          )
        }
        await i(g)
        let I = h.error === "invalid_response" || h.error === "question_incomplete"
        if (h.error === "host_draining")
          return K(
            "stale_token",
            "The session's host is draining and could not take the answer: host_draining",
            { session: c.session_durable_id, reason: h.error },
            "The session's host is handing its sessions over; the question stays pending. Answer it again once the host is back.",
          )
        return K(
          I ? "invalid_arguments" : "stale_token",
          `The session refused the answer: ${h.error}`,
          { session: c.session_durable_id, reason: h.error },
          I
            ? `The session could not read this answer (${h.error}); answer again with text it can take. The question stays pending.`
            : `The session refused the answer (${h.error}): it no longer waits on this question. Read thread_outbox (tool.thread_outbox() in an eval cell) for a newer question and answer that one.`,
        )
      }
      return (
        await s({ ...g, answer: a.answer, answered_by: l }),
        {
          kind: "ok",
          binding_id: a.binding_id,
          cursor: c.cursor,
          session_durable_id: c.session_durable_id,
          answered_by: l,
        }
      )
    },
    inbound: async (a) => {
      if (a.mode !== void 0 && !$n.includes(a.mode))
        return K(
          "invalid_arguments",
          `A binding message is delivered as ${$n.join(" or ")}, never ${String(a.mode)}.`,
          { mode: a.mode },
          "Send with mode auto or follow_up, or omit it for the binding's inbound_mode.",
        )
      let d = rs(a.author)
      if (d !== void 0 && "kind" in d) return d
      let m = await n.bindingView({ now: t(), binding_id: a.binding_id })
      if (m === null)
        return K(
          "not_found",
          "No binding has this id.",
          { binding_id: a.binding_id },
          "Deliver the message through the binding the gateway keeps for this chat now; this one no longer exists.",
        )
      let l = { principal: `binding:${m.binding_id}`, idempotency_key: `event:${a.event_id}` },
        c = await n.deliveryReceipt({ now: t(), ...l })
      if (
        c !== null &&
        c.binding_revision !== null &&
        c.args_hash ===
          ao({
            target: c.target_durable_id,
            text: a.text,
            mode: a.mode ?? m.inbound_mode,
            expected_turn_id: null,
            binding: { binding_id: m.binding_id, revision: c.binding_revision },
            author: d,
          })
      ) {
        let b = c.completed
          ? { kind: "replay", result: c.result }
          : await n.recoverDelivery({ now: t(), ...l, args_hash: c.args_hash })
        if (b?.kind === "replay") {
          let T = b.result
          return T.kind === "ok" ? { ...T, deduplicated: !0 } : T
        }
        if (b?.kind === "refused") return K(b.code, b.message, b.details)
      }
      if (m.status !== "active")
        return K("binding_inactive", `The binding is ${m.status}.`, { binding_id: m.binding_id, status: m.status })
      if (!m.direction.inbound)
        return K("unsupported", "The binding carries no inbound direction.", { binding_id: m.binding_id })
      let f = a.mode ?? m.inbound_mode
      if (f === "auto" && m.inbound_mode === "follow_up")
        return K(
          "invalid_arguments",
          "The binding delivers at most follow_up; a message cannot ask for more than its binding's inbound_mode.",
          { binding_id: m.binding_id, mode: f, inbound_mode: m.inbound_mode },
          "Send with mode follow_up (or omit it), or rebind the thread with inbound_mode auto.",
        )
      return await e.engine.deliver({
        sender: {
          kind: "external",
          origin: {
            platform: m.platform,
            account_id: m.account_id,
            chat_id: m.chat_id,
            thread_id: m.thread_id,
            message_id: a.event_id,
            ...(d === void 0 ? {} : { author: d }),
          },
          binding_id: m.binding_id,
          binding_revision: m.revision,
        },
        target: m.session_durable_id,
        text: a.text,
        mode: f,
        all_scope: !0,
        idempotency_key: `event:${a.event_id}`,
      })
    },
    settle: (a) => n.emitCompletions({ now: t(), ...a }),
    dispose: () => {
      o = !0
      for (let a of r) a.cancel()
      r.clear()
    },
  }
}
class qe extends Error {
  extension
  code = "extension_operation_failed"
  constructor(e) {
    super(`The ${e} extension transaction has ended.`)
    this.extension = e
  }
}
class as extends Error {
  extension
  code = "extension_operation_failed"
  constructor(e) {
    super(
      `The ${e} extension ran a statement while a tx helper (enqueue, bind, ...) was still in flight; await the helper first.`,
    )
    this.extension = e
  }
}
class tr extends Error {
  code = "invalid_arguments"
}
function ss(e, n, t, r, o) {
  let i = !0,
    s = 0,
    u = !1,
    a,
    d = Promise.resolve(),
    m = () => {
      if (!i) throw new qe(n)
      if (a !== void 0) throw a
    }
  function l(p) {
    if (u) throw new qe(n)
    if (a !== void 0) throw a
    return p()
  }
  function c(p) {
    if (!i) return Promise.reject(new qe(n))
    s++
    let I = d.then(() => l(p))
    return (
      (d = I.then(
        () => {
          s--
        },
        (D) => {
          ;(s--, (a = D))
        },
      )),
      I
    )
  }
  function g(p, I) {
    if ((m(), s > 0)) throw ((a = new as(n)), a)
    let D = ae(e.sql)
    try {
      bn(p)
      let J = Mt(e.sql, n, I)
      return (mn(e.sql, n, D, ae(e.sql)), J)
    } catch (J) {
      throw ((a = J), J)
    }
  }
  let f = {
      now: () => t,
      busyTimeoutMs: e.config.busy_timeout_ms,
      enqueue: (p) => l(() => Pn(e, p)),
      completeReceipt: (p) => l(() => lt(e, p)),
      abandonReceipt: (p) => l(() => pt(e, p)),
      deliveryView: async (p) => l(() => Mn(e, p)),
      deliveryReceipt: async (p) => l(() => ct(e, p)),
      recoverDelivery: (p) => l(() => ft(e, p)),
      bind: (p) => l(() => bt(e, p)),
      unbind: (p) => l(() => xt(e, p)),
      rebind: (p) => l(() => ht(e, p)),
      listBindings: (p) => l(() => Tt(e, p)),
      bindingView: (p) => l(() => It(e, p)),
      report: (p) => l(() => wt(e, p)),
      readOutbox: (p) => l(() => Rt(e, { ...p, pendingOnly: !0 })),
      ackOutbox: (p) => l(() => St(e, p)),
      claimAnswer: (p) => l(() => vt(e, p)),
      releaseAnswer: (p) => l(() => Ot(e, p)),
      confirmAnswer: (p) => l(() => Nt(e, p)),
      markPriorDelivered: (p) => l(() => $t(e, p)),
      emitCompletions: (p) => l(() => kt(e, p)),
    },
    b = {
      wake: async () => {
        throw Error("An extension enqueue cannot contact a live endpoint.")
      },
    },
    T = Qa({
      store: f,
      endpoints: b,
      senderProvenance: o,
      resolve: async (p, I) => {
        let D = await r(p, I)
        return D.kind === "error" ? D : { kind: "ok", target: { ...D.target, endpoint: null, liveness: "dead" } }
      },
    }),
    N = is({ store: f, engine: T, endpoints: b, locate: async () => null })
  return {
    tx: {
      all: (p, I, D, J) =>
        g(I, () => {
          for (let Ts of p) bn(Ts)
          if (J === void 0) return e.sql.all(p, I, D)
          let hs = Za(J)
          return (
            e.sql.all(
              ["0"],
              `SELECT 0 FROM (${I}
) WHERE 0`,
              D,
            ),
            e.sql.all(p, I, D, es(hs, e.sql.resultColumns(I)))
          )
        }),
      one: (p, I, D) =>
        g(I, () => {
          for (let J of p) bn(J)
          return e.sql.one(p, I, D)
        }),
      exec: (p, I) => g(p, () => e.sql.run(p, I)),
      enqueue: (p) => c(() => N.inbound(p)),
      outboxAck: (p) => c(() => N.ack(p)),
      bind: (p) => c(() => N.bind(p)),
      unbind: (p) => c(() => N.unbind(p)),
      rebind: (p) => c(() => N.rebind(p)),
      bindingFor: (p) => c(() => Li(e, { ...p, now: t })),
      bindingsForSession: (p) =>
        c(async () => {
          if (typeof p !== "string" || p.length === 0)
            throw new tr("bindingsForSession needs a non-empty session durable id.")
          return un(e, "session_durable_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)", [
            p,
            B(t),
          ]).toSorted((D, J) => (D.binding_id < J.binding_id ? -1 : D.binding_id > J.binding_id ? 1 : 0))
        }),
      outboxPending: (p) => c(() => N.outbox(p)),
    },
    cancel: () => {
      ;((i = !1), (u = !0), N.dispose())
    },
    finish: async () => {
      if (((i = !1), await d, N.dispose(), a !== void 0)) throw a
    },
  }
}
function Q(e, n) {
  return { kind: "refused", code: e, message: n }
}
function rr(e) {
  let n = e instanceof Error ? e.message : String(e)
  if (e instanceof H || e instanceof ce || e instanceof tr) return Q(e.code, n)
  if (Sn(e)) return Q("gateway_lock_wait_exceeded", n)
  return Q("extension_operation_failed", n)
}
class co {
  ctx
  resolveTarget
  senderProvenance
  registered = new Map()
  constructor(e, n, t) {
    this.ctx = e
    this.resolveTarget = n
    this.senderProvenance = t
  }
  async register(e, n, t) {
    if (
      !/^[a-z][a-z0-9_]{1,31}$/.test(e.name) ||
      !Array.isArray(e.migrations) ||
      !e.migrations.every((u) => Array.isArray(u) && u.every((a) => typeof a === "string"))
    )
      return Q("invalid_arguments", "An extension needs a valid namespace and an array of SQL migration steps.")
    let r = Pt(e)
    if (r !== void 0) return Q("invalid_arguments", `Extension ${e.name}: ${r}.`)
    try {
      qr(this.ctx.sql, e.name)
    } catch (u) {
      return rr(u)
    }
    let o
    try {
      o = await Ur(e.moduleUrl)
    } catch (u) {
      return Q(
        "extension_import_failed",
        `Cannot import extension ${e.name}: ${u instanceof Error ? u.message : String(u)}`,
      )
    }
    let i = Pt(e, o)
    if (i !== void 0) return Q("invalid_arguments", `Extension ${e.name}: ${i}.`)
    let s = Dr(this.ctx, e)
    if (s !== void 0) return Q("invalid_arguments", `Extension ${e.name}: ${s}.`)
    try {
      let u = await this.ensure(e, n),
        a = await x(this.ctx, "extension_register", () => Vi(this.ctx, e, n, t))
      if (a !== void 0) return Q("invalid_arguments", `Extension ${e.name}: ${a}.`)
      return (this.registered.set(e.name, { descriptor: e, module: o }), { kind: "ok", value: { version: u } })
    } catch (u) {
      if (!(u instanceof ce)) this.registered.set(e.name, { descriptor: e, module: o })
      return rr(u)
    }
  }
  holds(e) {
    return this.registered.get(e.name)?.descriptor === e
  }
  async ensure(e, n) {
    let { name: t, migrations: r } = e,
      o = this.ctx.sql.one(["version"], "SELECT version FROM extension_schema WHERE name = ?", [t])
    if (o !== void 0 && Number(o.version) === r.length) return r.length
    for (;;) {
      let i = await x(this.ctx, "extension_migrate", () => {
        let s = this.ctx.sql.one(["version"], "SELECT version FROM extension_schema WHERE name = ?", [t]),
          u = Number(s?.version ?? 0)
        if (u > r.length) throw new ce(u, r.length, t)
        let a = ae(this.ctx.sql)
        if (
          s === void 0 &&
          a.objects.some(
            (d) =>
              q(String(d.name)).startsWith(`${t}_`) && a.owners.get(`${String(d.type)}:${q(String(d.name))}`) == null,
          )
        )
          throw new H(`Namespace ${t} already contains unowned objects.`)
        if (u === r.length) {
          if (s === void 0)
            this.ctx.sql.run("INSERT INTO extension_schema (name, version, updated_at) VALUES (?, 0, ?)", [t, n])
          return { version: u, applied: !1 }
        }
        for (let d of r[u]) {
          bn(d)
          let m = ae(this.ctx.sql)
          ;(Mt(this.ctx.sql, t, () => this.ctx.sql.exec(d)), mn(this.ctx.sql, t, m, ae(this.ctx.sql)))
        }
        return (
          mn(this.ctx.sql, t, a, ae(this.ctx.sql)),
          this.ctx.sql.run(
            "INSERT INTO extension_schema (name, version, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at",
            [t, u + 1, n],
          ),
          { version: u + 1, applied: !0 }
        )
      })
      if (!i.applied) return i.version
    }
  }
  async call(e, n, t, r) {
    let o = this.registered.get(e),
      i = Pr(this.ctx, e)
    if (Cr(o?.descriptor).has(n) || Cr(i).has(n))
      return Q(
        "caller_not_allowed",
        `${e}.${n} is session-callable: only the session's own tool reaches it, with the caller the engine resolved.`,
      )
    let s = o ?? (await this.load(e, i))
    if ("kind" in s) return s
    return await this.run({ name: e, descriptor: s.descriptor, module: s.module, op: n, args: () => t }, r)
  }
  async load(e, n = Pr(this.ctx, e)) {
    if (n === void 0) return Q("extension_unknown_name", `No store extension is registered as ${e}.`)
    try {
      qr(this.ctx.sql, e)
    } catch (t) {
      return rr(t)
    }
    try {
      return { descriptor: { ...n, name: e }, module: await Ur(n.moduleUrl) }
    } catch (t) {
      return Q("extension_import_failed", `Cannot import extension ${e}: ${t instanceof Error ? t.message : String(t)}`)
    }
  }
  async run(e, n) {
    let { name: t, op: r, module: o } = e,
      i = Object.hasOwn(o, r) ? o[r] : void 0
    if (typeof i !== "function") return Q("extension_unknown_op", `Extension ${t} exports no operation ${r}.`)
    let s = [],
      u = [],
      a
    try {
      let d = await this.ensure(e.descriptor, n)
      a = await x(this.ctx, "extension_call", async () => {
        let m = this.ctx.sql.one(["version"], "SELECT version FROM extension_schema WHERE name = ?", [t]),
          l = Number(m?.version ?? 0)
        if (l !== d) throw new ce(l, e.descriptor.migrations.length, t)
        let c = ae(this.ctx.sql),
          g = ss({ ...this.ctx, afterCommit: s, afterRollback: u }, t, n, this.resolveTarget, this.senderProvenance),
          f
        try {
          let b = async () => {
              try {
                return await i(g.tx, e.args())
              } finally {
                await g.finish()
              }
            },
            T = new Promise((p, I) => {
              f = setTimeout(() => {
                ;(g.cancel(),
                  I(Error(`Extension ${t}.${r} exceeded its ${this.ctx.config.lock_wait_max_ms} ms operation budget.`)))
              }, this.ctx.config.lock_wait_max_ms)
            }),
            N = await Promise.race([b(), T])
          mn(this.ctx.sql, t, c, ae(this.ctx.sql))
          let h = structuredClone(N)
          return (s.push(...(e.effects ?? [])), h)
        } finally {
          ;(clearTimeout(f), g.cancel())
        }
      })
    } catch (d) {
      for (let m of u)
        try {
          m()
        } catch (l) {
          this.ctx.emit({
            kind: "extension_error",
            extension: t,
            phase: "after_rollback",
            error: l instanceof Error ? l.message : String(l),
          })
        }
      return rr(d)
    }
    await this.ctx.hook("afterDbCommit")
    for (let d of s)
      try {
        d()
      } catch (m) {
        this.ctx.emit({
          kind: "extension_error",
          extension: t,
          phase: "after_commit",
          error: m instanceof Error ? m.message : String(m),
        })
      }
    return { kind: "ok", value: a }
  }
}
import { randomUUID as Ym } from "node:crypto"
import { rmSync as Qm, renameSync as Jm, writeFileSync as Zm } from "node:fs"
import { dirname as el, join as nl } from "node:path"
var ds = "unknown-caller"
var Oe = (e, n) => ({ result: { kind: "refused", code: e, message: n } })
function tl(e, n, t) {
  let r = nl(el(et(e)), n, t),
    o = `${r}.${process.pid}.${Ym()}.tmp`
  Zm(o, JSON.stringify({ written_at: new Date().toISOString() }), { mode: 384 })
  try {
    Jm(o, r)
  } finally {
    Qm(o, { force: !0 })
  }
}
function rl(e, n, t) {
  return (
    e.sql.one(["n"], "SELECT 1 AS n FROM thread_creations WHERE creator_durable_id = ? AND created_durable_id = ?", [
      n,
      t,
    ]) !== void 0
  )
}
async function us(e, n) {
  await x(e, "record_thread_creation", () => {
    e.sql.run(
      "INSERT OR IGNORE INTO thread_creations (creator_durable_id, created_durable_id, created_at) VALUES (?, ?, ?)",
      [n.creator_durable_id, n.created_durable_id, n.now],
    )
  })
}
async function ms(e, n, t) {
  let { name: r, caller: o, phase: i } = t
  if (typeof o !== "string" || o.length === 0 || o === ds)
    return Oe("caller_context_missing", "A session-callable op needs the calling session's engine-resolved durable id.")
  let s = await n.load(r)
  if ("kind" in s) return { result: s }
  let { descriptor: u } = s,
    a = u.sessionCallable?.find((p) => p.op === t.op)
  if (a === void 0) return Oe("extension_unknown_op", `Extension ${r} declares no session-callable op ${t.op}.`)
  let d = t.args
  if (typeof d !== "object" || d === null || Array.isArray(d))
    return Oe("invalid_arguments", "Session op arguments must be an object.")
  let m = Lt.find((p) => Object.hasOwn(d, p))
  if (m !== void 0)
    return Oe("invalid_arguments", `${m} is stamped by the store from the engine's caller and cannot be passed.`)
  let l = a.op,
    c = Te(a) ? a.await : void 0
  if (i === "op") {
    let p
    try {
      p = Un(a.parameters, d)
    } catch (I) {
      return Oe(
        "invalid_arguments",
        `${r}.${a.op} declares parameters that cannot be checked: ${I instanceof Error ? I.message : String(I)}`,
      )
    }
    if (p !== void 0) return Oe("invalid_arguments", `Parameter validation failed at ${p.path || "/"}: ${p.message}`)
  } else if (i === "status" || i === "expire") {
    let p = d.await_request_id
    if (c === void 0) return Oe("extension_unknown_op", `${r}.${a.op} declares no await.`)
    if (typeof p !== "string" || !Lr.test(p))
      return Oe("invalid_arguments", `await_request_id must match ${Lr.source}.`)
    l = i === "status" ? c.statusOp : c.expireOp
  } else return Oe("invalid_arguments", `Unknown session call phase ${String(i)}.`)
  let g = a.targetArg === void 0 ? void 0 : d[a.targetArg],
    f = () => ({
      ...(i === "op" ? d : { await_request_id: d.await_request_id }),
      caller_session_durable_id: o,
      ...(i === "op" && typeof g === "string" && rl(e, o, g) ? { caller_created_target: !0 } : {}),
    }),
    { wakeDir: b } = u,
    T = Te(a) ? a.wake : void 0,
    N = i === "op" && T !== void 0 && b !== void 0 ? [() => tl(e.config.agent_dir, b, T)] : [],
    h = await n.run({ name: r, descriptor: u, module: s.module, op: l, args: f, effects: N }, t.now)
  return i === "op" && c !== void 0 && b !== void 0
    ? { result: h, await: { timeout_ms: c.timeoutMs, wake_dir: b } }
    : { result: h }
}
var Je = cl
if (Je === null) throw Error("the gateway store worker must run as a worker thread")
var ps = 10,
  fl = 1e4,
  yl = 3,
  or = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/
function xn(e, n, t) {
  return { kind: "refused", code: e, message: n, ...(t === void 0 ? {} : { details: t }) }
}
function _l(e) {
  return il("sha256").update(JSON.stringify(e)).digest("hex")
}
function cs(e, n, t, r) {
  if (!(
    e.target_durable_id === r.sessionId &&
    e.verbatim_text === r.text &&
    e.verbatim_display_text === r.displayText &&
    e.hop === r.chainCount &&
    e.envelope.origin !== void 0 &&
    "session" in e.envelope.origin &&
    e.envelope.origin.session === (r.sender.kind === "agent" ? r.sender.session_id : void 0)
  ))
    return xn("idempotency_conflict", "This delivery id was already taken in with other content.", { ledger_id: t })
  return {
    kind: "queued",
    delivery_id: r.deliveryId,
    row_id: e.delivery_id,
    ledger_id: t,
    queue_position: n,
    deduplicated: !0,
  }
}
async function gl(e, n) {
  let { record: t, attested_device: r } = n
  if (
    !or.test(r) ||
    !or.test(t.deliveryId) ||
    !or.test(t.sessionId) ||
    typeof t.text !== "string" ||
    typeof t.displayText !== "string" ||
    !Number.isSafeInteger(t.chainCount) ||
    t.chainCount < 1
  )
    return xn("invalid_arguments", "The intake record is malformed.")
  let o = t.sender.kind === "agent" ? t.sender.session_id : void 0
  if (o === void 0 || !or.test(o))
    return xn("unsupported", "Only an agent sender can reach a session that is not running.", {
      reason: "sender_not_allowed",
    })
  if (t.deliverAs !== "followUp")
    return xn("turn_conflict", "A session that is not running has no turn to steer.", { target: t.sessionId })
  if (n.target_session_kind !== "interactive")
    return xn("not_resumable", "A child or worker session is not started for a delivery.", { reason: "not_wakeable" })
  if (n.chain_count_limit !== void 0 && t.chainCount > n.chain_count_limit)
    return xn("unsupported", "The delivery's chain is over this machine's chain limit.", {
      reason: "chain_count_limit",
      chain_count: t.chainCount,
      limit: n.chain_count_limit,
    })
  let i = `device:${r}/${t.deliveryId}`,
    s = `device:${r}`,
    u = t.sender.name?.trim(),
    a
  try {
    a = await Pn(
      e,
      {
        provenance: { ...n.provenance, device: r },
        now: n.now,
        delivery_id: fs(),
        target_durable_id: t.sessionId,
        sender_principal: s,
        rate_principal: `device:${r}`,
        sender_node: `${s}#session:${o}`,
        sender_turn: null,
        cause_delivery_id: null,
        inbound_hop: t.chainCount - 1,
        claimed_root_id: null,
        origin: { session: o },
        actor: u === void 0 || u === "" ? o : u,
        body: t.text,
        mode: "follow_up",
        expected_turn_id: null,
        binding: null,
        receipt: {
          idempotency_key: t.deliveryId,
          args_hash: _l({
            target: t.sessionId,
            text: t.text,
            display_text: t.displayText,
            deliver_as: t.deliverAs,
            chain_count: t.chainCount,
          }),
        },
        endpoint_kind: null,
      },
      {
        ledger_id: i,
        verbatim_text: t.text,
        verbatim_display_text: t.displayText,
        answer: (d, m) => ({
          kind: "queued",
          delivery_id: t.deliveryId,
          row_id: d.delivery_id,
          ledger_id: i,
          queue_position: m,
        }),
        existing: (d, m) => ({ kind: "replay", result: cs(d, m, i, t) }),
      },
    )
  } catch (d) {
    if (!(d instanceof Error && /UNIQUE constraint failed: deliveries\.ledger_id/.test(d.message))) throw d
    let m = e.sql.one(["delivery_id"], "SELECT delivery_id FROM deliveries WHERE ledger_id = ?", [i]),
      l = m === void 0 ? null : Mn(e, String(m.delivery_id))
    if (l === null) throw d
    return cs(l.row, l.queue_position, i, t)
  }
  if (a.kind === "inserted")
    return {
      kind: "queued",
      delivery_id: t.deliveryId,
      row_id: a.row.delivery_id,
      ledger_id: i,
      queue_position: a.queue_position,
      deduplicated: !1,
    }
  if (a.kind === "replay") {
    let d = a.result
    return d.kind === "queued" ? { ...d, deduplicated: !0 } : d
  }
  return a
}
var _o = [],
  go = new Map(),
  yo = !1,
  oe,
  Qe,
  Ye,
  Eo,
  _s = 1,
  Yn = new Map(),
  El = (e, n) =>
    new Promise((t, r) => {
      let o = _s++
      ;(Yn.set(o, { resolve: t, reject: r }), Je.postMessage({ type: "resolve", id: o, address: e, request: n }))
    }),
  Qn = new Map(),
  bl = () =>
    new Promise((e, n) => {
      let t = _s++
      ;(Qn.set(t, { resolve: e, reject: n }), Je.postMessage({ type: "provenance", id: t }))
    })
function gs(e) {
  if (e instanceof qe) {
    hn({ kind: "extension_error", extension: e.extension, phase: "stale_transaction", error: e.message })
    return
  }
  hn({
    kind: "extension_error",
    extension: Eo ?? "worker",
    phase: "async",
    error: e instanceof Error ? e.message : String(e),
  })
}
process.on("uncaughtException", gs)
process.on("unhandledRejection", gs)
Je.on("message", (e) => {
  if (e.type === "provenance_resolved") {
    let n = Qn.get(e.id)
    if ((Qn.delete(e.id), e.ok)) n?.resolve(e.value)
    else n?.reject(Error(e.error))
    return
  }
  if (e.type === "resolution") {
    let n = Yn.get(e.id)
    if ((Yn.delete(e.id), e.ok)) n?.resolve(e.value)
    else n?.reject(Error(e.error))
    return
  }
  if (e.type === "resume") {
    ;(go.get(e.hook)?.(), go.delete(e.hook))
    return
  }
  ;(_o.push(e), xl())
})
async function xl() {
  if (yo) return
  yo = !0
  try {
    for (let e = _o.shift(); e !== void 0; e = _o.shift())
      try {
        let n = await Jl(e.op, e.args)
        Je?.postMessage({ type: "response", id: e.id, ok: !0, value: n })
      } catch (n) {
        Je?.postMessage({
          type: "response",
          id: e.id,
          ok: !1,
          error: {
            message: n instanceof Error ? n.message : String(n),
            stack: n instanceof Error ? n.stack : void 0,
            code: typeof n?.code === "string" ? n.code : void 0,
            details: n instanceof ce ? n.details : void 0,
          },
        })
      }
  } finally {
    yo = !1
  }
}
function hn(e) {
  Je?.postMessage({ type: "event", event: e })
}
function hl() {
  if (oe === void 0) throw Error("the gateway store is not open")
  return oe
}
var ar = [
    "durable_id",
    "session_file",
    "host_instance",
    "state",
    "requested_at",
    "opened_at",
    "first_waiting_at",
    "lease_owner",
    "lease_expires_at",
    "generation",
    "attempts",
    "next_attempt_at",
  ],
  Ze = { kind: "lost_lease" }
function ir(e) {
  return e === null || e === void 0 ? null : Number(e)
}
function Es(e) {
  return {
    durable_id: String(e.durable_id),
    session_file: String(e.session_file),
    host_instance: e.host_instance === null ? null : String(e.host_instance),
    state: e.state,
    requested_at: Number(e.requested_at),
    opened_at: ir(e.opened_at),
    first_waiting_at: ir(e.first_waiting_at),
    lease_owner: e.lease_owner === null ? null : JSON.parse(String(e.lease_owner)),
    lease_expires_at: ir(e.lease_expires_at),
    generation: Number(e.generation),
    attempts: Number(e.attempts),
    next_attempt_at: ir(e.next_attempt_at),
  }
}
function Tn(e, n) {
  let t = e.sql.one(ar, `SELECT ${ar.join(", ")} FROM woken_sessions WHERE durable_id = ?`, [n])
  return t === void 0 ? void 0 : Es(t)
}
function en(e, n) {
  let t = Tn(e, n)
  if (t === void 0) throw Error(`woken session ${n} vanished inside its own transaction`)
  return t
}
function bo(e, n, t) {
  let r = ko(e.config.agent_dir)
  ys(ll(r), { recursive: !0, mode: 448 })
  let o = `${r}.${process.pid}.${fs()}.tmp`
  ;(ml(o, JSON.stringify({ durable_id: n, written_at: t }), { mode: 384 }), ul(o, r))
}
function In(e, n, t, r) {
  return (
    E(e, `UPDATE woken_sessions SET ${t} WHERE durable_id = ? AND generation = ?`, [
      ...r,
      n.durable_id,
      n.generation,
    ]) === 1
  )
}
async function Tl(e, n) {
  return await x(e, "woken_request", () => {
    let t =
      E(
        e,
        "INSERT OR IGNORE INTO woken_sessions (durable_id, session_file, state, requested_at) VALUES (?, ?, 'requested', ?)",
        [n.durable_id, n.session_file, n.now],
      ) === 1
    return (bo(e, n.durable_id, n.now), { kind: "requested", row: en(e, n.durable_id), created: t })
  })
}
async function Il(e, n) {
  return await x(e, "woken_start", () => {
    let t = Tn(e, n.durable_id)
    if (t === void 0) return { kind: "not_found" }
    if (t.state !== "requested") return { kind: "in_progress", row: t }
    if (t.next_attempt_at !== null && t.next_attempt_at > n.now)
      return { kind: "not_yet", next_attempt_at: t.next_attempt_at }
    if (Number(e.sql.one(["n"], "SELECT COUNT(*) AS n FROM woken_sessions WHERE state <> 'requested'")?.n ?? 0) >= xo)
      return { kind: "overloaded" }
    return (
      E(
        e,
        "UPDATE woken_sessions SET state = 'opening', lease_owner = ?, lease_expires_at = ?, generation = generation + 1, next_attempt_at = NULL WHERE durable_id = ?",
        [JSON.stringify(e.self), n.now + Jn, n.durable_id],
      ),
      { kind: "started", row: en(e, n.durable_id) }
    )
  })
}
async function wl(e, n) {
  return await x(e, "woken_renew", () =>
    In(e, n, "lease_expires_at = ?", [n.now + Jn]) ? { kind: "renewed", row: en(e, n.durable_id) } : Ze,
  )
}
async function kl(e, n) {
  let t = Tn(e, n.durable_id)
  if (t === void 0) return { kind: "not_found" }
  if (t.lease_owner === null || t.lease_expires_at === null) return { kind: "not_leased", row: t }
  if (t.lease_expires_at > n.now) return { kind: "lease_live", row: t }
  let r = !(await On(t.lease_owner))
  return await x(e, "woken_take_over", () => {
    let o = Tn(e, n.durable_id)
    if (o === void 0) return { kind: "not_found" }
    if (o.generation !== t.generation) return Ze
    if (o.lease_expires_at !== null && o.lease_expires_at > n.now) return { kind: "lease_live", row: o }
    return (
      In(e, o, "lease_owner = ?, lease_expires_at = ?, generation = generation + 1", [
        JSON.stringify(e.self),
        n.now + Jn,
      ]),
      { kind: "taken_over", row: en(e, n.durable_id), previous_owner_alive: r }
    )
  })
}
async function Rl(e, n) {
  return await x(e, "woken_set_state", () => {
    let t = n.state === "open" ? n.now : null
    return In(e, n, "state = ?, opened_at = COALESCE(opened_at, ?), host_instance = COALESCE(?, host_instance)", [
      n.state,
      t,
      n.host_instance ?? null,
    ])
      ? { kind: "ok", row: en(e, n.durable_id) }
      : Ze
  })
}
async function Sl(e, n) {
  return await x(e, "woken_record_waiting", () =>
    In(e, n, "first_waiting_at = COALESCE(first_waiting_at, ?)", [n.now])
      ? { kind: "ok", row: en(e, n.durable_id) }
      : Ze,
  )
}
async function vl(e, n) {
  return await x(e, "woken_retry_later", () => {
    let t = Tn(e, n.durable_id)
    if (t === void 0 || t.generation !== n.generation) return Ze
    let r = t.attempts + 1
    if (r >= yl)
      return (
        E(e, "DELETE FROM woken_sessions WHERE durable_id = ? AND generation = ?", [n.durable_id, n.generation]),
        bo(e, n.durable_id, n.now),
        { kind: "failed", attempts: r }
      )
    return (
      In(e, n, "state = 'requested', lease_owner = NULL, lease_expires_at = NULL, attempts = ?, next_attempt_at = ?", [
        r,
        n.now + fl,
      ]),
      { kind: "deferred", row: en(e, n.durable_id) }
    )
  })
}
async function Ol(e, n) {
  return await x(e, "woken_end", () => {
    if (E(e, "DELETE FROM woken_sessions WHERE durable_id = ? AND generation = ?", [n.durable_id, n.generation]) !== 1)
      return Ze
    return (bo(e, n.durable_id, n.now), { kind: "ended" })
  })
}
function $l(e, n) {
  let t = Tn(e, n.durable_id)
  return t?.state === "opening" && t.lease_expires_at !== null && t.lease_expires_at > n.now
}
function Nl(e) {
  return e.sql.all(ar, `SELECT ${ar.join(", ")} FROM woken_sessions`, [], "requested_at, durable_id").map(Es)
}
async function Al(e, n) {
  return await x(e, "woken_clear_waiting", () => (In(e, n, "first_waiting_at = NULL", []) ? { kind: "ok" } : Ze))
}
function Ll(e) {
  let n = JSON.parse(String(e.hold_kinds))
  return {
    durable_id: String(e.durable_id),
    wait: e.wait === "held" ? "held" : "waiting",
    hold_kinds: Array.isArray(n) ? n.map(String) : [],
    file_size: Number(e.file_size),
    written_at: Number(e.written_at),
  }
}
function bs(e, n) {
  let t = e.sql.one(
    ["durable_id", "wait", "hold_kinds", "file_size", "written_at"],
    "SELECT durable_id, wait, hold_kinds, file_size, written_at FROM session_wait WHERE durable_id = ?",
    [n.durable_id],
  )
  return t === void 0 ? null : Ll(t)
}
async function Cl(e, n) {
  await x(e, "wait_write", () => {
    E(
      e,
      `INSERT INTO session_wait (durable_id, wait, hold_kinds, file_size, written_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (durable_id) DO UPDATE SET wait = excluded.wait, hold_kinds = excluded.hold_kinds,
         file_size = excluded.file_size, written_at = excluded.written_at`,
      [n.durable_id, n.wait, JSON.stringify(n.hold_kinds), n.file_size, n.now],
    )
  })
}
async function Pl(e, n) {
  await x(e, "wait_clear", () => {
    E(e, "DELETE FROM session_wait WHERE durable_id = ?", [n.durable_id])
  })
}
function Ml(e, n) {
  let t = bs(e, n)
  if (t !== null) return { kind: t.wait === "held" ? "hold" : "approval" }
  let r = e.sql.one(["n"], "SELECT COUNT(*) AS n FROM woken_sessions WHERE durable_id = ?", [n.durable_id])
  return Number(r?.n ?? 0) > 0 ? { kind: "wake" } : null
}
async function Dl(e, n) {
  return await x(e, "wake_count", () => {
    let t = e.sql.one(
        ["count", "human_input_revision"],
        "SELECT count, human_input_revision FROM wake_counts WHERE durable_id = ?",
        [n.durable_id],
      ),
      r = t?.human_input_revision ?? null,
      i =
        t === void 0 || (n.human_input_revision !== null && Number(r) !== n.human_input_revision)
          ? 1
          : Number(t?.count ?? 0) + 1
    return (
      E(
        e,
        `INSERT INTO wake_counts (durable_id, count, human_input_revision) VALUES (?, ?, ?)
       ON CONFLICT (durable_id) DO UPDATE SET count = excluded.count, human_input_revision = excluded.human_input_revision`,
        [n.durable_id, i, n.human_input_revision ?? (r === null ? null : Number(r))],
      ),
      { count: i }
    )
  })
}
function Ul(e, n) {
  return Number(e.sql.one(["count"], "SELECT count FROM wake_counts WHERE durable_id = ?", [n.durable_id])?.count ?? 0)
}
async function Fl(e, n) {
  await x(e, "wake_count_reset", () => {
    E(e, "DELETE FROM wake_counts WHERE durable_id = ?", [n.durable_id])
  })
}
function ql(e, n) {
  let t = (r) =>
    Number(
      e.sql.one(["n"], "SELECT COUNT(*) AS n FROM deliveries WHERE target_durable_id = ? AND state = ?", [
        n.durable_id,
        r,
      ])?.n ?? 0,
    )
  return { queued: t("queued"), claimed: t("admitting"), unapplied: t("admitted") }
}
var jl = "json_extract(envelope, '$.provenance.device')",
  Gl = "target_durable_id = ? AND ledger_id IS NOT NULL AND substr(ledger_id, 1, length(?)) = ?",
  Kl = (e) => {
    let n = `device:${e.sender_device}/`
    return [e.session_id, n, n]
  }
async function Wl(e, n) {
  await x(e, "intake_mark", () => {
    if (n.ledger_id !== void 0)
      E(e, "INSERT OR IGNORE INTO intake_commands (ledger_id, command_id) VALUES (?, ?)", [n.ledger_id, n.command_id])
    E(
      e,
      `INSERT INTO intake_marks (sender_device, session_id, last_command_id, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (sender_device, session_id) DO UPDATE SET last_command_id = excluded.last_command_id,
         updated_at = excluded.updated_at`,
      [n.sender_device, n.session_id, n.command_id, n.now],
    )
  })
}
function xs(e, n) {
  return Number(
    e.sql.one(["n"], `SELECT COUNT(*) AS n FROM deliveries WHERE ${Gl} AND state IN ${Z}`, [...Kl(n)])?.n ?? 0,
  )
}
function Bl(e) {
  return e.sql
    .all(
      ["sender_device", "session_id"],
      "SELECT sender_device, session_id FROM intake_marks",
      [],
      "sender_device, session_id",
    )
    .map((n) => ({ sender_device: String(n.sender_device), session_id: String(n.session_id) }))
}
function Hl(e) {
  return e.sql
    .all(
      ["sender_device", "session_id", "last_command_id"],
      "SELECT sender_device, session_id, last_command_id FROM intake_marks",
      [],
      "sender_device, session_id",
    )
    .map((n) => ({
      sender_device: String(n.sender_device),
      session_id: String(n.session_id),
      last_command_id: String(n.last_command_id),
    }))
    .filter((n) => xs(e, n) > 0)
}
async function zl(e, n) {
  return await x(e, "intake_drained", () => {
    if (xs(e, n) > 0) return { drained: !1 }
    let t = e.sql.one(
      ["last_command_id"],
      "SELECT last_command_id FROM intake_marks WHERE sender_device = ? AND session_id = ?",
      [n.sender_device, n.session_id],
    )
    if (t === void 0) return { drained: !1 }
    return (
      E(e, "DELETE FROM intake_marks WHERE sender_device = ? AND session_id = ?", [n.sender_device, n.session_id]),
      { drained: !0, last_command_id: String(t.last_command_id) }
    )
  })
}
async function Xl(e) {
  let n = e.sql.all(
      ["target_durable_id", "device", "state", "admitted_by"],
      `SELECT target_durable_id, ${jl} AS device, state, admitted_by FROM deliveries
     WHERE ledger_id IS NOT NULL AND state IN ${Z}`,
      [],
      "target_durable_id",
    ),
    t = new Map()
  for (let o of n) {
    if (o.state !== "queued") {
      let s = o.admitted_by === null ? null : JSON.parse(String(o.admitted_by))
      if (s !== null && !(await On(s))) continue
    }
    let i = t.get(String(o.target_durable_id)) ?? new Set()
    if (o.device !== null) i.add(String(o.device))
    t.set(String(o.target_durable_id), i)
  }
  let r = new Set(
    e.sql
      .all(
        ["target_durable_id"],
        "SELECT DISTINCT target_durable_id FROM deliveries WHERE ledger_id IS NULL AND state = 'queued'",
      )
      .map((o) => String(o.target_durable_id)),
  )
  for (let o of r) if (!t.has(o)) t.set(o, new Set())
  return [...t.entries()]
    .sort(([o], [i]) => o.localeCompare(i))
    .map(([o, i]) => ({ durable_id: o, devices: [...i], local: r.has(o) }))
}
function Vl(e, n) {
  let t = e.sql.one(["command_id"], "SELECT command_id FROM intake_commands WHERE ledger_id = ?", [n.ledger_id])
  return t === void 0 ? null : String(t.command_id)
}
function Yl(e, n) {
  let t = `device:${n.sender_device}/`
  return (
    Number(
      e.sql.one(
        ["n"],
        `SELECT COUNT(*) AS n FROM intake_commands c JOIN deliveries d ON d.ledger_id = c.ledger_id
         WHERE c.command_id = ? AND substr(c.ledger_id, 1, length(?)) = ? AND d.state IN ${Z}`,
        [n.command_id, t, t],
      )?.n ?? 0,
    ) > 0
  )
}
async function Ql(e, n, t) {
  switch (n) {
    case "woken_request":
      return await Tl(e, t)
    case "woken_start":
      return await Il(e, t)
    case "woken_renew":
      return await wl(e, t)
    case "woken_take_over":
      return await kl(e, t)
    case "woken_set_state":
      return await Rl(e, t)
    case "woken_record_waiting":
      return await Sl(e, t)
    case "woken_retry_later":
      return await vl(e, t)
    case "woken_end":
      return await Ol(e, t)
    case "woken_clear_waiting":
      return await Al(e, t)
    case "woken_count_wake":
      return await Dl(e, t)
    case "woken_wake_count":
      return Ul(e, t)
    case "woken_reset_count":
      return await Fl(e, t)
    case "woken_session_work":
      return ql(e, t)
    case "woken_wait_write":
      return await Cl(e, t)
    case "woken_wait_read":
      return bs(e, t)
    case "woken_wait_clear":
      return await Pl(e, t)
    case "woken_waiting_on":
      return Ml(e, t)
    case "woken_mark_record":
      return await Wl(e, t)
    case "woken_mark_marked":
      return Bl(e)
    case "woken_mark_pending":
      return Hl(e)
    case "woken_mark_drained":
      return await zl(e, t)
    case "woken_command_for":
      return Vl(e, t)
    case "woken_open_for_command":
      return Yl(e, t)
    case "woken_open_sessions":
      return await Xl(e)
    case "woken_gated":
      return $l(e, t)
    case "woken_list":
      return Nl(e)
    default:
      throw Error(`unknown gateway store op ${n}`)
  }
}
async function Jl(e, n) {
  if (e === "init") return await Zl(n)
  if (e === "close") return (Qe?.close(), (Qe = void 0), (oe = void 0), (Ye = void 0), null)
  let t = hl()
  if (e.startsWith("woken_")) return await Ql(t, e, n)
  switch (e) {
    case "extension_register": {
      let r = n
      return (
        (Eo = r.extension.name),
        { result: await Ye?.register(r.extension, r.now, r.restored_at), retained: Ye?.holds(r.extension) === !0 }
      )
    }
    case "extension_call":
    case "extension_session_call": {
      let r = n
      Eo = r.name
      try {
        if (Ye === void 0) return
        return e === "extension_call" ? await Ye.call(r.name, r.op, r.args, r.now) : await ms(t, Ye, n)
      } finally {
        for (let o of Yn.values()) o.reject(new qe(r.name))
        Yn.clear()
        for (let o of Qn.values()) o.reject(new qe(r.name))
        Qn.clear()
      }
    }
    case "session_callable_ops":
      return Mr(t)
    case "record_thread_creation":
      return await us(t, n)
    case "enqueue":
      return await Pn(t, n)
    case "intake":
      return await gl(t, n)
    case "reconcile":
      return await li(t, n)
    case "claim":
      return await pi(t, n)
    case "record_outcome":
      return await ci(t, n)
    case "refuse_queued":
      return await fi(t, n)
    case "complete_receipt":
      return await lt(t, n)
    case "abandon_receipt":
      return await pt(t, n)
    case "delivery_view":
      return Mn(t, n)
    case "delivery_receipt":
      return ct(t, n)
    case "recover_delivery":
      return await ft(t, n)
    case "list":
      return yi(t, n)
    case "is_referenced":
      return _i(t, n)
    case "journal_mode":
      return gi(t)
    case "stats":
      return Ei(t)
    case "tool_receipt_begin":
      return await Oi(t, n)
    case "tool_receipt_settle":
      return await $i(t, n)
    case "tool_receipt_revise":
      return await Ni(t, n)
    case "tool_receipt_release":
      return await Ai(t, n)
    case "bind":
      return await bt(t, n)
    case "unbind":
      return await xt(t, n)
    case "rebind":
      return await ht(t, n)
    case "list_bindings":
      return await Tt(t, n)
    case "binding_view":
      return await It(t, n)
    case "register_incarnation":
      return await Rr(t, n)
    case "clear_endpoint":
      return await Ii(t, n)
    case "session_owner":
      return wi(t, n)
    case "report":
      return await wt(t, n)
    case "emit_completions":
      return await kt(t, n)
    case "pending_completion_arms":
      return Pi(t, n)
    case "latest_completion_arm":
      return Mi(t, n)
    case "read_outbox":
      return await Rt(t, n)
    case "ack_outbox":
      return await St(t, n)
    case "claim_answer":
      return await vt(t, n)
    case "release_answer":
      return await Ot(t, n)
    case "confirm_answer":
      return await Nt(t, n)
    case "mark_prior_delivered":
      return await $t(t, n)
    case "close_question":
      return await Ui(t, n)
    default:
      throw Error(`unknown gateway store op: ${e}`)
  }
}
async function Zl(e) {
  let { config: n } = e,
    t = rn(n.agent_dir)
  ;(ys(pl(t, "inbox"), { recursive: !0, mode: 448 }), fo(t, 448))
  let r = et(n.agent_dir)
  ;(al(dl(r, "a", 384)), fo(r, 384))
  let o = await import("node:sqlite")
  Qe = new o.DatabaseSync(r, { timeout: n.busy_timeout_ms })
  let i = new fr(Qe)
  i.exec(`PRAGMA busy_timeout = ${Math.trunc(n.busy_timeout_ms)}`)
  let s = Date.now()
  for (;;)
    try {
      i.exec("PRAGMA journal_mode = WAL")
      break
    } catch (a) {
      if (!it(a)) throw a
      let d = Date.now() - s
      if (d + ps > n.lock_wait_max_ms)
        throw (hn({ kind: "lock_wait_exceeded", op: "open", waited_ms: d }), Zn("open", d, n.lock_wait_max_ms))
      await ls(ps)
    }
  i.exec("PRAGMA synchronous = FULL")
  for (let a of ["-wal", "-shm"]) if (sl(`${r}${a}`)) fo(`${r}${a}`, 384)
  let u = {
    pid: process.pid,
    process_start_time: await pr(process.pid),
    instance_id: n.instance_id,
    runtime_instance: n.runtime_instance,
  }
  oe = {
    sql: i,
    config: n,
    self: u,
    stats: { writes: 0, marker_unlinks: 0, transactions: 0 },
    emit: hn,
    hook: ep,
    delay: (a) => ls(a),
  }
  try {
    ;(await di(oe), (Ye = new co(oe, El, bl)))
    let a = await bi(oe, e.now)
    return (
      (oe.stats.writes = 0),
      (oe.stats.transactions = 0),
      (oe.stats.marker_unlinks = 0),
      { self: u, legacy_migrated: a }
    )
  } catch (a) {
    try {
      Qe.exec("ROLLBACK")
    } catch {}
    try {
      Qe.close()
    } finally {
      ;((Qe = void 0), (oe = void 0), hn({ kind: "store_closed" }))
    }
    throw a
  }
}
async function ep(e) {
  let n = oe?.config.test_hooks[e]
  if (n === void 0) return
  if (n === "throw") throw Error(`gateway test hook ${e}`)
  if (n === "sigkill")
    (process.kill(process.pid, "SIGKILL"),
      await new Promise(() => {
        return
      }))
  let t = new Promise((r) => go.set(e, r))
  ;(hn({ kind: "paused", hook: e }), await t)
}
