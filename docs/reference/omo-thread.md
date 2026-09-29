# omo thread - the session gateway from scripts and connectors

`omo thread` runs every thread operation the agent tools offer (`thread_list`, `thread_send`,
`thread_read`, `thread_bind` ... `thread_answer`) without an agent session. It is how a script,
a cron job or a chat connector talks to running OmO sessions: terminal sessions (`tui`),
Desktop threads and task children on their hosts (`rpc_host`).

It never starts a host. Sessions are listed from what the engine enumerates
(`host status --all`), and bindings, the outbox and delivery receipts live in the gateway store
(`<agent dir>/gateway/`). Every call runs as the principal `cli:<uid>`: receipts, loop budgets
and bindingless sends are keyed by it, and a delivered message carries the provenance header
`source=external`, `actor=<os user>`.

```bash
omo thread list [--all-scope] [--json]
omo thread send <target> <text> [--mode auto|steer|follow_up] [--expected-turn <n>] [--idempotency-key <k>] [--json]
omo thread send --binding <id> [<target>] <text> [--idempotency-key <event-id>] [--json]
omo thread read <target> [--limit <items>] [--max-bytes <n>] [--cursor <c>] [--json]
omo thread bind <session> --platform <p> --account <id> --chat <id> [--thread <id>] [--direction in|out|both]
                [--inbound-mode auto|follow_up] [--events milestone,report,question,completion]
                [--root-message <id>] [--progress-message <id>] [--policy <id>] [--ttl <seconds>|none]
omo thread unbind <binding-id> --revision <n>
omo thread rebind <binding-id> <session> --revision <n>
omo thread bindings [--session <s>] [--platform <p>] [--account <id>] [--chat <id>] [--thread <id>] [--status <s>]
omo thread report <session> <milestone|report|question|completion> <text> [--binding <id>] [--request-id <id>]
omo thread answer --binding <answering-binding-id> --token <reply-token> <text>
omo thread outbox <binding-id> [--after <cursor>] [--limit <n>] [--ack]
omo thread ack <binding-id> <cursor> [--provider-message-id <id>]
```

A target or session is a durable session id, or an exact name. Without `--all-scope` only
sessions in the current directory's workspace resolve (the same rule the agent tools apply);
an id outside it is `scope_denied`. `--idempotency-key` on a mutation replays the first result
instead of acting twice (`deduplicated: true`); reusing a key with other arguments is
`idempotency_conflict`.

## Sending

A bindingless `send` delivers as `cli:<uid>`. `--mode auto` steers a running turn and otherwise
starts one; `steer` needs `--expected-turn` (the target's turn epoch) and is `turn_conflict` when
it changed; `follow_up` queues behind the running turn. A target with no live endpoint gets
`delivery.kind: "queued_offline"`: the row is durable and the session takes it when it runs again.
A terminal session is never prompted directly; the message lands in its inbox and its own
extension admits it (a held draft in the editor is never overwritten).

`send --binding <id>` is the connector inbound path: the message is delivered to the binding's
session with the binding's `inbound_mode`, as `binding:<id>`, and `--idempotency-key` is the
platform's event id, so one platform message is admitted once. A target, when given, must be the
binding's session.

## Connector loop

```bash
id=$(omo thread bind my-session --platform custom --account bot --chat c1 --thread t1 --json | jq -r .binding.binding_id)
omo thread send --binding "$id" --idempotency-key evt-1 "hello from outside"
omo thread outbox "$id" --json          # rows the session reported, oldest first
omo thread outbox "$id" --ack --json    # the same read, then ack through the newest row
omo thread answer --binding "$id" --token "$token" "yes"
```

A question row carries a `reply_token`. The answer must arrive through the binding that asked:
another binding is `binding_mismatch` (the question stays pending), a token minted before a
rebind, expiry or session restart is `stale_token`, and a second answer is `already_answered`.
An acked row is not returned again; `--after <cursor>` re-reads from an older cursor.

## JSON

With `--json`, stdout is exactly one JSON value, also on failure. `list` prints the thread array;
every other subcommand prints the full result.

| Subcommand | `--json` on success |
| --- | --- |
| `list` | `[{thread_id, name, status: live\|resumable, cwd, created_at, updated_at, surface: tui\|desktop\|child\|daemon, endpoint: {kind: rpc_host\|tui, socket, routing_id}, alive, error_note?}]` |
| `send` | `{kind:"ok", thread_id, delivery_id, message_seq, delivery: {kind: queued\|queued_offline\|started\|steered, ...}, effective_mode, endpoint_kind: rpc_host\|tui\|null, deduplicated}` |
| `read` | `{kind:"ok", thread_id, items: [{seq, role: user\|assistant\|tool\|system, content}], truncated, next_cursor?, source, source_incomplete?, error_note?}` |
| `bind` | `{kind:"ok", binding: <binding>, deduplicated}` |
| `unbind` | `{kind:"ok", binding, already_closed, in_flight: [delivery ids], deduplicated}` |
| `rebind` | `{kind:"ok", binding, closed: [delivery ids], deduplicated}` |
| `bindings` | `{kind:"ok", bindings: [<binding>], next_cursor}` |
| `report` | `{kind:"ok", binding_id, revision, event, cursor, reply_token, armed, deduplicated}` |
| `answer` | `{kind:"ok", binding_id, cursor, session_durable_id}` |
| `outbox` | `{kind:"ok", binding_id, revision, status, rows: [{cursor, binding_id, revision, event, text, state, created_at, edit_message_id, provider_message_id, reply_token, question_state, outcome}], next_cursor, acked_cursor, acked?}` |
| `ack` | `{kind:"ok", binding_id, acked_cursor, changed}` |

`<binding>` is `{schema_version, binding_id, revision, status, platform, account_id, chat_id,
thread_id, root_message_id, progress_message_id, session_realm_id, session_durable_id,
direction: {inbound, outbound}, inbound_mode, outbound_events, policy_id, created_at, updated_at,
lease_started_at, ttl_seconds, expires_at}`.

A failure is `{kind:"error", error: {code, message, next_action, details?}}`; the code is one of
the thread error taxonomy (`packages/omo-senpi/src/components/thread/AGENTS.md`, "Error taxonomy").
The failures the CLI answers itself use the same shape: a usage error is `invalid_arguments`
(exit 2), and win32 or a runtime without `node:sqlite` is `unsupported` (exit 4).

`report <session> completion` arms the completion in the gateway store. A session writes an armed
completion when it settles, but a running session only learns of arms made by its own
`thread_report`; an arm made from the CLI is picked up when the session's runtime next starts.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | done |
| 1 | the gateway refused (read `error.code`: `not_found`, `scope_denied`, `binding_mismatch`, `turn_conflict`, `loop_detected`, ...) |
| 2 | usage: unknown subcommand or option, a missing required flag, a non-integer where a number goes, a `--mode` other than `auto`/`steer`/`follow_up`, a `--direction` other than `in`/`out`/`both`, an empty or whitespace-only `send` text (the SDK is not loaded) |
| 3 | `host_unavailable`: no endpoint answered where one was needed |
| 4 | unsupported: win32 (no unix sockets), or a runtime without `node:sqlite` |
| 5 | `internal_error` |

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
CLI's JSON; nothing throws for a refusal. Pass `engineStatusAll` (a function returning the stdout of
`omo host status --all --include-workers --json`) to choose how the engine is run; without it the SDK runs
the engine CLI itself, and when no engine can enumerate it falls back to the endpoint registry on disk.
