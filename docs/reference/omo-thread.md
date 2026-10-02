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

Exact durable-id sends read the gateway's `session_meta` ownership record rather than running
`host status --all`. Migration v5 adds nullable `endpoint_socket` and `endpoint_kind` (`tui` or
`rpc_host`) beside `incarnation`. A successful control registration publishes all three in one
transaction. Re-registration replaces them with a fresh incarnation; release clears the endpoint
only when its own incarnation still matches, so a late old owner cannot erase a takeover.
The sender validates durable identity and workspace from a fresh `list_sessions` on only that
socket, under a bounded 200 ms request. A stale socket, different live identity, or cleared endpoint
uses the existing durable queued-offline path. A target with no metadata row keeps legacy discovery.
Listing, name ambiguity and fuzzy matching still use broad discovery. No TTL or setting changes.

```bash
omo thread list [--all-scope] [--json]
omo thread create [--name <n>] [--cwd <dir>] [--fork-from <id>] [--provider <p>] [--model <m>] [--thinking <level>]
                  [--set-by config|user|lead] [--json]
omo thread models [<thread>] [--provider <p>] [--json]
omo thread set-model <thread> <model> [--provider <p>] [--set-by config|user|lead] [--json]
omo thread set-reasoning <thread> <level> [--scope session|turn] [--json]
omo thread send <target> <text> [--mode auto|steer|follow_up] [--expected-turn <n>] [--idempotency-key <k>] [--json]
omo thread send --binding <id> [<target>] <text> [--idempotency-key <event-id>] [--mode auto|follow_up]
                [--author-id <platform-user-id> --author-name <display> [--author-user-id <id>]] [--json]
omo thread read <target> [--limit <items>] [--max-bytes <n>] [--cursor <c>] [--json]
omo thread bind <session> --platform <p> --account <id> --chat <id> [--thread <id>] [--root-message <id>]
                [--progress-message <id>] [--direction in|out|both] [--inbound-mode auto|follow_up]
                [--events milestone,report,question,completion] [--policy <id>] [--ttl <seconds>|none]
                [--idempotency-key <k>]
omo thread unbind <binding-id> --revision <n> [--idempotency-key <k>]
omo thread rebind <binding-id> <session> --revision <n> [--idempotency-key <k>]
omo thread bindings [--session <s>] [--platform <p>] [--account <id>] [--chat <id>] [--thread <id>] [--status <s>]
                    [--cursor <c>] [--limit <n>]
omo thread report <session> <milestone|report|question|completion> <text> [--binding <id>] [--request-id <id>]
                  [--request-kind question|select|confirm|input|editor] [--idempotency-key <k>]
omo thread answer --binding <answering-binding-id> --token <reply-token> <text>
                  [--author-id <platform-user-id> --author-name <display> [--author-user-id <id>]]
omo thread outbox <binding-id> [--after <cursor>] [--limit <n>] [--ack]
omo thread ack <binding-id> <cursor> [--provider-message-id <id>]
```

`omo thread create` opens a new session on the operator endpoint (`omo daemon run` ensures it on
`<agent dir>/rpc/rpc.sock`; with nothing answering there it is `host_unavailable`, exit 3), the same
`open_session` the agent tool `thread_create` uses. A connector creates one session per new chat
thread this way and binds its durable id with `omo thread bind`. `omo thread` never resumes a
session: a session that is not running is still bound, sent to (`queued_offline`) and reported for,
and it takes its messages when it next starts.

A target or session is a durable session id, or an exact name. Without `--all-scope` only
sessions in the current directory's workspace resolve (the same rule the agent tools apply);
an id outside it is `scope_denied`. `--idempotency-key` on a mutation replays the first result
instead of acting twice (`deduplicated: true`); reusing a key with other arguments is
`idempotency_conflict`.

## Models

Every session the gateway creates or re-models has a model record, reported as `model` on `list`
rows, on `read`, on `create`, `set-model` and as `current` on `models`:

```json
{ "provider": "anthropic", "id": "claude-opus-5-5", "thinking_level": "medium", "provenance": "auto", "set_by": null, "reason": null }
```

- `provenance: "auto"`: nobody chose a model, so it was resolved from the user's connected
  providers: the first rung of the active `model_profile` (`omo.json`, default `recommended`) that
  a connected provider serves, else the first model a connected provider serves. It is resolved
  before the session opens and passed to the host, so the host's own default (a stale settings
  default, a scoped model) never decides it. `set_by` and `reason` are `null`. Chat: "model X (auto)".
