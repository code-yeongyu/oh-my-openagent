# omo thread - the session gateway from scripts and connectors

`omo thread` lists, reads and sends to sessions the way the agent tools `thread_list`, `thread_read` and
`thread_send` do, without an agent session. It is how a script, a cron job or a chat connector talks to
running OmO sessions, always addressed by session id, alias or name: terminal sessions (`tui`),
Desktop threads and task children on their hosts (`rpc_host`).

It never starts a host. Sessions are listed from the endpoints the engine's registry names
(`<agent dir>/rpc-host-daemon/`, read in-process; each endpoint's `list_sessions` says whether it is live), and delivery receipts live in the gateway store
(`<agent dir>/gateway/`). Every call runs as the principal `cli:<uid>`: receipts, loop budgets
and sends are keyed by it, and a delivered message carries the provenance header
`source=external`, `actor=<os user>`.

Exact durable-id sends read the gateway's `session_meta` ownership record rather than running
`host status --all`. Migration v5 adds nullable `endpoint_socket` and `endpoint_kind` (`tui` or
`rpc_host`) beside `incarnation`. A successful control registration publishes all three in one
transaction. Re-registration replaces them with a fresh incarnation; release clears the endpoint
only when its own incarnation still matches, so a late old owner cannot erase a takeover.
The sender validates durable identity and workspace from a fresh `list_sessions` on only that
socket, listed exactly as `thread_list` lists it (10 s for a host, 1.5 s for a terminal), so a busy owner that
answers within that bound is live to the listing, the send and a steer alike.
A published host listener that accepts the connection but never answers therefore costs a send about 10 s before it
queues offline (it was 1.5 s, and 200 ms before that); a refused connect or a missing socket is still offline at once.
A stale socket, different live identity, or cleared endpoint
uses the existing durable queued-offline path. A target no registration published (no row, or only the sequence row its first delivery created)
keeps legacy discovery.
Listing, name ambiguity and fuzzy matching still use broad discovery. No TTL or setting changes.

```bash
omo thread list [--all-scope] [--state running|idle|inactive|archived[,...]] [--json]
omo thread send <target> <text> [--mode auto|steer|follow_up] [--expected-turn <n>] [--idempotency-key <k>] [--json]
omo thread read <target> [--limit <items>] [--max-bytes <n>] [--cursor <c>] [--json]
```

`omo thread list` lists this device's threads (in this directory's workspace, or every workspace with `--all-scope`)
together with the threads on the account's other devices, each with its `device`. With `--json` it prints the whole
result as one object: `threads`, `devices` (each device's name, platform, kind, `online`, `last_seen`, `this_device`,
its thread count and `listing`: `listed`, `incomplete` when it did not answer this listing or answered only part of
it, or `offline`; this device's row carries `dropped`, the inactive or archived threads the listing left unread),
`listing: "incomplete"` with `unanswered_endpoints` when one of this device's engine endpoints did not answer (its
threads read `inactive` with an `error_note` naming the failure, `live_unresponsive` for a timeout, until it answers again; the command fails instead when
none answered) and
`remote_unavailable` when other devices could not be listed, and `aliases_unavailable` when a thread listed without an
alias may still hold one: `sign_in` or `host_unavailable` when the account's aliases could not be read, `not_asked` when
the account's other devices cannot be reached from here: this device's device service is not connected, or it answered
that the account's plan has no relay (a Free plan). Aliases are only read while other devices can be reached.

`omo thread` does not create or resume sessions: session lifecycle belongs to the engine's host
API, and a connector cannot start a session for a new chat thread through `omo thread` alone. To
give a new chat thread its own session, a connector opens one on the operator endpoint
(`omo daemon run` ensures it on `<agent dir>/rpc/rpc.sock`; its `open_session` command is what the
agent tool `thread_create` calls) or launches `omo` itself, keeps the chat-thread-to-session map in its own
state, and sends to that session's durable id with `omo thread send`. A session that is not running is still sent
to (`queued_offline`); it takes its messages when it next starts.

Addresses: a `<target>` or `<session>` is a thread id, a session id, an account alias,
an exact name, a unique thread-id prefix, or `<device>/<thread>` (the device part a device id,
`here`, a device name or a unique device-id prefix; the thread part resolves among that device's
threads only). Names match after Unicode normalization, case folding and whitespace collapsing,
and an address may resolve to a thread on another of the account's devices: `read` and `locate`
reach it there. `send` resolves it too, but the other device's engine admits no command-line
sender, so a send answers `unsupported` with `details.reason: "sender_not_allowed"`
naming the device. `self` names the calling session, which `omo thread`
(principal `cli:<uid>`) never is, so it answers `caller_context_missing` here. Without
`--all-scope` only sessions in the current directory's workspace resolve (the
same rule the agent tools apply); an id outside it is `scope_denied`. `--idempotency-key` on a
mutation replays the first result instead of acting twice (`deduplicated: true`); reusing a key
with other arguments is `idempotency_conflict`.

