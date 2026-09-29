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
                  [--request-kind question|select|confirm|input|editor]
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

A bindingless `send` delivers as `cli:<uid>`. `--mode auto` (the default) starts a turn on an idle
session and otherwise queues behind the running turn, like `follow_up`; only `steer` enters a
running turn, and it needs `--expected-turn` (the target's turn epoch): a missing epoch is
`invalid_arguments`, a changed one `turn_conflict`. A target with no live endpoint gets
`delivery.kind: "queued_offline"`: the row is durable and the session takes it when it runs again.
A terminal session is never prompted directly; the message lands in its inbox and its own
extension admits it (a held draft in the editor is never overwritten).

`send --binding <id>` is the connector inbound path: the message is delivered to the binding's
session with the binding's `inbound_mode`, as `binding:<id>`, and `--idempotency-key` is the
platform's event id, so one platform message is admitted once. A target, when given, must be the
binding's session. `--mode` and `--expected-turn` are usage errors here (exit 2), because the
binding decides the mode.

What the receiving session does with a delivery depends on its state when its drain runs:

| State | `auto` | `steer` | `follow_up` |
| --- | --- | --- | --- |
| idle | starts a turn (`started`) | refused `not_steerable` | starts a turn (`started`) |
| mid-turn | queued behind the turn (`queued`) | steered into the turn when `--expected-turn` is the current epoch (`steered`), else `turn_conflict` | queued behind the turn (`queued`) |
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
| Message size | 1 MiB for `send` (with or without `--binding`); 32 KiB for `report` and `answer` text | `message_too_large` |
| Backlog of one target | 128 undelivered messages or 1 MiB | `queue_full` |
| One sender to one target | bursts of 8, then one every 5 s | `overloaded` with `retry_after_ms` |
| One turn | reaches at most 16 sessions | `overloaded` |
| One causal chain (a message and the messages it caused) | 4 hops, 64 deliveries, 7 days | `loop_detected` |
| Replies | a direct reply to the session that messaged this one, or a send to itself | `loop_detected` |
| An undelivered message | expires after 24 hours (or when its binding expires) | the row ends `refused` |

Answers to another session flow back through `read`, `report` and `answer`, not through a reply.

## Connector loop

```bash
id=$(omo thread bind my-session --platform custom --account bot --chat c1 --thread t1 --json | jq -r .binding.binding_id)
omo thread send --binding "$id" --idempotency-key evt-1 "hello from outside"
omo thread outbox "$id" --json          # rows the session reported, oldest first
token=$(omo thread outbox "$id" --json | jq -r '[.rows[] | select(.event == "question" and .question_state == "pending")][0].reply_token')
omo thread answer --binding "$id" --token "$token" "yes"
omo thread outbox "$id" --ack --json    # the same read, then ack through the newest row
```

A question row carries a `reply_token`. The answer must arrive through the binding that asked:
another binding is `binding_mismatch` (the question stays pending), and a token minted before a
rebind, expiry or session restart is `stale_token`. While another answer to the same question is
still being handed to the session, a second answer is `answer_in_progress` (exit 1): retry after a
moment, because the first attempt may still fail and leave the question pending. An answer
abandoned mid-hand-off for more than 120 s is taken over by the next one. When the abandoned
attempt finally ends, a failure changes nothing; if the session took its answer after all, the
question is delivered with that answer and the later attempt is `already_answered`, because the
session takes one answer per question. `already_answered` (exit 1) means the answer reached the
session: stop retrying.

A question answered through an omo from before the answer states existed cannot tell a delivered
answer from one whose attempt died halfway, so it counts as an answer in flight since it was
answered: after 120 s the next answer takes it over. If the session already has that answer, it
refuses the new one (`question_already_resolved`): the question is marked delivered with the earlier
answer, and the new one is `already_answered` (exit 1), as is every answer after it. When the
session instead no longer knows the question at all (`unknown_extension_ui_request`,
`unknown_request`), it was closed some other way: answered in the terminal or Desktop, timed out,
or cancelled. The question is then marked delivered with no answer text, and the new answer and
every later one are `already_answered` with "The session no longer waits for this question
(answered or closed elsewhere)". Such a question costs at most one refused frame, and nothing
reaches the session twice.

The answer text takes the form of the request the session reported (`--request-kind`):

| request kind | accepted answer | reaches the session as |
| --- | --- | --- |
| `question` | any non-blank text | a comment (`answers: {}`, `comment: <text>`) |
| `select` | the option label, non-blank | `value: <text>` |
| `confirm` | `yes` or `no` (also `y`/`n`, `true`/`false`; any case, surrounding spaces trimmed) | `confirmed: true` / `false` |
| `input`, `editor` | any text, empty included | `value: <text>` |
| none reported | any non-blank text | `value`, `answers: {}` and `comment` together, plus `confirmed` for a yes/no word |

Without `--request-kind` the answer goes out in every text form at once, so a question, select,
input or editor each reads its own field. A yes/no word (the confirm words above) also goes out as
`confirmed`, which only a confirm reads, so an undeclared confirm answered yes or no resolves that
way; any other text leaves an undeclared confirm resolving as no. An input or editor that should
take an empty answer must name its kind.

Blank means only whitespace or invisible characters (a zero-width space counts as blank). An
answer the request cannot take is `invalid_arguments` (exit 1) and claims nothing. Only a match
marks the question answered and hands the answer to the session's own endpoint. If the session
cannot be reached or no reply comes back, the answer is `host_unavailable` (exit 3). If the session
refuses it (it no longer waits on that question, or cannot read the answer), the answer is
`stale_token`, or `invalid_arguments` for an unreadable answer, with the session's code in
`error.details.reason` (exit 1). The question then becomes (or stays) pending, so it can be answered
again. The one exception is an answer that took over an expired claim (above) and is refused because
the session no longer waits on the request: the question is then delivered with the earlier answer,
and the answer is `already_answered`. A delivered answer is never released.

## Bindings

A binding attaches one session to one external thread, named by `(platform, account, chat,
thread)`; `--thread` defaults to `@chat` (the chat itself). Nothing here talks to a chat platform:
a connector drives the binding.

- At most one `active` binding holds a thread. Binding a thread that is already held is
  `binding_conflict`, with the holder's `binding_id`, `revision` and session in `details`; there is
  no implicit takeover.
- `unbind` and `rebind` name the revision they expect (`--revision`) and are `stale_revision`
  when it moved. Each bumps the revision. An already closed binding unbinds again with
  `already_closed: true`, and `in_flight` lists the deliveries that came through it and are not
  taken yet.
- `rebind` moves the binding to another session: `lease_started_at` resets, `expires_at` does not
  move (a TTL is never extended), and deliveries still queued under the old revision are refused
  `binding_closed` (listed in `closed`), never moved. A detached or expired binding is
  `binding_inactive`.
- `--ttl` is in seconds (default 604800, 7 days); `--ttl none` never expires. `--direction` and
  `--events` (default all four) decide what may flow each way.

## Reports and the outbox

`report` writes a row to a binding's outbox for the connector to post. Only the session a binding
is attached to reports through it (`scope_denied` otherwise), only while the binding is active
(`binding_inactive`) and subscribed to that event (`unsupported`). Without `--binding` the report
goes to the session's ORIGINATING binding, the one its newest admitted external message came
through; a session that took no message through a binding must name `--binding` (`invalid_arguments`).
Nothing is ever copied to the session's other bindings.

- `milestone` and `report` rows are written at once. The first `--provider-message-id` acked for
  a milestone becomes the binding's `progress_message_id`, and later milestone rows carry it as
  `edit_message_id`, so a connector can edit one progress message in place.
- `question` needs `--request-id`, the session's pending request id, and returns the
  `reply_token` the answer must carry. `--request-kind` says which request that id is (`question`,
  `select`, `confirm`, `input` or `editor`); it decides the answer forms above. Without it the answer
  goes out in every text form, and as `confirmed` for a yes/no word (see above).
  Another kind name is `invalid_arguments`, and so is `--request-kind` on a non-question report.
- `completion` is only armed (see below): it answers `armed: true` and `cursor: null`, and its
  row appears when the session settles.

`outbox <binding-id>` reads rows in cursor order. Without `--after` it continues after the
acknowledged cursor; `--after <cursor>` re-reads from an older one. `ack` (or `outbox --ack`,
which acks through the newest row it read) is idempotent: an older or equal cursor changes
nothing (`changed: false`), and a cursor past the newest row is `cursor_invalid`. Acked rows are
kept 30 days after their ack; unacked rows live as long as their binding plus 30 days. A detached
binding's outbox stays readable.

### Completion arms

A completion is opt-in. Only a session with an arm (from `report ... completion`, here or through
its `thread_report` tool) writes one; every other session settles without touching the gateway
store. The arm is durable: the store row is the source of truth, and it is kept until its
completion is written, with the outcome of the run that settled (`completed`, `failed` or
`cancelled`), never at an intermediate turn end.

`report <session> completion` arms the completion (`armed: true`) and wakes the session's
endpoint, so a running session writes it when it next settles, with that run's outcome. The arm is
durable: when no endpoint answers the wake, the session writes it at the first settle after it
next starts. An arm that lands while a run is settling is written at the next run, with that
run's outcome.

A session picks up arms it did not make itself (left by an earlier runtime after a restart or a
crash, or made by `omo thread`) when it starts and on each wake, with a read that takes no write
lock. Settling never waits on the store for long: the session gives the write 250 ms and lets it
finish in the background. A write that cannot get the store's write lock gives up at about 25 s
(never past 30 s) and is retried after the store's 5 s busy timeout, with the same outcome, until
it lands.

## JSON

With `--json`, stdout is exactly one JSON value, also on failure. `list` prints the thread array;
every other subcommand prints the full result.

| Subcommand | `--json` on success |
| --- | --- |
| `list` | `[{thread_id, name, status: live\|resumable, cwd, created_at, updated_at, surface: tui\|desktop\|child\|daemon, endpoint: {kind: rpc_host\|tui, socket, routing_id}, alive, error_note?, ...}]`; a live row also carries its endpoint's own `list_sessions` fields (`sessionId`, the routing handle; `durableSessionId`, `sessionPath`, `attachments`, `kind`, `socket`, `endpoint_kind`) |
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

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | done |
| 1 | the gateway refused (read `error.code`: `not_found`, `scope_denied`, `binding_mismatch`, `turn_conflict`, `loop_detected`, `answer_in_progress` (retry after a moment), `already_answered` (stop), ...) |
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
