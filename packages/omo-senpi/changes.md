## 2026-10-01 - In-process task children honor the caller's settings (#9353)

- `components/task/runtime-context.ts` captures the parent session's project-trust decision, and `engine-runners.ts` passes it to every in-process child, so the child's settings include the project layer exactly when the parent's do. `plugin/extensions/omo-task.js` regenerated on linux/amd64 (node 24, bun 1.4.2) for the senpi-task change.

## 2026-10-01 - Windows RPC kills tolerate repeated Bun startup advisories (#9228)

- The task bundle treats any number of known Bun child-reaper advisory lines as advisory-only stderr for Windows code-1/no-signal exits. Any different stderr line remains a crash diagnostic.

## 2026-10-01 - Windows task-child parity regression (#9274, #6709)

- The parity regression now reloads the in-process child loader beside the process child's builtin loader policy and pins equal platform-specific builtin names plus `web_search`, avoiding Windows CLI cold starts while the existing surface tests retain shared-parent and session-default coverage.

## 2026-09-30 - Task children keep senpi builtin tools in the default in-process mode (#9274, #6709)

- The task extension bundle now gives in-process children senpi's builtin-only extension surface while continuing to suppress the parent's path-loaded extensions. The parent tool-capture wrapper stops after omo component registration, so builtin factories senpi loads later are not re-injected as raw custom tools. A mock-provider integration test compares the actual in-process and process child tool payloads and requires `web_search`.
- `plugin/extensions/omo.js` and `omo-task.js` regenerated on linux/amd64 (node 24, bun 1.4.2) for the senpi-task change; the extension freshness checks pass.

## 2026-10-01 - Geeky lanes: Astra at high, GPT-6.1 Sol Fast leads Geeky · Normal (#9372)

- `src/components/model-profile/builtin-profiles.ts`: `geeky-heavy` runs `gpt-6-astra` at `high` (was `xhigh`). `geeky-normal`
  leads with `gpt-6.1-sol-fast` (medium, `chatgpt-subscription|openai`), then plain `gpt-6.1-sol` (medium, same lanes), then the
  unchanged `gpt-5.6-sol` (medium, all four GPT lanes). Plain 6.1 Sol stays behind the Fast tier so a registry without
  `gpt-6.1-sol-fast` still lands on 6.1 Sol rather than dropping to 5.6 Sol.
- `scripts/qa/model-profile-e2e-scenarios.mjs`: both geeky-heavy scenarios expect thinking `high`; new `geeky-normal-sol-fast`
  serves 5.6 Sol, 6.1 Sol and 6.1 Sol Fast and expects the Fast tier at medium.
- Tests: `index.test.ts` starts a session on each geeky-normal registry shape (Fast served -> Fast medium; Fast absent ->
  plain 6.1 Sol medium) and geeky-heavy (Astra high); removing the Fast rung fails the Fast case.

## 2026-10-01 - session gateway review round 8: receipt batch per call, completion arms per run, recovery-key bound (#9222)

- `gateway/store-retention.ts` / `store-relay-ops.ts` / `store-ops.ts`: a call that reuses an expired key deletes at
  most one batch of receipts in total. The receipt check deletes the expired receipt under the call's own key, and the
  sweep that follows deleted a full batch besides, so a peer tool call, keyed relay mutation or keyed send could remove
  `RETENTION_SWEEP_BATCH + 1` receipts. The key's deletion now counts against the sweep's receipt batch, and a batch
  used up that way still makes the next sweep due at once.
- `gateway/completion.ts` / `store-relay-ops.ts`: a settling run owns the completion arms up to the newest `arm_seq`
  the session knew of when it settled (`emitCompletions` `through_arm_seq`, replacing the `armed_through` time). The
  time cutoff assigned an arm made in the same millisecond as an earlier run's settle to that earlier run, so with an
  outstanding first write and an equal clock reading the two runs collapsed into one completion with the second text
  and the first outcome. A later run's arm always has a higher sequence number, so each run's completion lands with
  its own text and outcome, in run order. `thread_report` now hands the tracker the arm's `arm_seq` (kept out of the
  tool and SDK results), and a durable arm picked up at startup or on a wake arms with the newest stored sequence
  (`store.latestCompletionArm`).
- `tools.ts`: the keys a tool surface keeps for recovering a receipt whose admission reply was lost are bounded. Each
  key is kept until the receipt it may have left expires (admission time + the 30-day receipt retention), at most
  `RECEIPT_RECOVERY_MAX_KEYS` (4,096) at once, and disposing the surface clears them; the set grew by one key per
  failed admission for the surface's lifetime. When it is full, a call under a new key is refused `overloaded`
  (`details.budget: "receipt_recovery"`) before its admission and runs nothing, so no key that may still need
  recovering is dropped; a retry of a kept key still recovers.

## 2026-10-01 - session gateway review round 7: receipt retention, completion arms, replay after unbind, lost receipt replies (#9222)

- `gateway/store-relay-ops.ts` `toolReceiptBegin`: a peer tool call's receipt admission runs the bounded retention
  sweep when one is due, as an enqueue, relay mutation or outbox read does. Since round 6 narrowed the receipt check
  to its own key, traffic made only of peer tool calls (`thread_list`, `thread_read`, `thread_rename`, ...) never
  swept, so their expired receipts were kept indefinitely; each admission now deletes at most one batch.
- `gateway/schema.ts` / `store-relay-ops.ts`: every completion arm is its own `completion_arms` row (`arm_seq`). The
  table kept one row per session and binding, so when a run settled while its completion write was held and the next
  run armed the same binding again, the replacement destroyed the earlier run's arm and only the later completion was
  ever written. Each write now consumes the arms made by its run's settle, so both completions land on the binding in
  run order with their own text and outcome; two arms of one binding within a run still make one row, the newest text.
- `gateway/relay.ts` `inbound` / `gateway/store-ops.ts`: a connector event retried after its binding closed is answered
  through the same receipt classification a retried send uses (`recoverDelivery` over `classifyReceipt`). The closed
  binding's replay read only completed receipts, so an event the session had applied while both receipt writes failed
  (the receipt stays `prepared`) was refused `binding_inactive` after an unbind; it now replays the delivered outcome
  from the durable row and completes the receipt, an undecided one stays `idempotency_in_progress`, and a new or edited
  event is still `binding_inactive`. `store.completedDelivery` became `store.deliveryReceipt`.