## Sending

A `send` delivers as `cli:<uid>`. `--mode auto` (the default) steers a running turn:
the message enters the turn in flight, as typing into its terminal does, with that running turn as
its expected turn (`delivery.kind: "steered"`, `effective_mode: "steer"`). On an idle session it
starts a turn (`effective_mode: "start"`, and `effective=start` in the delivery header the receiver reads). The result's
`effective_mode` is the lane the receiver's answer proves (`started` is `start`, `steered` is `steer`, a queued answer is
`follow_up`, except a delivery waiting only for a wake, which starts the woken session). The header is written before
the receiver answers, so when a turn begins or ends in between, the header keeps the lane that was asked for; a
message that waits behind a turn reports `follow_up`. It queues behind only what cannot be steered: a question the session waits on, a
compaction, or a running turn whose epoch the engine does not report. If the turn ends before the
steer reaches it, `auto` does not fail: it takes the lane the target has now (a new turn when idle,
queued behind a turn that began since). `--mode follow_up` always queues behind the running turn.
`--mode steer` steers only the turn you name with `--expected-turn` (the target's turn epoch): a
missing epoch is `invalid_arguments`, a changed one `turn_conflict`. A target with no live endpoint gets
`delivery.kind: "queued_offline"`: the row is durable and the session takes it when it runs again,
exactly once. That holds whether its terminal exited, was killed or is stopped, and when no endpoint
of the agent dir is running at all: for a send, nothing live is the offline case, never
`host_unavailable`. A session no endpoint lists is still found by its durable id (the session file
the engine names after it under `<agent dir>/sessions/`) or by its `/name` (the session files of the
current workspace, or of every workspace with `--all-scope`), so any process can address it, not
only one that saw it running. An unknown target is `not_found`; a name two sessions share is
`ambiguous_target`.
A terminal session is never prompted directly; the message lands in its inbox and its own
extension admits it (a held draft in the editor is never overwritten).

The SDK's `send` takes exactly `{ thread, text, mode?, expected_turn_id?, all_scope?, idempotency_key? }`; any other
key (a misspelt `allScope`, say) is `invalid_arguments` naming it, and so is an unknown key on `list`, `read` and
`locate`.

What the receiving session does with a delivery depends on its state when its drain runs:

| State | `auto` | `steer` | `follow_up` |
| --- | --- | --- | --- |
| idle | starts a turn (`started`) | refused `not_steerable` | starts a turn (`started`) |
| mid-turn | steered into the running turn (`steered`) | steered into the turn when `--expected-turn` is the current epoch (`steered`), else `turn_conflict` | queued behind the turn (`queued`) |
| waiting on a question | queued (`queued`) | refused `not_steerable` | queued (`queued`) |
| compacting | queued (`queued`) | refused `not_steerable` | queued (`queued`) |
| offline (no live endpoint) | kept for the next run (`queued_offline`) | refused `turn_conflict` | kept for the next run (`queued_offline`) |

The user always wins over a delivery: while the terminal's editor holds a draft, or a submission
has not reached the session yet, the delivery waits and is admitted on the next wake. The session
shows a one-line notice ("remote message from <actor> queued (<delivery_id>)") once per delivery
that waits. The `send` reply reports what happened by the time it returns, so a message the
session has not admitted yet is `queued` with a `queue_position`.

Every send is checked against fixed budgets, which no setting raises:

| Guard | Limit | Answer |
| --- | --- | --- |
| Message size | 1 MiB for `send` | `message_too_large` |
| Backlog of one target | 128 undelivered messages or 1 MiB | `queue_full` |
| One sender to one target (the loop guard) | bursts of 8, then one every 5 s | `pair_loop_guard` with `burst`, `window_ms` and `retry_after_ms` |
| One causal chain (a message and the messages it caused) | no count limit; each delivery records its hop | - |
| A send to itself | always refused | `loop_detected` |
| An undelivered message | expires after 24 hours | the row ends `refused` |

A session may message the session that messaged it, so A to B to A is delivered; answers also flow back through `read`.

A connector treats `pair_loop_guard` as back-pressure, not as a lost message: nothing was written, so
it queues the message and retries the same `send` (same `--idempotency-key`) after
`error.details.retry_after_ms`.

## Store extensions

JavaScript packages register extensions on the `createThreadSdk(...)` result exported by the
shipped `runtime/thread-sdk/sdk.js`. `createGatewayStore` is an internal source factory, not an
export of a shipped bundle. Registration is local to the SDK's store handle; each process
registers the extensions it uses. When the handle's store worker exits and the next call starts
a fresh one, the handle registers the extensions its previous worker held again before that
call runs.

```typescript
const { createThreadSdk } = await import(`${pluginRoot}/runtime/thread-sdk/sdk.js`)
const store = createThreadSdk({ agentDir, cwd: process.cwd(), uid: process.getuid(), user: "connector" })
const registered = await store.registerStoreExtension({
  name: "notes",
  migrations: [["CREATE TABLE notes_items (id INTEGER PRIMARY KEY, text TEXT)"]],
  moduleUrl: new URL("./dist/store-ops.mjs", import.meta.url).href,
})
const result = await store.extensionCall("notes", "remember", { id: 1, text: "hello" })
await store.dispose()
```

The compiled `.js`, `.mjs` or `.cjs` module exports named operations `(tx, args) => result`
(async is supported). TypeScript is not stripped in the worker. Arguments and results must be
structured-cloneable. Both API methods return `{ kind: "ok", value }` or
`{ kind: "refused", code, message }`; registration's value is `{ version }`.

`name` matches `^[a-z][a-z0-9_]{1,31}$` and must not collide with a core namespace or prefix
any core object name. Names such as `gateway`, `thread`, and `sqlite` are rejected at registration.
Each migration step is an array of SQL statements,
tracked in `extension_schema`, independently of core `user_version`. Registration and calls
ensure pending steps after core migrations. Each step takes `BEGIN IMMEDIATE` and re-reads the
version under the lock, so concurrent processes apply it once. Overlapping namespaces such as
`alpha` and `alpha_beta` are allowed in either registration order, but neither owns the other's
objects. An unowned object already bearing the namespace prefix blocks its first registration.

Operations run in one `BEGIN IMMEDIATE`. The transaction surface is:

- `all(columns, sql, params?, orderBy?)`, `one(columns, sql, params?)`, and `exec(sql, params?)`:
  one SQLite statement per call, using `?` parameters (`string | number | null`). Reads return
  records keyed by the explicit columns; `one` returns `undefined` when absent; `exec` returns
  the changed-row count. Use `orderBy` for ordered reads: it lists the statement's output columns,
  each optionally with `COLLATE BINARY|NOCASE|RTRIM`, `ASC`/`DESC` or `NULLS FIRST`/`NULLS LAST`
  (`"created_at, id"`). Each name must match a column the statement returns (ASCII
  case-insensitively), and the ORDER BY is rebuilt from that column's name and the fixed keywords.
  Anything else, such as a `LIMIT`, an `OFFSET`, a table-qualified, quoted or unknown column, is
  refused with `extension_schema_violation`; put a `LIMIT` in the statement itself
  (`... ORDER BY created_at, id LIMIT ?`). Only anonymous parameter tokens are
  replaced; literal question marks in SQL strings, quoted identifiers and comments are preserved.
  `exec` can also create, alter and drop the extension's own objects during an operation, not
  just during migration. Identifiers and schema qualifiers follow SQLite's ASCII case folding.

SQL can access only objects recorded as owned by this extension in the persistent
`extension_objects` registry. Core migration v6 snapshots every existing schema object as
core-owned before extensions run. Each extension's new `<name>_*` objects are recorded under its
owner in the same transaction; a prefix alone never grants access. Names in the registry are
ASCII-case normalized. SQLite's automatic indexes for TEXT/composite primary keys and UNIQUE
constraints inherit their table's owner; a core automatic index remains core-owned.
Ownership survives reopening the store, and a newly appearing lookalike does not become
extension-owned.

SQLite authorizes resolved statements, including `DELETE FROM table` without a WHERE clause.
`sqlite_schema` (`type`, `name`, `tbl_name`, `sql`) is also compared before and after migration
steps and calls. Creating, dropping, renaming or altering an object the extension does not own
rolls back the transaction. Triggers and views are rejected outright, both during statement
authorization and in the schema-effect check, even with a matching prefix.
Transaction-control SQL, PRAGMAs and attached/temporary databases are refused. Table-valued
sources such as `json_each` and `pragma_table_info` are not owned objects and are refused.
This is a store API contract, not a sandbox for untrusted JavaScript modules.
A foreign key from an extension table to a core table makes every write to that table read the
core table, so those writes are refused; keep core ids such as a session's durable id as plain values.

The [retention](#retention) sweep deletes only core rows, never rows of an extension's tables. A core id an
extension keeps by value can name a row that retention has since pruned.

A thrown operation rolls back the extension's writes. Each post-commit effect runs independently: a failed effect
emits an `extension_error` store event with phase `after_commit`, does not skip later effects, and does not turn
committed data into a refused call. Catching an error from `all`, `one` or `exec` does not clear it: the whole call
still rolls back, including for a caught constraint error.

Refusal codes are `extension_import_failed`, `extension_unknown_op`, `extension_unknown_name`,
`extension_schema_violation`, `gateway_lock_wait_exceeded`, and `gateway_schema_too_new`.
Invalid registration input and uncloneable call arguments are `invalid_arguments`; a thrown
operation or expired operation deadline is `extension_operation_failed`. The worker keeps
serving core requests after operation refusals on a supported database. Reserved names, unowned object access, triggers,
views, and forbidden DDL all use `extension_schema_violation`; rejecting a reserved name leaves
that name unregistered. Lock acquisition uses the core busy timeout and
30-second total bound, not an unbounded retry. An operation has the same time budget after acquiring the
transaction lock. That budget equals the bound other writers
wait for the lock, so a writer queued behind an operation that runs out its budget can itself
receive the retryable `gateway_lock_wait_exceeded`. On expiry, the transaction is revoked
and rolled back before the next request runs. This bounds asynchronous waits, not synchronous
JavaScript that blocks the worker's event loop. Using a retained `tx` after the operation
returns throws a typed error; an unhandled expired-transaction error
is reported as an `extension_error` event with phase `stale_transaction`, without killing
the worker. Any other late asynchronous error from extension code - a timer or an unawaited
promise that fails after the operation returned - is reported as an `extension_error` with
phase `async`, attributed to the most recent extension activity on a best effort, and never
closes the store. If the worker ever does exit, the facade opens a fresh one on the next
call and restores that worker's registrations.

A core schema newer than this binary supports is refused with `gateway_schema_too_new`
without applying migrations or lowering `user_version`. Extension registration/calls return
the refusal; internal core store methods reject with an error carrying that code. Use a compatible binary
to access that database.

The same `gateway_schema_too_new` refusal applies when an extension's stored
`extension_schema.version` exceeds the caller's `migrations.length`. Registration and
lazy migration checks compare versions under the migration lock. Refusal leaves stored
version, timestamps, ownership and data unchanged and does not replace an existing
compatible registration. Core operations and compatible extensions remain usable.

## Retention

The gateway store keeps a delivered message's body and bookkeeping only as long as something can
still read it. Pruning runs inside the store's own write transactions (a send, a tool receipt), at most once an hour unless the previous pass hit its bound of 256 rows
per table, so it never adds a write when nothing else writes.

| Rows | Kept for |
| --- | --- |
| A delivered (`applied`) or refused message, with its body | 30 days after its last change, and longer while its idempotency receipt is kept |
| An undelivered, admitting or admitted message | until it is delivered, refused or expires (never pruned) |
| Idempotency receipts | 30 days |
| A causal chain's root record | 7 days; a continuation after that is delivered under a fresh root and keeps its hop count |
| A sender's rate bucket | until it is idle for a full refill (40 s), which is exactly a fresh bucket |
| A session's sequence counter and incarnation | while any delivery names the session; rebuilt on its next use |

## JSON

With `--json`, stdout is exactly one JSON value, also on failure. `list` prints the thread array;
every other subcommand prints the full result.

| Subcommand | `--json` on success |
| --- | --- |
| `list` | `[{thread, name, state: running\|idle\|inactive\|archived, model?: {provider, id}, status: live\|resumable (deprecated: resumable exactly when no engine holds the thread), machine?, cwd, created_at, updated_at: <ISO 8601 string>\|null, link, surface?: tui\|desktop\|child\|daemon, as_of?, controls?, error_note?, device?, alias?}]`; `--state` (repeatable or comma-separated) picks the states listed, and the default lists every state except `archived`; a thread its engine closed stays listed `inactive` from its session file (the newest 200 files in scope); `thread` is the address `read` and `send` take back. Live and degraded rows use the same bounded final-record policy, so `updated_at` is null rather than an older timestamp when the final complete valid entry's timestamp cannot be proved. After live and degraded rows are combined, the public list sorts known `updated_at` newest first, then unknown activity last, with `thread` ascending for ties. Routing ids, socket and session-file paths are not shown (#14044) |
| `send` | `{kind:"ok", thread, delivery_id, message_seq, delivery: {kind: queued\|queued_offline\|started\|steered, ...}, effective_mode: start\|steer\|follow_up (the requested mode while it waits for a receiver), endpoint_kind: rpc_host\|tui\|null, deduplicated}` |
| `read` | `{kind:"ok", thread, link, items: [{seq, role: user\|assistant\|tool\|system, content}], truncated, next_cursor?, source, source_incomplete?, error_note?}` |

A failure is `{kind:"error", error: {code, message, next_action, details?}}`; the code is one of
the thread error taxonomy (`packages/omo-senpi/src/components/thread/AGENTS.md`, "Error taxonomy").
The failures the CLI answers itself use the same shape: a usage error is `invalid_arguments`
(exit 2), and win32 or a runtime without `node:sqlite` is `unsupported` (exit 4).

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | done |
| 1 | the gateway refused (read `error.code`: `not_found`, `scope_denied`, `unsupported` with `details.reason` `sender_not_allowed`, `turn_conflict`, `loop_detected`, ...) |
| 2 | usage: unknown subcommand or option, a wrong number of arguments, a non-integer where a number goes, a `--mode` other than `auto`/`steer`/`follow_up`, an empty or whitespace-only `send` text (the SDK is not loaded) |
| 3 | `host_unavailable`: no endpoint answered where one was needed: `list`, `read` of a live session; or, with the account's devices, an address this device does not hold that a device which did not answer may hold (`details.reason` `listing_incomplete` or `device_unanswered`). A `send` to a session this device holds, or knows from its session file, never answers it (it queues offline) |
| 4 | the CLI cannot run here: win32 (no unix sockets), or a runtime without `node:sqlite`. A gateway answer with code `unsupported` exits 1 |
| 5 | `internal_error`, also when the plugin's thread SDK cannot be loaded (a broken install; with `--json` still one JSON error) |

## For scripts in JavaScript

The same operations are importable from the plugin payload, without spawning `omo`:

```js
const { createThreadSdk } = await import(`${pluginRoot}/runtime/thread-sdk/sdk.js`)
const sdk = createThreadSdk({ agentDir, cwd: process.cwd(), uid: process.getuid(), user: "bot" })
try {
  const sent = await sdk.send({ thread: "my-session", text: "ping" })
} finally {
  await sdk.dispose()
}
```

`pluginRoot` is `<omo-ai install>/plugin`. Every method resolves to the same data union as the
CLI's JSON; nothing throws for a refusal. Endpoints come from the endpoint registry on disk; pass
`engineStatusAll` (a function returning the stdout of `omo host status --all --include-workers --json`) only to
enumerate from that report instead. Neither the SDK nor `omo thread` runs that command itself: it is a full
diagnostic pass that took 8-9 s on a host with about 50 endpoints.

The SDK also controls threads, with the same arguments and results as the agent tools of the same name:

| Method | Tool | Arguments |
| --- | --- | --- |
| `create` | `thread_create` | `{ thread?, device?, alias?, name?, cwd?, worktree?, fork_from?, skills?, model?, reasoning?, permission_preset?, prompt?, delivery?, idempotency_key? }` |
| `interrupt` | `thread_interrupt` | `{ thread, turn_id?, all_scope? }` |
| `close` | `thread_close` | `{ thread?, all_scope?, idempotency_key?, force?, graceful?, wait_ms? }` |
| `rename` | `thread_rename` | `{ thread?, name?, alias?, all_scope?, idempotency_key? }` |
| `set_model` | `thread_set_model` | `{ thread, model, provider?, all_scope?, idempotency_key? }` |

Each reaches the thread wherever it runs, on this device or another device of the account, through the
same code as the tool. Invalid arguments answer `invalid_arguments`, a thread no session holds answers
`not_resumable` (`close` answers `closed: false, reason: "not_live"`), and every other refusal is the tool's
error code. A script acts as itself, never as a session: `self` (and a `close` or `rename` with no `thread`)
answers `caller_context_missing`, a thread it creates records no creator session, and a `create` `prompt` is
sent as the script's own command-line message with the creator's authority. `create` makes a new thread on this
device under an id derived from `idempotency_key`, so a repeat under the same key reopens that thread instead of
making another, and `rename` passes the key to the alias registry; the SDK keeps no tool receipt, so any other
repeated call runs again.

```js
const created = await sdk.create({ name: "nightly-build" })
if (created.kind === "ok") {
  await sdk.set_model({ thread: created.thread, model: "opus" })
  await sdk.interrupt({ thread: "nightly-build" })
  await sdk.close({ thread: "nightly-build" })
}
```