- `provenance: "set"`: an explicit choice, at `create --model` or later with `set-model` (or the
  agent tools `thread_create` / `thread_set_model`, or `/model` in the session itself). `set_by`
  says whose: `config` (the connector's configuration), `user` (the default for `omo thread`, and
  for `/model`) or `lead` (a lead session's agent tool). Chat: "(scope default)", "(set by you)",
  "(chosen by the lead)".
- `provenance: "fallback"`: the engine switched away after a provider error. `set_by` keeps the
  setter of the choice it overrode and `reason` is the provider error. When the engine reverts, the
  record reads the original provenance again. Chat: "switched to Z".

`model` is `null` for a session the gateway has no record of (one it neither created nor
re-modelled). The record is kept in the gateway store by durable id, so it survives every resume:
reopening a session never changes its model, and an explicit choice stays explicit.

`create` takes `--model` as `provider/id`, an exact id, or a unique fragment of the id or display
name; `--provider` narrows a bare id, and without `--model` it restricts the auto choice to that
provider (`model_not_found` when it serves no connected model); an empty `--provider` counts as none. `--thinking` is the starting level. Everything that can be
refused is refused before a session opens: `model_not_found` (`details.available`, the first 20
`provider/id`; empty when no provider is connected), `model_ambiguous` (`details.candidates`, up
to 10), `thinking_level_unsupported` (`details.supported`), `invalid_arguments` (an empty model, a
bad `--set-by`, `--set-by` without `--model`), and `unsupported` for `--provider`, `--model` or
`--thinking` on a host that cannot list a new session's models. `--set-by` defaults to `user` when a model is given.

`models` lists what a new session could run (no thread), or what the thread's live session can
switch to, with `current` its record: `{kind:"ok", thread_id|null, current: model|null, available:
[{provider, id, name, thinking_levels}]}`. `set-model` switches a live session (the engine applies
it from the next turn) with the same matching and refusals, plus `not_resumable` for a thread with
no live owner. `set-reasoning` checks the level against the active model before anything changes
(`thinking_level_unsupported` with `details.supported`); `--scope turn` changes only the current
level, `session` (the default) also the model's remembered one.

A runtime fallback switch writes ONE `milestone` row to each active outbound binding of the session
subscribed to milestones. Its `text` is the sentence ("switched to openai/gpt-y after a provider
error on anthropic/claude-opus-5-5") and it carries
`model_change: {from: {provider, id}, to: {provider, id}, reason}`. Only such a row has
`model_change`.

## Sending

A bindingless `send` delivers as `cli:<uid>`. `--mode auto` (the default) starts a turn on an idle
session and otherwise queues behind the running turn, like `follow_up`; only `steer` enters a
running turn, and it needs `--expected-turn` (the target's turn epoch): a missing epoch is
`invalid_arguments`, a changed one `turn_conflict`. A target with no live endpoint gets
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

`send --binding <id>` is the connector inbound path: the message is delivered to the binding's
session as `binding:<id>`, and `--idempotency-key` is the platform's event id, so one platform
message is admitted once. A target, when given, must be the binding's session.

- **Mode.** Without `--mode` the message takes the binding's `inbound_mode`. `--mode` sets it per
  message, capped by the binding: `follow_up` is allowed on an `auto` binding, but `--mode auto` on
  a `follow_up` binding is refused `invalid_arguments` (exit 1, `details: {binding_id, mode,
  inbound_mode}`). It is never silently downgraded. So one binding per thread can deliver the
  owner's messages as `auto` and everyone else's as `follow_up`. `--mode steer` and
  `--expected-turn` are usage errors (exit 2): a binding message never steers.
- **Author.** `--author-id <platform-user-id> --author-name <display>` (plus an optional
  `--author-user-id <id>`, the omo user the connector mapped them to) names the human who wrote the
  message, as the connector authenticated them. Author flags are accepted only with `--binding`, and
  `--author-id` and `--author-name` go together; anything else is a usage error (exit 2). Each field
  must be non-empty, at most 256 characters, and a single line: a control character, newline or
  Unicode line separator is `invalid_arguments` (exit 1). The author is stored on the delivery's
  external origin and rendered in the provenance header, outside the body, as JSON-quoted fields:
  `author="Jane Doe" author_id="U123"` (and `author_user_id="..."`). Brackets inside a value are
  escaped as `\u005b`/`\u005d`, so the body or a display name can never add or close a header
  field; a body that says `author=owner` is still just the body. `actor=` stays the binding's
  account, the bot the connector speaks as.
- The SDK takes the same: `send({ binding_id, text, mode, author: { platform_user_id, display, user_id? } })`.
  An `author` without `binding_id` is `invalid_arguments`.

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
| One sender to one target | bursts of 8, then one every 5 s; a binding sender is keyed by binding and author (`binding:<id>#author:<platform user id>`), or by the binding alone when the message names no author | `overloaded` with `retry_after_ms` |
| One turn | reaches at most 16 sessions | `overloaded` |
| One causal chain (a message and the messages it caused) | 4 hops, 64 deliveries, 7 days | `loop_detected` |
| Replies | a direct reply to the session that messaged this one, or a send to itself | `loop_detected` |
| An undelivered message | expires after 24 hours (or when its binding expires) | the row ends `refused` |

Answers to another session flow back through `read`, `report` and `answer`, not through a reply.

A connector treats `overloaded` as back-pressure, not as a lost message: nothing was written, so
it queues the message and retries the same `send` (same `--idempotency-key`) after
`error.details.retry_after_ms`. The author id that keys a bucket is whatever the connector passes:
the gateway trusts the local connector to authenticate its humans, and a connector that varied it
per message would still be bounded by the target's 128-message backlog. It passes `--author-*` on every message it can attribute, so one
busy human in a thread spends only their own budget; without an author every human in the thread
shares the binding's one bucket.

## Connector loop

```bash
id=$(omo thread bind my-session --platform custom --account bot --chat c1 --thread t1 --json | jq -r .binding.binding_id)
omo thread send --binding "$id" --idempotency-key evt-1 --author-id U123 --author-name "Jane Doe" "hello from outside"
# Post each outbox row, then ack exactly the row that was posted, with the platform's message id.
omo thread outbox "$id" --json | jq -c '.rows[]' | while read -r row; do
  cursor=$(jq -r .cursor <<<"$row")
  posted=$(post_to_platform "$row")     # your connector: returns the platform message id
  omo thread ack "$id" "$cursor" --provider-message-id "$posted"
done
token=$(omo thread outbox "$id" --after 0 --json | jq -r '[.rows[] | select(.event == "question" and .question_state == "pending")][0].reply_token')
omo thread answer --binding "$id" --token "$token" --author-id U123 --author-name "Jane Doe" "yes"
```

A question row carries a `reply_token`. `answer --author-id <id> --author-name <display>
[--author-user-id <id>]` names the human who answered (validated like a `send` author); it is recorded
on the question's outbox row as `answered_by` and returned in the answer result, so the outbox keeps
who answered. The answer must arrive through the binding that asked:
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

Both outcomes in the paragraph above belong to a takeover only: an answer that took over an
expired claim. A normal claim (nothing to take over) that the session refuses because it no longer
waits on the question (`question_already_resolved`, `unknown_extension_ui_request`,
`unknown_request`) is `stale_token` (exit 1), and the question stays `pending`. An answer given in
the terminal or Desktop is not written back to the outbox, so a connector that lists pending
questions keeps showing that one until the question-closure follow-up below lands.

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

### Question-closure follow-up

Not included yet: a question that ends inside the session (answered in the terminal or Desktop,
timed out, cancelled) is not reported to its binding. The reserved `question_closed` event and the
reserved `expired` and `cancelled` question states ([Reports and the outbox](#reports-and-the-outbox))
are its contract; their producer is not part of this release. Until it lands, a connector learns
that such a question closed only from a refused answer: `already_answered` after a takeover,
`stale_token` on a normal claim.

## Bindings

A binding attaches one session to one external thread, named by `(platform, account, chat,
thread)`; `--thread` defaults to `@chat` (the chat itself). `--platform` is one of `discord`,
`telegram`, `slack`, `notion`, `feishu`, `herdr` or `custom` (any other connector). Nothing here talks to a chat platform:
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
- `unbind` and `rebind` follow the same local single-user trust model as `bind`: any session or
  CLI caller on this agent dir may unbind or rebind any binding, not only the session it is
  attached to. `--revision` protects against a stale write, not against another local caller.
  Run the gateway only for one local user.

Claimant liveness: a claim records the claiming process's pid and start time, so a pid that was
reused after the claimant died is not mistaken for it. On win32 there is no start-time source, so
liveness would rest on the pid alone; that is why `omo thread` and the gateway endpoints refuse
win32 today, and Windows support requires a real start-time source first.

## Reports and the outbox

`report` writes a row to a binding's outbox for the connector to post. Only the session a binding
is attached to reports through it (`scope_denied` otherwise), only while the binding is active
(`binding_inactive`) and subscribed to that event (`unsupported`). From the session's own
`thread_report` tool, a report without a binding goes to the ORIGINATING binding: the one whose
message the session is answering now. A message from another thread that arrives while the run is
going waits behind it and does not change that; once the session takes that queued message up (after
its answer to the first, even before the session goes idle), reports answer the new message's thread.
When one answer covers messages from two bound threads (a steer, or several queued messages taken up
together), a report without a binding is refused and names both. So is one whose answer covers a
bound thread's message and a user message (typed while the thread's message runs, or the reverse)
while the session has another active outbound binding: the answer has two possible origins, so the
report must name its binding. With the thread's binding as the session's only outbound binding,
both inputs can only be answered there, and the report goes to it.

The session cannot tell where a user message came from: senpi gives a prompt typed in the terminal
and a message an extension sends with `sendUserMessage` the same shape. So these all count as typed
input: a prompt, steer or follow-up typed in the terminal, a non-blocking ask_user answer (also when
a thread's user gave it), a stop-hook follow-up, and `/remember`. And after the session's final
answer (a reply without a tool call), any new message the run takes up starts a new answer: a user
message, a bound thread's message, or another extension message that starts a turn, such as a
delegated task's result. When the session has several active outbound bindings, a report without a
binding is therefore refused (never misrouted) when its answer covers a bound thread's message and
one of these user messages, and when it follows such an extension message that arrived after the
final answer, since that answer covers no bound message. Name the binding in those cases.

Otherwise, and always for `omo thread report`, which
runs outside the session, a report without `--binding` goes to the session's only active outbound
binding; a session with none or several must name `--binding` (`invalid_arguments`, with the
`binding_ids` to choose from). Nothing is ever copied to the session's other bindings.

- `milestone` and `report` rows are written at once. The first `--provider-message-id` acked for
  a milestone becomes the binding's `progress_message_id`, and later milestone rows carry it as
  `edit_message_id`, so a connector can edit one progress message in place.
- `question` needs `--request-id`, the session's pending request id, and returns the
  `reply_token` the answer must carry. `--request-kind` says which request that id is (`question`,
  `select`, `confirm`, `input` or `editor`); it decides the answer forms above. Without it the answer
  goes out in every text form, and as `confirmed` for a yes/no word (see above).
  Another kind name is `invalid_arguments`, and so is `--request-kind` on a non-question report.
  A question row's `question_state` is `pending` or `answered`. Two more values are reserved and
  not written yet: `expired` (the question timed out in the session) and `cancelled` (it was
  cancelled or closed without an answer). A connector should treat either as a closed question
  that takes no answer.
  An outbox row's `event` is `milestone`, `report`, `question` or `completion`. One more value is
  reserved and not written yet: `question_closed` (a question ended in the session without an
  answer through the thread). A connector should skip a row whose `event` it does not know.
- `completion` is only armed (see below): it answers `armed: true` and `cursor: null`, and its
  row appears when the session settles.

`outbox <binding-id>` reads rows in cursor order. Cursors are numbered across all bindings of the
store, so one binding's cursors increase but skip numbers; a gap is another binding's row, never a
lost one. Without `--after` it continues after the
acknowledged cursor; `--after <cursor>` re-reads from an older one. `ack` is idempotent: an older
or equal cursor changes nothing (`changed: false`), and a newer cursor that names no row of this
binding (past its newest row, or another binding's row) is `cursor_invalid` and acks nothing. Acked rows are kept 30 days after their ack; unacked rows live as long as their
binding plus 30 days. A detached binding's outbox stays readable.

Delivery between the outbox and the platform is **at-least-once**. A row stays unacked until the
connector acks it, so a connector that dies after the platform accepted a post but before its
`ack` reads the same row again and posts it again. `(binding_id, cursor)` is the row's stable
identity: a connector that must not double-post records it with the platform message (or in its
own store) and skips a row it already posted. The loop is: read, post, then
`ack <binding-id> <cursor> --provider-message-id <id>` for the row just posted.

`outbox --ack` reads a page and acks through its newest row **before anything was posted**. It is
a convenience for scripts that only drain or inspect an outbox; a connector that uses it loses
every row of the page if it crashes before posting them.

### Waking on new rows

`<agent dir>/gateway/outbox.marker` is the outbox wake signal. It is rewritten after every outbox
row insert (a `report`, a `question`, a settled `completion`), in the same write transaction, as a
temp file renamed over the marker, so it is never seen half written. Its content is
`{"binding_id", "cursor", "written_at"}` of the newest insert, across all bindings. It is a wake
hint only: on a change the connector re-reads its own bindings' outboxes with `outbox`, and it
never treats the marker's content as the list of new rows (two inserts may land between two
reads). Watch the `gateway/` directory for events on `outbox.marker`, not the file itself: the
rename replaces the file, which ends a watch on the old one. The marker does not change on
deliveries, acks or any other store write. A connector that cannot watch files polls `outbox`.

The SQLite WAL file (`gateway.sqlite-wal`) is not a supported wake signal. It changes on every
delivery to any session, on checkpoints, and when connections open or close, and it is removed
when the last connection closes, which silently ends a watch on it.

### Completion arms

A completion is opt-in. Only a session with an arm (from `report ... completion`, here or through
its `thread_report` tool) writes one; every other session settles without touching the gateway
store. The arm is durable: the store row is the source of truth, and it is kept until its
completion is written, with the outcome of the run that settled (`completed`, `failed` or
`cancelled`), never at an intermediate turn end.

A completion row's `text` is the text given when the completion was armed (`report ... completion
<text>`), not the model's reply, and its `outcome` is how the run ended. A connector that needs the
answer itself has the session post it with `report` (`thread_report` from inside the session), or
reads the transcript with `omo thread read`.

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

## Retention

The gateway store keeps a delivered message's body and bookkeeping only as long as something can
still read it. Pruning runs inside the store's own write transactions (a send, a binding or report
operation, an outbox read), at most once an hour unless the previous pass hit its bound of 256 rows
per table, so it never adds a write when nothing else writes.

| Rows | Kept for |
| --- | --- |
| A delivered (`applied`) or refused message, with its body | 30 days after its last change, and longer while its idempotency receipt is kept |
| An undelivered, admitting or admitted message | until it is delivered, refused or expires (never pruned) |
| Idempotency receipts | 30 days |
| A causal chain's loop-guard record | until the chain's 7-day lifetime ends; a later continuation is refused `loop_detected` either way |
| A sender's rate bucket | until it is idle for a full refill (40 s), which is exactly a fresh bucket |
| Acked outbox rows | 30 days after their ack |
| Unacked outbox rows | as long as their binding, plus 30 days after it closes |
| A detached or expired binding and its outbox cursor | 30 days after it closed, once no outbox row, completion arm or undelivered message of it remains; after that `outbox` answers `not_found` |
| A session's sequence counter and incarnation | while any delivery, binding, outbox row or completion arm names the session; rebuilt on its next use |

## JSON

With `--json`, stdout is exactly one JSON value, also on failure. `list` prints the thread array;
every other subcommand prints the full result.

| Subcommand | `--json` on success |
| --- | --- |
| `list` | `[{thread_id, name, status: live\|resumable, cwd, created_at, updated_at: <ISO 8601 string>\|null, surface: tui\|desktop\|child\|daemon, endpoint: {kind: rpc_host\|tui, socket, routing_id}, alive, model: <model>\|null, error_note?, ...}]`; live and degraded rows use the same bounded final-record policy, so `updated_at` is null rather than an older timestamp when the final complete valid entry's timestamp cannot be proved. After live and degraded rows are combined, the public list sorts known `updated_at` newest first, then unknown activity last, with `thread_id` ascending for ties. A live row also carries its endpoint's own `list_sessions` fields (`sessionId`, the routing handle; `durableSessionId`, `sessionPath`, `attachments`, `kind`, `socket`, `endpoint_kind`) |
| `create` | `{kind:"ok", thread: {thread_id, name, status, cwd, ..., model: <model>}, deduplicated: false}` |
| `models` | `{kind:"ok", thread_id: <id>\|null, current: <model>\|null, available: [{provider, id, name, thinking_levels}]}` |
| `set-model` | `{kind:"ok", thread_id, model: <model>}` |
| `set-reasoning` | `{kind:"ok", thread_id, level, scope: session\|turn}` |
| `send` | `{kind:"ok", thread_id, delivery_id, message_seq, delivery: {kind: queued\|queued_offline\|started\|steered, ...}, effective_mode, endpoint_kind: rpc_host\|tui\|null, deduplicated}` |
| `read` | `{kind:"ok", thread_id, items: [{seq, role: user\|assistant\|tool\|system, content}], truncated, next_cursor?, source, source_incomplete?, error_note?, model: <model>\|null}` |
| `bind` | `{kind:"ok", binding: <binding>, deduplicated}` |
| `unbind` | `{kind:"ok", binding, already_closed, in_flight: [delivery ids], deduplicated}` |
| `rebind` | `{kind:"ok", binding, closed: [delivery ids], deduplicated}` |
| `bindings` | `{kind:"ok", bindings: [<binding>], next_cursor}` |
| `report` | `{kind:"ok", binding_id, revision, event, cursor, reply_token, armed, deduplicated}` |
| `answer` | `{kind:"ok", binding_id, cursor, session_durable_id, answered_by: {platform_user_id, display, user_id?} \| null}` |
| `outbox` | `{kind:"ok", binding_id, revision, status, rows: [{cursor, binding_id, revision, event, text, state, created_at, edit_message_id, provider_message_id, reply_token, question_state, outcome, answered_by, model_change?}], next_cursor, acked_cursor, acked?}`; `model_change` is only on a fallback milestone row (see Models); `answered_by` is the author an answer named (`--author-*` on `answer`), `null` for an answer without one and for every row that is not an answered question |
| `ack` | `{kind:"ok", binding_id, acked_cursor, changed}` |

`<binding>` is `{schema_version, binding_id, revision, status, platform, account_id, chat_id,
thread_id, root_message_id, progress_message_id, session_realm_id, session_durable_id,
direction: {inbound, outbound}, inbound_mode, outbound_events, policy_id, created_at, updated_at,
lease_started_at, ttl_seconds, expires_at}`.

`<model>` is `{provider, id, thinking_level, provenance: auto|set|fallback, set_by: config|user|lead|null, reason}` (see Models).

A failure is `{kind:"error", error: {code, message, next_action, details?}}`; the code is one of
the thread error taxonomy (`packages/omo-senpi/src/components/thread/AGENTS.md`, "Error taxonomy").
The failures the CLI answers itself use the same shape: a usage error is `invalid_arguments`
(exit 2), and win32 or a runtime without `node:sqlite` is `unsupported` (exit 4).

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | done |
| 1 | the gateway refused (read `error.code`: `not_found`, `scope_denied`, `binding_mismatch`, `turn_conflict`, `loop_detected`, `answer_in_progress` (retry after a moment), `already_answered` (stop), `invalid_arguments` for a `--mode` above the binding's `inbound_mode` or an author field that is empty, too long or not one line, ...) |
| 2 | usage: unknown subcommand or option, a missing required flag, a non-integer where a number goes, a `--mode` other than `auto`/`steer`/`follow_up` (or `steer`/`--expected-turn` with `--binding`), a `--direction` other than `in`/`out`/`both`, an empty or whitespace-only `send` text, `--author-*` without `--binding` or without both `--author-id` and `--author-name`, a `--set-by`, `--scope`, `--thinking` or `set-reasoning` level outside its set, `--set-by` on `create` without `--model`, an empty `set-model` model (the SDK is not loaded) |
| 3 | `host_unavailable`: no endpoint answered where one was needed: `list`, `read` of a live session, `answer`, `create` and `models` without a thread (the operator endpoint). Never for `send` (it queues offline), nor for `bind`, `rebind`, `report` or `bindings --session`, which resolve the session like a send, including one known only from its session file |
| 4 | unsupported: win32 (no unix sockets), or a runtime without `node:sqlite` |
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

The model verbs are `create`, `models`, `setModel` and `setReasoning`, with the CLI's fields in
snake case (`fork_from`, `set_by`; `thread`, `model`, `provider`, `thinking`, `level`, `scope`).

`pluginRoot` is `<omo-ai install>/plugin`. Every method resolves to the same data union as the
CLI's JSON; nothing throws for a refusal. Pass `engineStatusAll` (a function returning the stdout of
`omo host status --all --include-workers --json`) to choose how the engine is run; without it the SDK runs
the engine CLI itself, and when no engine can enumerate it falls back to the endpoint registry on disk.