- `tools.ts`: a receipted thread tool retried after its receipt admission failed without a reply runs the call. The
  store worker can commit the `prepared` receipt and exit before replying, and every retry of the same key from this
  process then read that row as `idempotency_in_progress` until it expired, though nothing had run. The facade notes
  such a key, and a retry that finds this instance's prepared row while no invocation of the facade runs the key takes
  it up and runs the call once; a call still running under the key keeps the retry `idempotency_in_progress`.

## 2026-10-01 - session gateway review round 6: receipts, questions, retention, bindings snapshot, causes, session facts, identifiers (#9222)

- `tools.ts`: a receipted thread tool whose receipt the store cannot admit answers as data instead of throwing:
  `overloaded` when another process holds the store's write lock past the wait bound, `internal_error` for any other
  store failure. Nothing has run at that point, so a retry runs the call once.
- `component.ts` / `gateway/registration.ts`: a session waiting on a question is in phase `waiting_question`, so a
  steer into it is refused `not_steerable` as the delivery table says. The phase holds from the `tool_execution_start`
  of an ask_user call that waits for its answer (`ask_user_question` with `waitForAnswer`, `request_user_input` with
  `wait_for_answer`) to that call's `tool_execution_end`; `auto` and `follow_up` still queue behind it. The phase was
  never reported, so such a steer was admitted into the blocked turn. A question that does not wait blocks nothing.
- `gateway/store-ops.ts`: a retried send whose delivery the target already decided (admitted, applied or refused)
  replays that outcome and completes the receipt even when this process began the receipt. When both receipt writes
  of the first call failed (for example at the lock-wait bound), the receipt stayed `prepared` under this store, and
  every retry answered `idempotency_in_progress` until the receipt expired; an undecided row is still in progress.
- `gateway/store-retention.ts`: expired receipts are deleted a batch (`RETENTION_SWEEP_BATCH`) at a time like every
  other table, and a full batch makes the next sweep due at once. The sweep, and the receipt check of every keyed
  call (`enqueue`, a relay mutation, `toolReceiptBegin`), used to delete every expired receipt in one statement, so a
  store reopened after a long idle cleared its whole backlog inside one write transaction; a receipt check now clears
  only the expired receipt under its own key.
- `gateway/store-ops.ts`: a send continues the causal chain of the delivery its run consumed while that delivery's
  row is still `admitting`, which is the state the row keeps when the runtime took the message but its outcome write
  gave up at the lock-wait bound. Such a send was refused `invalid_arguments` (`unknown_cause`) until the drain's
  retry recorded the outcome; a delivery that is only queued, or addressed to another session, is still refused.
- `session-facts.ts` `readSessionFacts`: the tail window drops its first line only when the window cut it (the byte
  before the window is not a newline). A rename line starting exactly at the tail window's first byte was dropped, so
  the session listed with `name: null`.
- `gateway/bindings.ts`: a binding identifier carrying a C1 control (U+0080-U+009F, NEL included) or a Unicode line or
  paragraph separator (U+2028, U+2029) is refused `invalid_arguments`, like a C0 control. NEL passed the check and
  reached the `actor=` provenance header raw, since the header's whitespace class does not cover it.
- `gateway/schema.ts`: `bindings` gets an `INTEGER PRIMARY KEY AUTOINCREMENT` key (`seq`, the rowid) with `binding_id`
  kept `UNIQUE`; schema v1 is unreleased, so the table is defined that way from the start. The `thread_bindings`
  snapshot watermarks on the rowid, which SQLite reused after retention deleted the newest binding, so a binding made
  later could appear in a later page of an older snapshot.
- `gateway/relay.ts` `inbound`: a connector that retries an event the session already took gets the stored result
  back (`deduplicated: true`) even after the binding was unbound or expired; only a new event, or the same id with
  other content, is refused `binding_inactive`. The inactive check ran before the receipt replay, so a connector that
  lost the ACK was told a delivered message was refused. `store.completedDelivery` is the plain read behind it.
- `gateway/legacy-mailbox.ts`: only the legacy host's exact turn id spelling (`turn-N`, no leading zeros) becomes a
  migrated steer's epoch. Bare digits (`1`) and leading-zero ids (`turn-01`) were read as that turn too and steered
  into it; they now stay without an epoch and are refused `turn_conflict`.

## 2026-10-01 - session gateway review round 5: legacy steers, degraded legacy host, causes, outbox acks, registration, completions (#9222)

- `gateway/legacy-mailbox.ts`: a legacy `steer` keeps its `expected_turn_id`. The host's `turn-N` id becomes the
  gateway turn epoch `N`, so a migrated steer for the turn the target is still running steers into it and one for an
  earlier turn is refused `turn_conflict`; the import used to store no epoch, which refused every migrated steer.
- `live-surface.ts`: the legacy endpoint keeps the session files `host status --all` reports for it, as dev did. When
  the legacy host stops answering, its threads are listed from disk as `resumable` with an `error_note` and read from
  their JSONL, instead of disappearing from `thread_list`.
- `component.ts`: a run's causal cause (`RunContext.cause`, sent as `cause_delivery_id`) is the newest delivery whose
  message the model consumed (the engine's `message_start`, the same edge `RunContext.consumed` reads), not the newest
  one admitted. While thread B's message waited behind A's run, a `thread_send` from A's run continued B's causal
  chain, charging B's hop, cycle and budget guards; it now continues A's, and a send after the engine drains B's
  follow-up continues B's. The registrant's `onAdmitted` hook, which only fed the cause, is gone.
- `store-relay-ops.ts` `ackOutbox`: a newer cursor must name one of the binding's own outbox rows. Cursors are global
  across bindings, and the check used to compare only with the binding's newest cursor, so acking binding A with
  binding B's cursor marked A's unread rows below it acked. Such a cursor is now `cursor_invalid` and acks nothing.
- `gateway/registration.ts`: the session's incarnation is recorded before its control endpoint is registered, and a
  failure to record it fails the registration (`{ status: "failed" }`, logged) with no endpoint exposed. The endpoint
  used to go live first, so its first drain could run under the previous runtime's incarnation, and a failed record
  was only logged while the registration still succeeded, which left earlier reply tokens valid after a restart.
- `gateway/completion.ts`: every settled run's completion is written with that run's outcome. A run that settled while
  an earlier run's write was outstanding used to be dropped, so only the earlier outcome was recorded; it now waits and
  is written after it. Each write passes the time its run settled (`emitCompletions` `armed_through`) and consumes only
  the arms made by then, so a delayed or retried write no longer takes a later run's arm with the earlier outcome.

## 2026-10-01 - session gateway review round 3: store recovery, legacy mailbox import, retention, binding defaults (#9222)

- `gateway/store.ts`: a failed open is no longer cached. The worker of a rejected `init` is terminated and the open is
  cleared, and a worker exit clears it too, so the next call starts a fresh worker (in-flight requests fail and are not
  replayed). Pending requests are tied to the worker they were posted to, so a dying worker never fails its successor's
  open. `store.test.ts` holds `BEGIN IMMEDIATE` through the first open and terminates a live worker.
- `component.ts`: production passes `legacyMailboxDirectories: [<thread state dir>/mailbox]`, and `session_start`
  imports that pre-gateway `thread_send` mailbox once when a `mailbox.jsonl`/`mailbox.json` is on disk (a session
  without one still creates no database). `store-ops.ts` `migrateLegacyMailboxes` reports an item whose target is not a
  durable id (`legacy_mailbox_skipped`, logged, and recorded in the directory's `gateway_meta` row) and still marks the
  directory migrated, because no later open can deliver it; a mailbox that cannot be read is logged and left unmarked,
  so the next start retries.
- `gateway/process-identity.ts`: a claimant's start time is recorded as `epoch:<seconds>`, read from `ps -o lstart=`
  run with `LC_ALL=C` and `TZ=UTC`, so a host started without a locale and a terminal in `fr_FR.UTF-8` (or another
  time zone) agree on a live process instead of judging it dead and re-queueing its admitted rows. A start time
  without the prefix (written by a pre-release build of the gateway, in that process's locale) cannot be compared,
  so it counts as live while its pid exists, like an unreadable one. `process-identity.test.ts` records and checks
  in two processes with different locales and time zones.
- `gateway/store-retention.ts` (new): a bounded retention sweep for the tables nothing pruned. Delivered and refused
  deliveries 30 days after their last change (not while a receipt points at one), causal edges and roots once the root
  expired, rate buckets idle for a full refill, closed bindings 30 days old with no outbox row, completion arm or open
  delivery, their `outbox_cursors`, and `session_meta` rows nothing references. At most 256 rows per table per sweep,
  hourly unless the last sweep hit the bound; it runs at the end of an enqueue, a relay mutation or an outbox read, so
  opening a current store still takes no write lock. Retention periods: `docs/reference/omo-thread.md` "Retention".
- `thread_report` without `binding_id`: the default is the binding of the messages the session's CURRENT answer is
  for (`component.ts` `RunContext.consumed`: the deliveries whose `session_control_delivery` message entered the
  model's context since its last final answer, read from the engine's `message_start`; cleared at `agent_settled`),
  carried into the report as `origin_delivery_ids`. It used to be the binding of the newest admitted delivery, so a
  message from thread B queued mid-run took thread A's report or completion; and a run origin fixed at admission
  would have sent B's own answer to A, because senpi drains a queued follow-up after the final answer and before
  `agent_settled`. That drain, or a prompt typed in the terminal after the answer, starts a new group. Messages from
  two bound threads in one answer (a steer at a tool boundary, or `followUpMode: "all"`) are `invalid_arguments`
  naming both `binding_ids`. A bound message answered together with a prompt typed in the terminal (a local steer
  into thread A's run, or the reverse; `RunContext.local`, carried as `origin_local_input`) has two possible origins
  and is `invalid_arguments` naming the session's active outbound `binding_ids`, where it used to go to A, but only
  while the session has an outbound binding other than A. With A as its only outbound binding, both inputs can only be
  answered in A, so the report and the completion go to A: a thread user who answers a non-blocking ask_user question
  mid-run (senpi steers the answer in as a `user` message, the same shape as a typed prompt) no longer blocks A's
  implicit report. Without a bound message (a prompt the user typed, `omo thread report`) the session's only
  active outbound binding is used, and several are `invalid_arguments` naming their `binding_ids`.
  `report-origin.test.ts` drives two threads through the SDK and the real `thread_report` tool, with the engine's
  event order (`agent_end`, then the follow-up's `agent_start` and `message_start`, no `agent_settled` between).
- `sdk.ts` `bind`/`rebind`/`report`/`bindings --session` and the relay tools that name another session resolve it
  through `tools/internals.ts` `resolveStoredSession` (the offline host view plus `sendAddressBook`), as a send
  does: with nothing running they no longer fail `host_unavailable` (exit 3, or 5 on a stale socket), and a session
  known only from its session file resolves by id or name. `offline-address.test.ts` covers the SDK and the tool.
- Bindings take `notion` and `feishu` as native platform names (`schema.ts` CHECK, `bindings.ts` `BINDING_PLATFORMS`,
  the `thread_bind` param union), decided before release because widening a column CHECK later needs a table rebuild.
- `schema.ts` v2: the outbox `question_state` CHECK admits `pending|answered|expired|cancelled`. `expired` and
  `cancelled` are reserved for question closure (a follow-up writes them from the session's terminal question
  outcome); nothing writes them here. Widened now because a CHECK change after release needs a table rebuild.
- `store-ops.ts` `requeueReleased` (with its `store.ts` method and worker op) is deleted: nothing called it. A released
  session's dropped deliveries come back through the `session_released` transcript check in `reconcile` on the next
  owner's side; a second path from `omo daemon adopt` would act from another process without that check.
- `store-relay-ops.ts`: `readOutbox` and `listBindings` put `ORDER BY ... LIMIT` in the SQL (bindings read one row past
  the page to know whether another follows) instead of loading every matching row and slicing. `relay.test.ts` pages an
  outbox; the bindings snapshot-cursor test already pages bindings.
- `tools/ports.ts` `ThreadToolSurfaceOptions.store` is required and `tools/gateway-services.ts` lost its fallback, which
  opened a second, separate database under `stateDirectory` when a caller passed no store. The legacy
  `session-control-qa.mjs` scenario opens its stores explicitly and disposes them at teardown.
- `live-surface.ts` `releaseReply`: a `release_session` reply counts as released only when it also names a
  `session_path` string; without one it is `release_failed`, so `omo daemon adopt` never relaunches with
  `--session undefined`.
- Docs (`docs/reference/omo-thread.md`, `thread/AGENTS.md`): `omo thread` creates and resumes no session (a connector
  opens one through the host API and binds it); a completion row carries the armed text, not the model's reply; the
  per-author rate bucket trusts the connector's author id and stays bounded by the target backlog.

## 2026-09-30 - thread activity round 2: strict records, one freshness policy, public ordering (#9222)

- `session-facts.ts`: the already-capped final record is now validated with `JSON.parse` before its top-level
  `timestamp` is trusted. Missing values, invalid literals/escapes, malformed nested values and trailing commas all
  produce unknown activity.
- `address-book.ts`: degraded/resumable session rows take `updated_at` from `readSessionFacts`, the same bounded
  freshness policy used by live fallback facts and host-status enrichment. Full-file parsing remains only for
  name/title metadata.
- `tools/read-ops.ts`: the final combined public list follows the sorted address book, so known activity is
  newest-first, unknown activity is last, and equal timestamps use ascending durable ids.
- Tests cover malformed JSON classes, host-status/degraded-list agreement on one partial file, and mixed live/dead
  public ordering.

## 2026-09-30 - thread facts: a bounded final-line timestamp or unknown activity (#9222 gate G1)

- `session-facts.ts`: `readSessionFacts` still reads bounded windows, then scans backwards at most 256 KiB to locate
  the final complete JSONL entry and validates that capped record before extracting its top-level `timestamp`. A partial,
  malformed or larger final line yields `updated_at: null`; it never publishes an older entry as newest.
- Thread summaries now allow nullable `updated_at`. Address-book ordering keeps known timestamps newest-first and
  places unknown activity last. Disk summaries no longer substitute file mtime for an entry timestamp.
- Tests cover the 160 KiB final-entry regression, truncated and over-cap final lines, normal files, bounded read
  volume, null sorting, and the omo-native host-status path.

## 2026-09-30 - thread gateway: binding authors, a per-message mode, the outbox wake marker (#9143, review of #9222)

- `gateway/author.ts` (new): `normalizeAuthor` checks an `ExternalAuthor` (`platform_user_id`, `display`, optional
  `user_id`). Each field must be non-empty and at most 256 characters, and a C0/C1 control, DEL or U+2028/U+2029 is
  `invalid_arguments`. `ExternalOrigin.author` (optional) keeps it on the delivery's envelope JSON, so the
  deliveries table did not change.
- `relay.inbound` takes `author` and `mode`. `mode` defaults to the binding's `inbound_mode`, and `auto` on a
  `follow_up` binding is refused `invalid_arguments` with `{binding_id, mode, inbound_mode}`, never downgraded;
  `steer` is refused. `relay.answer` takes `author` and returns `answered_by`.
- `provenance.ts` renders `author=` / `author_id=` / `author_user_id=` as JSON strings with `[`/`]` escaped, after
  `actor=`, so the body cannot forge or close header fields.
- `engine.ts`: a binding sender with an author keys the pair rate bucket by `binding:<id>#author:<platform user id>`
  (`EnqueueRequest.rate_principal`, read by `store-ops.ts` `takePairToken`); without an author it stays
  `binding:<id>`. The author joins the receipt's args hash.
- Schema v4 (additive): `outbox.answered_by TEXT`, NULL on older rows. Claim, confirm and mark-prior-delivered write
  it, and release clears it. `OutboxRow.answered_by` exposes it.
- `store-relay-ops.ts` `insertOutbox` rewrites `<agent dir>/gateway/outbox.marker` (temp file + rename, inside the
  insert's transaction) with `{binding_id, cursor, written_at}`. `paths.ts` `gatewayOutboxMarkerPath`.
- `sdk.ts`: `send({binding_id, author, mode})`; an author without a binding, a binding `steer` or a binding
  `expected_turn_id` is `invalid_arguments`. `answer({..., author})`.
- `extension/thread-sdk.ts` also exports `readSessionFacts`, which `omo host status --all` uses for `last_activity_at`.
- Tests: `gateway/relay-author-mode.test.ts`, the v3 -> v4 migration in `gateway/store.test.ts`, two `sdk.test.ts`
  cases. `relay-answer-kinds.test.ts` `downgradeToV2` also drops the v4 column, so its "v2 store" is a real v2 store.

## 2026-09-30 - thread gateway: one clock per store, and cross-process tests that do not wait on fs.watch (#9143)

- `gateway/store.ts`: `GatewayStore` exposes `now`, the clock its rows are stamped and expired against (the
  `now` option, else `Date.now`). `createInboxDrain`, `createGatewayEngine`, `createGatewayRelay`,
  `createGatewayServices`, the thread tools and the thread SDK default to `store.now` instead of reading `Date.now`
  themselves, and the component's completion writes use `store.now()`. Before, a drain or engine built on a store
  with an injected clock stamped and expired rows by the wall clock, so the two clocks disagreed: on 2026-09-30 the
  harness rows (stamped 2026-09-29 by the injected clock) read as expired to a drain built without `now`, and three
  tests failed on every run (`store.test.ts` release_session requeue, `engine.test.ts`
  lost_ack_and_durable_recovery, `claim-reconciliation.test.ts` "dropped it unwritten"). Production passes no clock,
  so `store.now` is `Date.now` there and nothing observable changes. `gateway/store-clock.test.ts` puts the store's
  clock in 2020 and fails on the old defaults whatever the wall clock reads.
- `gateway/cross-process.test.ts`: the tests learned the delivery id from an `fs.watch` event on the inbox directory.
  On macOS that watch drops events under load (a probe missed 9 of 60 creates made right after `watch()` and 27 of 60
  made by a child process), and the test then waited for an event that never came. The store writes the marker before
  either commit hook runs, so each test now reads it from the directory once the sender has died or printed `PAUSED`.
  No retries and no longer timeouts.

## 2026-09-30 - claude-code: acquire before the auth check, from the provisioned runtime, with progress (#9276)

- `src/components/claude-code/index.ts`: the component now also runs on `input`, which senpi's `prompt()` emits
  before `checkAuth` (`emitInput`, then `checkAuth`, then `emitBeforeAgentStart`), so a prompt from a
  `claude login`-only user downloads the executable before the ambient auth probe needs it. `before_agent_start` stays
  for turns an extension starts (they skip `input`), registered `previewSafe` and skipping the prompt-cache preview.
  The pin and cache root come from `claudeCodeRuntimeDir` (`OMO_PACKAGE_DIR`, else `dirname(execPath)`), since the
  compiled launcher pins the provisioned runtime there while `execPath` can still be the downloaded binary.
  A progress status (`omo-claude-code`: `Downloading Claude Code <version>: N% of M MB`, every 10%) shows while the
  tarball streams (`acquire.ts` `onProgress`). New `applyCachedClaudeCode` lets the compiled launcher point the engine
  at an already-downloaded copy before it starts.
- Limit: on the launch that downloads, the startup ambient probe may already have cached "not signed in" for 30 s
  (`availability.ts` `AMBIENT_STATUS_TTL_MS`); the next prompt after that window, and every later launch, resolve it.

## 2026-09-30 - model-profile e2e: lane-beats-recommended-models proves a real recommended-models switch (#9238)

- `scripts/qa/model-profile-e2e-scenarios.mjs`: `lane-beats-recommended-models` serves `mock-1`, `glm-5.3` and
  `gpt-6-astra` on `chatgpt-subscription` + `opencode-go`, so no provider serves its engine provider default
  (`gpt-6.1-sol`, `kimi-k3`). The session starts first-available on off-ladder `mock-1`, senpi's recommended-models
  builtin switches to `chatgpt-subscription/gpt-6-astra`, and Daily · Normal still wins with `opencode-go/glm-5.3` max.
  The old fixture's
  only `gpt-6-sol` entry was the engine's initial provider-default record, which senpi#2393 moved to `gpt-6.1-sol`;
  the builtin never switched there. `gpt-6-astra` keeps its ladder rung across senpi#2394's Sol-slot move.
- `scripts/qa/model-profile-e2e.mjs`: that scenario's checks skip the initial-model record. `started_off_recommended_ladder`
  requires the first `model_change` to be `mock-1`, and `recommended_models_switched_first` requires the builtin's
  `chatgpt-subscription/gpt-6-astra` change to come after it and before the lane's `opencode-go/glm-5.3`.

## 2026-09-30 - model-profile: Recommended leads its GPT-6 Sol slot with gpt-6.1-sol medium, gpt-6-sol behind it (senpi#2394)

- `src/components/model-profile/builtin-profiles.ts`: `recommended` replaces its `gpt-6-sol` (medium) rung with
  `gpt-6.1-sol` (medium) on `GPT_6_1_PROVIDERS` (`chatgpt-subscription|openai`), immediately followed by `gpt-6-sol`
  (medium) on the shared `GPT_PROVIDERS` ranking, so Copilot and OpenCode Zen, which do not serve 6.1 Sol, still resolve
  GPT-6 Sol. senpi#2394 makes the same switch in `RECOMMENDED_DEFAULT_MODELS`; OmO keeps the extra `gpt-6-sol` rung, and
  the header comment says so. The lanes are unchanged. Telemetry already carries `gpt-6.1-sol` (#9214).
- Tests: `builtin-profiles.test.ts` pins the seven-rung chain and the providers of both Sol rungs; `resolve.test.ts`
  resolves `chatgpt-subscription/gpt-6.1-sol` medium when the subscription serves it next to `gpt-6-sol`, and
  `github-copilot/gpt-6-sol` medium on a Copilot-only registry; `index.test.ts` applies both at session start.
  `scripts/qa/model-profile-e2e-scenarios.mjs` adds `unset-gpt-6-1-sol` and `unset-copilot-gpt-6-sol`.
- Docs: the Recommended ladder in `docs/guide/agent-model-matching.md`, `docs/guide/overview.md`,
  `docs/guide/installation.md` and `docs/reference/omo-json.md`.
- `plugin/extensions/` bundles regenerated on linux/amd64 (node 24, bun 1.4.2) for the chain change.

## 2026-09-30 - lsp: post-edit install nudges stay inside projects and appear once per server (#9223)

- `components/lsp/post-edit-outcome.ts` (moved out of `index.ts`) turns a daemon `not_installed` availability into the structured post-edit outcome, carrying `serverId`, `installDecisionTool` and a recorded decision.
- `components/lsp/index.ts` `handlePostEditDiagnosticsToolResult` classifies each edited file against the session cwd and the engine-resolved agent dir (`resolveSessionAgentDir`, else `resolveAgentHome`): files outside a project, in the agent dir, or in a temp dir get no nudge, and each server is nudged once per session (reset on compaction).
- `plugin/extensions/omo.js` regenerated on linux for the change above.

## 2026-09-30 - memory/kibitzer: connected-first sidecar model order (#9216)

- `components/memory/kibitzer/sidecar-connected-order.ts` (new) `orderKibitzerCandidatesByConnection`: with a known, non-empty availability list the first connected candidate leads and unconnected ones trail; none connected returns the providers to connect.
- `components/memory/kibitzer/sidecar-model.ts` `resolveKibitzerSidecarModel` applies it to category-sourced resolutions and returns `category_unavailable` when nothing is connected. The `task` tool path is untouched.
- `plugin/extensions/omo.js` regenerated on linux/amd64 (node 24, bun 1.4.2) for the change above; `build-extension.mjs --check` and `build-install.mjs --check` pass on the regenerated tree.

## 2026-09-30 - model-profile: Geeky · Normal leads with gpt-6.1-sol medium; telemetry knows the 6.1 Sol ids (#9214)

- `src/components/model-profile/builtin-profiles.ts`: `geeky-normal` is `gpt-6.1-sol` (medium) on `chatgpt-subscription|openai`
  (the new `GPT_6_1_PROVIDERS`: Copilot and OpenCode Zen do not serve 6.1 Sol, and every builtin rung must name a pair the
  product knows), then `gpt-5.6-sol` (medium) on the shared `GPT_PROVIDERS` ranking. The `recommended` row and every other
  profile are unchanged.
- `src/components/telemetry/model-vocabulary.ts`: `gpt-6.1-sol` and `gpt-6.1-sol-fast` join the `chatgpt-subscription`,
  `openai` and `openai-codex` vocabularies and `gpt-6.1-sol` the `vercel` one, so the new deep-low rungs export as themselves
  instead of `custom`; `docs/reference/senpi-telemetry.md` is regenerated from the schemas.
- Tests: `builtin-profiles.test.ts` pins the two-rung chain, `resolve.test.ts` resolves `chatgpt-subscription/gpt-6.1-sol`
  medium when the subscription serves both, and `index.test.ts` applies it at session start; the Copilot-only and GPT-6-only
  cases still resolve 5.6 Sol and report unavailable. `scripts/qa/model-profile-e2e-scenarios.mjs` `geeky-normal-sol` serves
  `gpt-6.1-sol` next to `gpt-5.6-sol` and expects 6.1 Sol.
- `plugin/extensions/omo.js`, `omo-task.js`, `omo-init-deep-advisor.js` regenerated on linux/amd64 (node 24, bun 1.4.2) for
  the chain, profile and vocabulary changes; `omo-member.js`, `memory-run-supervisor.mjs` and `omo-computer-use.js` rebuilt
  byte-identical, so they are unchanged.

## 2026-09-30 - A refused takeover of a question closed elsewhere is delivered with no answer text, not the dead claimant's (#9143)

Gate note N5 on the answer path: an answer that takes over an abandoned claim and is refused with `unknown_extension_ui_request` or `unknown_request` means the session no longer knows the request, which also happens when it was answered locally, timed out or was cancelled. `relay.ts` used to record the dead claimant's text as the delivered answer for all three "no longer waits" codes and say "the session already took an earlier answer". Now only `question_already_resolved` keeps that; for the two `unknown_*` codes the row is marked delivered with a NULL answer (`markPriorDelivered` with `{ answer: null, answered_at: <claim> }`) and the result is `already_answered` with "The session no longer waits for this question (answered or closed elsewhere) (<code>)". A later answer to that row reads the same wording (`claimAnswer` renders a delivered NULL-answer row with `CLOSED_ELSEWHERE`); a row delivered with text still reads "This question was already answered." `relay-answer-closed-elsewhere.test.ts` covers both `unknown_*` codes and the `question_already_resolved` counterpart (one frame, row state and answer text, both messages); keeping the dead answer for `unknown_*`, dropping it for `question_already_resolved`, or reverting the later-answer wording each fails 2 or 3 of the 25 answer-path cases. `docs/reference/omo-thread.md` describes the two outcomes.

## 2026-09-30 - thread_send and thread_handoff always deliver through the session gateway; the mailbox and file receipts are gone (#9143)

With senpi 2026.9.29-4 adopted (wake, admitExternalMessage, terminal control endpoints), the send switch flipped and then went away: `THREAD_SENDS_THROUGH_GATEWAY`, the `sendThroughGateway` option, the mailbox branch and the terminal-unsupported guard in `tools.ts` `deliver` are deleted, and so are `mailbox.ts`, `mailbox-journal.ts`, `mailbox-journal-codec.ts`, the mailbox-era file receipts in `receipts.ts` and their tests. A send is now always a durable gateway row with its own receipt: a terminal target is queued for its own inbox and woken instead of answering `unsupported`, and a send to the caller itself is refused `loop_detected` (`self_send`). The endpoint, terminal and self-resolution tests assert that (queued row, a `wake` to the owning endpoint, no `prompt`/`get_state`). The task-14 QA drivers that exercised only the deleted modules (`queued-resume`, `uncertain-operation` and its child) are retired, and the three cross-surface drivers deliver with the QA-only `deliverAuto` in `scripts/qa/thread-tools/lib/harness.mjs`. `gateway/legacy-mailbox.ts`, which reads a pre-gateway mailbox for the store's import, stays.

## 2026-09-29 - plugin bundles carry the typed launch_spec_insecure start failure (#9208)

- `plugin/extensions/omo-task.js`, `omo-member.js`, `omo.js` (source-digest marker only) and `plugin/runtime/rollback-migrate.js`
  regenerated on linux/amd64 (node 24, bun 1.4.2) for the senpi-task change: a task host that refuses a group- or
  world-writable launch spec now fails the start typed `launch_spec_insecure` with the spec path and `chmod 644 <path>`,
  and rollback strips the new reason like every post-R0 reason. No adapter source changed.

## memory, telemetry: Kibitzer recall runs on a Z.ai-only or Xiaomi-only machine (#9202)

- `memory/kibitzer/sidecar-model.test.ts`: with only `zai` or only `xiaomi` logged in and no quick config, the sidecar
  resolves `zai/glm-5.3-flash` or `xiaomi/mimo-v2.6-flash` at `low`. On dev both refused with `beyond_category`,
  because the quick chain had no rung for them. The chain change is in senpi-task.
- `telemetry/model-vocabulary.ts`: adds `glm-5.3-flash` under `zai` and `zai-coding-cn`, and `mimo-v2.6-flash` under
  `xiaomi`, so the new rungs export by name. `docs/reference/senpi-telemetry.md` is regenerated.

## thread, task: agent state stays out of the user's repository (#9201, DESKTOP-31)

- `components/thread/live-surface.ts` `defaultThreadStateDirectory`: the thread tools' mailbox and receipts move from
  `<project>/.omo/thread-tools` to the same per-project folder as the task state
  (`@oh-my-opencode/senpi-task` `resolveProjectStateDirectory`); a pre-existing in-project folder keeps being used.
- `components/task/engine-state-dir.test.ts`: a fresh project stays empty after the engine persists task state, a
  pre-existing `.omo/senpi-task` is kept, and `task.state_dir` wins.
- Root `test-setup.ts` drops an inherited `OMO_`/`SENPI_`/`PI_CODING_AGENT_DIR`, so a test run started inside a live
  session resolves agent-dir state under the hermetic HOME, as in CI.

## skill-commands, skills: argument-taking skills wait for their arguments in the slash picker (#9168)

- `skills/{hyperplan,init-deep,mass-ulw,ulw-loop,ulw-plan,ulw-research}/SKILL.md` and the shared-pool
  `ulw-execute`, `refactor` and `remove-ai-slops` declare `argument-hint`. From senpi#2258 on, the picker reads it
  (`Skill.argumentHint`) and Enter on a `skill:<name>` row fills `/skill:<name> ` and waits instead of submitting the
  skill empty. Skills that take no arguments stay hint-less and still submit on one Enter.
- `components/skill-commands/autocomplete.ts`: a bare alias row mirrors its own `skill:<name>` row on the same page,
  taking its description (which carries the hint) and `awaitsArguments`, so `/ulw-execute` waits exactly when
  `/skill:ulw-execute` does. `pi.getCommands()` carries no hint, so the page row is the source. Without the skill row
  the alias falls back to the command description and submits as before.
- `components/skill-commands/argument-hints.test.ts` parses every shipped SKILL.md with the engine's own
  `parseFrontmatter` (native copy over the shared one, as `sync-skills.mjs` ships them) and pins the set of hinted
  skills.

## computer-use, x-search: a feature skill yields to a loaded same-name skill and honors disabled_skills (#9160)

- `components/bundled-skills/contributed-skill.ts`: `resolveContributedSkill` decides one `resources_discover` pass for a
  skill a component contributes on its own. `disabled_skills` hides it (`readDisabledSkills`, now shared with the
  bundled-skills component). A `skill:<name>` entry in `pi.getCommands()` whose `sourceInfo.path` is not ours means
  senpi already loaded a same-name skill, which wins first-path either way, so ours is withheld instead of becoming a
  "Skill conflicts" collision. Our own path left over from an earlier pass still contributes.
- `components/computer-use/index.ts`: the `computer-use` skill goes through it; `/computer status` adds
  `skill: your own computer-use skill is active in place of the built-in guide (<path>)` when it yielded. New `env`
  option for the config read.
- `components/x-search/index.ts`: the conditional `x-search` skill goes through it. Both tools stay registered.
- `extension/types.ts`: `getCommands()` entries carry the optional `sourceInfo.path` senpi already reports.

## thread: AGENTS documents endpoint kinds, the delivery table, budgets, binding invariants, the outbox contract and completion arms

`src/components/thread/AGENTS.md` gains the `rpc_host`/`tui` endpoint kinds, the 15-cell `decideDelivery` table (the gateway's `auto` queues as a follow-up and never steers, unlike the mailbox path), every fixed budget with its constant (250 ms settle wait, the lock wait that gives up at about 25 s and never past 30 s, the retry on `lock_wait_exceeded`, the loop guards and rate limits), the binding invariants, the outbox contract, the completion arm lifecycle including the settle race, and the QA commands for the CLI, adopt and the built SDK. The live-surface row no longer says `omo daemon attach` sessions live on the legacy socket, and the package `AGENTS.md` names `omo daemon run` and `adopt` for `rpc.sock`. Docs only.

## thread: script-callable SDK (`plugin/runtime/thread-sdk/sdk.js`) for the `omo thread` CLI and connectors

- `components/thread/sdk.ts` (exported from the component barrel): `createThreadSdk({ agentDir, cwd, uid, user,
  engineStatusAll? })` runs every thread operation without an agent session as `cli:<uid>`: `list`, `read`, `send`
  (bindingless = the engine's `cli` sender; with `binding_id` = the connector inbound path, the idempotency key as the
  event id), `bind`/`unbind`/`rebind`/`bindings`/`report`/`outbox`/`ack`/`answer`, `locate` and `release` (senpi
  `release_session` for `omo daemon adopt`). Refusals and transport failures come back as data.
- `tools/gateway-services.ts` and `tools/read-ops.ts`: the store/engine/relay composition and the `thread_list` /
  `thread_read` bodies moved out of `tools.ts`, shared by the tools and the SDK (tool behavior unchanged).
- `gateway/store.ts`: `workerModuleUrl` option (where the worker sidecar is resolved from outside `omo.js`).
  Its worker no longer inherits `--input-type` (node refuses it for a file worker), so an inline
  `node --input-type=module -e` connector script can open the store.
- `live-surface.ts` takes `resolveTaskHostSocket` from `daemon-contract.ts` and `memory/worker/senpi-command.ts` takes
  the launcher helpers from `@oh-my-opencode/senpi-task/rpc-spawn`: the standalone SDK bundle no longer pulls the
  task engine (the full barrel made `bun build --outfile` emit assets and fail).
- Build: new entry `src/extension/thread-sdk.ts` -> `plugin/runtime/thread-sdk/sdk.js` (node builtins only external),
  in `--check`, the installer's required artifacts and the omo-ai payload verifier.
- `sdk.dispose()` cancels the relay's background answer-release retries before closing the store, as the component's
  `session_shutdown` does.
- A completion armed from outside the session reaches a running session: after `report` answers `armed: true`, the
  SDK wakes the session's endpoint (`wake` with no delivery ids, best effort), and the component reads the durable arm
  on that `wake` command edge (`registration.ts` `onCommandWake`, the same lock-free `pendingCompletionArms` read as
  the `session_start` pickup) and writes it at the next settle. An ordinary settle still makes no store call.

## thread: chat-thread bindings, report/outbox/answer relay tools, SQLite tool receipts, gateway send path behind a switch

- `components/thread/tools/relay-tools.ts`, `contracts/`, `metadata.ts`: eight new tools - `thread_bind`,
  `thread_unbind`, `thread_rebind`, `thread_bindings`, `thread_report`, `thread_outbox`, `thread_outbox_ack`,
  `thread_answer` - over the gateway store. A binding attaches a session to one external conversation thread
  (`platform` discord|telegram|slack|herdr|custom, `account_id`, `chat_id`, `thread_id`); one thread has at most one
  active binding (`binding_conflict` names the holder), unbind/rebind are CAS on the revision (`stale_revision`), a
  rebind never extends the TTL (default one week) and refuses work queued under the old revision (`binding_closed`).
  `thread_report` writes only through the calling session's own binding (the originating one by default); a question
  returns an HMAC reply token, and `thread_answer` is refused `binding_mismatch` unless the answer arrives through the
  binding that asked, `stale_token` after a rebind, expiry or session restart, `already_answered` on a replay.
  Completions are armed by `thread_report` and written only when the session settles, with the real outcome. A
  session that armed nothing never opens the gateway store when it settles, and an armed write never holds the settle
  for more than 250 ms: it finishes in the background, retried with the run's own outcome while another process holds
  the store's lock, and an arm made before a restart is written at the session's next settle. Relay text is capped at 32 KiB of
  UTF-8 bytes and refused as `message_too_large`.
- `components/thread/errors.ts`: six new codes (`binding_conflict`, `binding_mismatch`, `binding_inactive`,
  `stale_revision`, `stale_token`, `already_answered`); `loop_detected` now tells the model to answer through
  `thread_read` / `thread_report` / `thread_answer` instead of replying directly.
- `components/thread/tools.ts`: the tools' idempotency receipts move from files under the thread state directory to
  the gateway store's `receipts` table, with the same replay / conflict / in-progress / uncertain behavior.
  `thread_send` / `thread_handoff` can deliver through the gateway engine (results add `delivery_id`,
  `effective_mode`, `endpoint.kind`; new outcome `queued_offline`); that path stays off
  (`THREAD_SENDS_THROUGH_GATEWAY = false` in `component.ts`) until the senpi release with `wake` and
  `admitExternalMessage` is adopted.
- `components/thread/gateway/drain.ts`, `provenance.ts`: a delivery waiting behind the running turn or the user's
  draft shows one notice in the session ("remote message from <actor> queued (<delivery_id>)"); the provenance header
  names the binding and its revision for a delivery that came through one.
- `components/thread/gateway/schema.ts`, `store-ops.ts`, `store-worker.ts`: schema v2 (additive: session
  incarnation, outbox question/answer/outcome columns, per-binding ack cursors, completion arms). Opening a current
  store takes no write lock, and two processes opening a brand-new store at once no longer fail on the WAL switch or
  apply a migration twice. A store operation waits at most 30 s in total for the write lock, so a suspended process
  holding it can no longer stall every store call indefinitely; a session's inbox drain that gives up there retries on
  its own every 5 s until the delivery gets through, and a failed answer hand-off is always returned to pending. A tool
  call whose receipt could not be recorded answers `idempotency_uncertain` on retry instead of `idempotency_in_progress`.

## thread: address book over terminal endpoints with real names/timestamps; sessions drain their gateway inbox

- `components/thread/endpoint-registry.ts`: new. Reads senpi's endpoint registry
  (`<agentDir>/rpc-host-daemon/<16hex>/endpoint.json`, layout 2) without writing or connecting: `endpoint_kind`
  `tui`/`rpc_host` (a record without `registry_version`/`endpoint_kind` reads as `rpc_host`), the directory accepted only
  when the socket's canonical path hashes to it. Used to classify a socket's kind, and to enumerate when the engine's
  `host status --all` cannot.
- `components/thread/live-surface.ts`: `host status --all` rows keep `endpoint_kind`, `alive`/`reason` and a terminal
  owner's session path. A terminal control endpoint (`t-<16hex>.sock`) is reached with its 32-byte secret first and
  only with `get_protocol_info`, `list_sessions`, `get_state`, `get_messages`, `set_session_name`, `wake`, `subscribe`,
  `extension_ui_response`; anything else is refused as `unsupported` before a connection opens, and is answered as
  data by the tools. A terminal the engine reports not alive is not dialed; it is listed from its session file with
  `error_note: "live_unresponsive"`. The surface also exposes the gateway's sender port (`wake`, host-only
  `release_session`, liveness) - a delivery is announced with `wake`, never `prompt`.
- `components/thread/address-book.ts`, `session-facts.ts`, `tools/internals.ts`: every thread carries `endpoint`
  (`kind`, `socket`, `routing_id`), `surface` (`tui` | `desktop` | `child` | `daemon`) and `alive`; its name is the
  session's `/name` (else the first 60 characters of its first user message, never the durable id) and its
  `created_at`/`updated_at` come from the session header and last entry (read from the first and last 64 KiB of the
  file) instead of 1970.
- `components/thread/tools.ts`: `thread_send`/`thread_handoff` to a terminal session answer `unsupported` (a terminal
  takes messages only through its gateway inbox), as do interrupt, model and reasoning changes.
- `components/thread/gateway/registration.ts`, `component.ts`: on an engine that exposes `pi.session`
  (`registerControlEndpoint`, `admissionGate`, `admitExternalMessage`, `listAdmittedDeliveries`, `persistHeaderNow`),
  the thread component persists the session header and registers the session's control endpoint with the gateway
  inbox drain; shutdown disposes the endpoint before the store. On today's engine nothing is registered.
- `components/thread/gateway/store.ts`, `plugin/scripts/build-extension-core.mjs`, `check-extension-current.mjs`,
  `src/install/plugin-artifacts.ts`: the gateway store's worker thread ships as its own build output,
  `extensions/gateway-store-worker.mjs`, beside `omo.js` (a bundler cannot inline a `Worker` entry). The store
  resolves it from its own module location and falls back to `store-worker.ts` in source; `build-extension --check`
  and the installer's required-artifact list include it. Without it the built extension's inbox drain could not open
  its store (`MODULE_NOT_FOUND`).
- `components/thread/gateway/registration.ts`: the store is stamped with `pi.sessionContext.host_instance`, so a host
  `release_session` settles only its own runtime's claims.
- `components/thread/live-surface.ts`: a terminal endpoint whose socket is gone is reported `dead` instead of a raw
  `host_unavailable:<path>`.

## thread: gateway store and delivery engine (SQLite, receipts, causal loop guard)

- `components/thread/gateway/`: new, not wired into the tools yet. One SQLite store at `<agentDir>/gateway/gateway.sqlite`,
  owned by a worker thread so no store call blocks a session loop, holds every cross-session delivery (`deliveries`),
  its idempotency receipt, the causal graph and the rate buckets, plus the `bindings`/`outbox` tables the binding
  tools use. A send writes its row and the target's inbox marker in one `BEGIN IMMEDIATE` transaction; the target's
  own drain is the only path out of `queued` and marks a row `applied` only after the runtime wrote its transcript
  entry. Loop guards (cycle refusal per causal root, 4 hops, 8-burst/5 s pair bucket, 16 targets per turn, 64
  deliveries per root, 7-day roots, 24 h queue TTL) and a lost-ACK rule (`idempotency_uncertain`, never a resend)
  are enforced in that transaction. The first open migrates a legacy `<cwd>/.omo/thread-tools/mailbox` journal once.
- `components/thread/errors.ts`: new code `loop_detected`.
- `components/thread/gateway/store-ops.ts`: a row claimed by a live host that since released the session
  (`session_released { host_instance, released_at }` in the transcript, naming the claim's own host generation, claimed
  at or before `released_at`) is settled by the disk-token rule like a dead claimant's, instead of reading
  `dual_runtime` forever. A claim by any other runtime, or made after the release, stays `dual_runtime`.
- `components/thread/gateway/adapter.ts`: provisional senpi types aligned with the branches (registration union,
  `release_session` request/refusal shape, drain result mapping).
- `omo-native/test/sqlite-import-discipline.test.ts`: covers the gateway; only `store-worker.ts` imports `node:sqlite`,
  lazily.

## memory: a late Kibitzer verdict no longer steers an extra turn after the final answer

- `components/memory/kibitzer/delivery.ts`: an accepted verdict steers at once only while the running session has a
  tool call executing. The host reads its steering queue after every turn, so a steer queued once the final answer
  was streaming or streamed started one more assistant turn after it; a headless `senpi -p` consumer that posts only
  the last assistant text then lost the real answer (observed as `answer -> omo-kibitzer:recall -> "NO_REPLY"`). Such a
  verdict is now held for the next `tool_result` steer or the next prompt's drain, like any other held nudge.
- `components/memory/kibitzer/hooks.ts`: `tool_call` / `tool_result` report the executing call ids to delivery, and a
  new `turn_end` hook clears them so a call that never reports a result (blocked, aborted) cannot outlive its turn.

## model-profile, task: builtin lanes and the category notice never route to an unlisted gateway (#9146)

- `components/model-profile/resolve.ts`: every builtin rung, in `recommended` and in the `daily-*`/`geeky-*` lanes, is
  served only by its listed providers, so a lane never lands the session on a gateway's copy of its model
  (`opengateway/anthropic/claude-opus-5-5`). A lane no listed provider serves is `unavailable` and keeps the session
  model with the existing one-line notice. A user's bare model id, which names no provider, still matches anywhere.
  `rankedProvidersOnly` is gone: it was the only builtin that had the listed-only rule, which is now the rule.
- `components/task/category-unavailable-warning.ts`: when only an unlisted provider serves a hidden category's chain,
  the one notice per session names it and the exact opt-in line
  (`categories.<name>.model = "<gateway>/<model>"`); `details.unlisted_provider_model` carries it for remote clients.

