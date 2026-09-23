# thread component

Cross-session thread tools: nine agent-callable tools that address PEER sessions (terminal, desktop, or tool-created) through the shared `senpi --mode rpc --multi-session` socket host. The host, its ensure/handshake, and the lifecycle supervisor live in senpi (`packages/coding-agent/src/modes/rpc/`); this directory owns the tool contracts, addressing, the address book, the transcript reader, durable receipts, the ordered-delivery mailbox, prompt routing, and the tool-search discovery metadata.

Assembly status: assembled and live. `tools.ts` (`registerThreadTools`) builds the nine `thread_*` tools over a `ThreadHost` port; `component.ts` (`createThreadComponent`) registers them unconditionally, constructing the socket client from `live-surface.ts` unless a test injects a host; `src/extension/component-list.ts` lists the component right after `task`. There is no launch-flag gate: when the shared host socket is missing, each call fails as data with `host_unavailable` instead of the tools disappearing. `index.ts` re-exports every module in this directory.

## Anatomy

| Path | Purpose |
|------|---------|
| `contracts.ts` | TypeBox param schemas for the nine tools, shared byte limits (`THREAD_MESSAGE_MAX_BYTES` 32 KiB, read default 128 KiB / cap 1 MiB), the discriminated result unions, and `parseThreadParams` (invalid input returns `invalid_arguments` as data, never throws). |
| `errors.ts` | The 30-code failure taxonomy and `threadToolFailure`. Every failure is `{ code, message, next_action, details? }`; `next_action` names the recovery step for the model. |
| `addressing.ts` | `resolveTarget` (id-then-name ladder), `fuzzyMatch` (trigram Dice), `checkNameConflict`, `normalizeThreadName` (NFKC + trim + lowercase + whitespace collapse). Workspace scope is git-worktree equality, realpath equality outside git. |
| `address-book.ts` | `assembleAddressBook`: merges live `list_sessions` results from every reachable host with resumable sessions scanned from disk JSONL (`scanDiskSessions`). Stateless per call; a dead host degrades its sessions to disk truth plus an `error_note`. |
| `reader.ts` | Bounded synchronous transcript reader for `thread_read`. Names its source (`live_host` vs `session_jsonl`); on the jsonl path `source_incomplete` is true exactly when no live host holds the session. An empty file is an empty transcript, never an error. |
| `receipts.ts` | Durable idempotency receipts under `receipts/` in the component state dir. `begin`/`complete`/`execute` over fsynced atomic writes with a lock dir; 30-day retention (`RECEIPT_RETENTION_MS`), `prune()` removes expired receipts. |
| `mailbox.ts` | `createOrderedDeliveryMailbox`: per-target FIFO with durable on-disk state, delivery modes auto/steer/follow_up, bounds of 128 messages and 1 MiB per queue, and a 50 ms retry timer per target. |
| `prompt-routing.ts` | `PromptRouter` over senpi's existing `extension_ui_request` frames: routes each prompt per policy (`answer-here`, `leave-to-own-client`, `auto-cancel`), authorizes the answerer, and cancels with a recorded reason on timeout or `close()`. |
| `tools.ts` | `registerThreadTools`: the nine assembled handlers. Every call runs through one `execute` wrapper that reads the caller id, parses params, admits the call through receipts, and maps a thrown `host_unavailable:` from the surface to the `host_unavailable` code. |
| `component.ts` | `createThreadComponent`: the `OmoSenpiComponent` named `thread`. Options exist only as test seams (`host`, `diskSessions`, `stateDirectory`, `callerSessionId`, `callerWorkspaceRoot`). |
| `live-surface.ts` | `createLiveThreadSurface`: the `ThreadHost` client for Senpi's supervisor-owned unix socket (never starts or replaces a host; socket resolved by `resolveThreadSocket`, same env precedence as the task daemon). Eleven methods: `listSessions`, `openSession`, `getMessages`, `getState`, `prompt`, `interrupt`, `setSessionName`, `setModel`, `getAvailableModels`, `setThinkingLevel`, `getAvailableThinkingLevels`. A `set_thinking_level` rejection of the form "Thinking level X is not supported by the active model." is rethrown as `thinking_level_unsupported:` so the tool can map it. |
| `metadata.ts` | Tool-search entries (`exposure: "search"`, group `threads`, verb-led labels, unique keywords) plus the single family-wide `promptGuidelines` string. No indexed field carries a negated-use sentence because BM25 indexes negated words positively. |
| `discovery.test.ts` and the other `*.test.ts` | Pure-seam unit tests; live-socket behavior is proven by the QA harnesses below instead. |

## The nine tools

All nine return discriminated unions: `{ kind: "ok", ... }` or `{ kind: "error", error: ThreadToolFailure }`. Errors are data, never exceptions.

- `thread_create` `{ name?, cwd?, fork_from?, idempotency_key? }` -> `{ thread, deduplicated }`. A normalized name collision is `name_conflict`; there is no auto-suffix anywhere in the family.
- `thread_list` `{ all_scope? }` -> `{ threads, scope: "workspace" | "all" }`.
- `thread_read` `{ thread, cursor?, max_bytes?, all_scope? }` -> `{ thread_id, items, truncated, next_cursor?, source }`. A cursor the transcript revision moved past is `cursor_stale`.
- `thread_send` `{ thread, message, delivery?, expected_turn_id?, summary?, idempotency_key?, all_scope? }` -> `{ thread_id, delivery, message_seq, deduplicated }`. Delivery outcome is one of `steered`/`started` (with `turn_id`) or `queued` (with `queue_position`).
- `thread_interrupt` `{ thread, turn_id?, all_scope? }` -> `{ thread_id, turn_id?, interrupted }`. Interrupting an idle thread succeeds with `interrupted: false`.
- `thread_handoff` `{ thread, match?, message, delivery?, ... }` -> `{ thread, resolved_by, delivery, message_seq, deduplicated }`. The only tool with fuzzy resolution (`match: "fuzzy"`).
- `thread_rename` `{ thread, name, all_scope?, idempotency_key? }` -> `{ thread_id, name }`. The name is trimmed; an empty result is `invalid_arguments`, and a case-insensitive match with another visible thread is `name_conflict` (no auto-suffix). Needs a live owner (`not_resumable` otherwise); delivered through `setSessionName`. The id stays the address, the name is only a label.
- `thread_set_model` `{ thread, model, provider?, all_scope?, idempotency_key? }` -> `{ thread_id, model: { provider, id } }`. Resolution ladder against the target's `getAvailableModels` catalog: exact `provider/id`, then exact id, then case-insensitive fragment of id or display name; `provider` narrows the catalog first. Zero hits is `model_not_found` (details carry up to 20 `available`), several is `model_ambiguous` (up to 10 `candidates`). Applied through `setModel`; needs a live owner.
- `thread_set_reasoning` `{ thread, level, scope?, all_scope?, idempotency_key? }` -> `{ thread_id, level, scope }`. `level` is one of `off|minimal|low|medium|high|xhigh|max`; `scope` defaults to `session` (rewrites the model's remembered level) and `turn` changes only the current session level. A level the active model can't run is `thinking_level_unsupported` with the `supported` list in details, and the thread is left unchanged. The host validates on the `turn` path, which applies to the active model right away; `session` records the model's remembered preference and is accepted even for a level that model cannot currently run (observed live against senpi 2026.9.21 with a model whose supported set is `["off"]`). Delivered through `setThinkingLevel`; needs a live owner.

`ThreadDeliveryMode` is an enum, not a boolean: `auto` steers a running turn and otherwise starts one; `steer` requires `expected_turn_id` and becomes `turn_conflict` when the active turn changed; `follow_up` queues behind the running turn.

## Addressing rules

Address entries carry both identities: the `routing_id` (the live host's `sessionId`, used to reach the session on its host) and the durable id, which is `thread_id`, the address every tool accepts. Resolution ladder in `resolveTarget`:

1. An exact durable-id match wins immediately over every entry. Under default scope, an id hit outside the caller's workspace is `scope_denied`, never `not_found`, because the id already names one thread.
2. Otherwise NFKC-normalized name match over the visible entries: one hit resolves, two or more are `ambiguous_target` with up to ten candidates, zero is `not_found`.

Scope: two paths share a workspace when they sit in the same canonical git work tree (linked worktrees of one repo count as separate workspaces); outside git, realpath equality. `all_scope: true` widens to every entry the daemon knows. A scoped call with no known caller workspace root is `caller_context_missing`.

Self-targeting: the caller's identity is read per call, from the execution context's `sessionManager.getSessionId()` (the component's `callerSessionId` option is only the fallback for hosts that don't pass one). Three EXPLICIT addresses reach the caller's own thread, and they are explicit by construction: the literal `"self"`, the caller's durable id, and the caller's exact name — the name ladder in `resolveTarget` carries no caller exclusion, so naming yourself exactly reaches you, exactly as naming any other thread reaches it. `"self"` is looked up in the address book by the caller id, and `caller_context_missing` comes back when the caller's session isn't in the book. What never happens is landing on the caller by ACCIDENT: fuzzy resolution (`thread_handoff`, `match: "fuzzy"`) filters the caller's entry out of the candidate set before scoring.

That exclusion needs an identity to exclude. When the host passes no execution context the fallback id is `UNKNOWN_CALLER` (`tools.ts`), which stands for an ABSENT identity rather than a thread: `"self"` then always answers `caller_context_missing` (it never matches an entry, even one whose durable id is literally that string), and fuzzy scoring has no caller to remove. The engine always passes the context, so the fallback is a compatibility path for older hosts, not a supported way to run the family.

Fuzzy (`thread_handoff` only): trigram Dice over name (weight 1.0), preview (0.85), and workspace basename (0.70). A leader is accepted only at score >= 0.72 with a >= 0.08 margin over the runner-up. Note the consequence of the weights: an exact workspace-basename match tops out at 0.70, BELOW the 0.72 accept floor, so a cwd-basename fuzzy match alone never auto-accepts. The basename signal can only reinforce or disambiguate; it cannot select on its own. This is conservative by design.

## Host lifecycle (senpi side)

`ensureHost()` starts the shared socket host on demand, probes an occupying server's version and capability set (`multi_session`, `extension_events`), and REPLACES it on mismatch. Every ensured host gets the pinned installation-wide client-capability profile, independent of who ensured it first. The host runs under a lifecycle supervisor (`host-lifecycle.ts`) that byte-proxies the public socket:

- Cold start `transient` (default) idle-exits after a continuous window (default 15 minutes) with zero attached connections and zero active turns; `persistent` never idle-exits. Env overrides: `SENPI_RPC_HOST_COLD_START`, `SENPI_RPC_HOST_IDLE_EXIT_MS`.
- Orphan-proofing is kernel-level: the supervisor spawns the host with an inherited pipe on fd 3 and holds the write end without writing. When the supervisor dies for ANY reason (SIGKILL, OOM kill, crash), the kernel closes the pipe, the host reads EOF, and shuts down cleanly. Verified on darwin/arm64. On Windows the fd is not inherited and the host falls back to ppid polling at a ~2000 ms cadence (`HOST_WATCH_PPID_INTERVAL_MS`); that path is coded but untested.
- Event visibility (pinned task-2 semantics): the multi-session host broadcasts session lifecycle and agent events to ALL session clients; correlated command responses go to the requester only.
- Zero-turn resume edge: a session killed before its FIRST turn gets a NEW durable id on reopen, because the upstream engine never flushes a zero-turn session to disk. This is correct CLI behavior and user-visible.

## Delivery, receipts, prompt routing

Receipts and the mailbox compose at-least-once, not exactly-once. The mailbox may redeliver a message across its own crash; the receipt layer upstream dedupes on the effective key, so the caller sees `deduplicated: true` instead of a repeat. Exactly-once is deliberately NOT claimed: the engine does not dedupe on the correlation id. Two routes surface honestly as `idempotency_uncertain`: a crash between native accept and receipt commit, and a side effect that THROWS inside `execute()` (the prepared receipt is transitioned to `uncertain` carrying an `error_note`, never deleted - deletion would license a silent double delivery when the throw followed a partial landing). Neither is ever auto-retried. Receipts live 30 days; orphaned `.tmp` files from interrupted atomic writes are not garbage-collected (harmless, known).

Mailbox retry is rate-bounded (one 50 ms timer per target) and count-unbounded by design: every armed retry holds a durably retained message whose only delivery path is that loop, so capping attempts would strand it. `streamingBehavior` hints (`"steer"`/`"followUp"`) are plumbed through `MailboxTargetPort`, but no product importer relays them to the wire yet; that integration is pending.

Prompt routing: the policy of an in-flight prompt is immutable; `changePolicy` to a different policy returns `prompt_route_locked`. Host loss cancels every pending prompt with a plumbed reason (`close(reason)`), never a synthesized answer. Two senpi-side constraints to respect when wiring: an inline `await ctx.ui.confirm()` inside a `session_start` handler deadlocks the bind, so detach the confirm; and multi-session inbound responses need the `sessionId` envelope so the router can authorize the answerer.

## Error taxonomy

Thread tool codes (`THREAD_ERROR_CODES`): `invalid_arguments`, `caller_context_missing`, `not_found`, `ambiguous_target`, `scope_denied`, `name_conflict`, `not_resumable`, `orphaned`, `foreign_live_owner`, `no_active_turn`, `turn_conflict`, `not_steerable`, `message_too_large`, `queue_full`, `cursor_invalid`, `cursor_stale`, `idempotency_conflict`, `idempotency_in_progress`, `idempotency_uncertain`, `approval_unavailable`, `approval_route_locked`, `partial_commit`, `unsupported`, `overloaded`, `transport_closed`, `host_unavailable`, `internal_error`, `model_not_found`, `model_ambiguous`, `thinking_level_unsupported`.

Prompt-route codes (separate union in `prompt-routing.ts`): `prompt_route_locked`, `prompt_response_not_authorized`, `prompt_not_found`.

Common mappings: an oversized message is `message_too_large` (32 KiB tool cap, 1 MiB mailbox cap); a full per-target queue (128 messages or 1 MiB) is `queue_full`; a changed active turn under steer is `turn_conflict` with the message held undelivered; reusing an idempotency key with different arguments is `idempotency_conflict`; a concurrent in-flight operation on the same key is `idempotency_in_progress`; a delivery target with no live owner is `not_resumable`; a missing host socket is `host_unavailable` on every tool, per call; an unmatched or over-matched model pattern is `model_not_found` / `model_ambiguous`; a thinking level the active model rejects is `thinking_level_unsupported`.

## Desktop mirror

The mirror service (desktop side, task 17) reflects host sessions into the desktop thread list read-only, through the existing `thread.create` / `thread.meta.update` / subscribeShell pipeline. Title ownership: host-side rename TRANSITIONS propagate to the shell row; a desktop-side user rename survives host updates; a host rename that happened during mirror downtime is adopted as the new baseline on restart (the dual of the guard, resolved in the user's favor). A `project.create` failure warns once per session and drops that session from mirroring for the rest of the run.

## QA

From the repo root:

```
bun test packages/omo-senpi/src/components/thread
bun packages/omo-senpi/scripts/qa/thread-tools/run-all.mjs
bun packages/omo-senpi/scripts/qa/task-14/run-all.mjs
```

The first runs the pure-seam unit tests. The second runs the four cross-surface scenarios (cli-surface, desktop-client, terminal-to-ui, desktop-to-cli) sequentially, one at a time on purpose: each owns a QA port and a unix socket. The third runs the resilience injections (kill-mid-turn, version-capability, queued-resume, uncertain-operation) and writes evidence plus cleanup receipts. All three drive the components directly against a real socket host. `tools.test.ts`, `component.test.ts`, and `live-surface.test.ts` cover the assembled handlers, the registration, and the socket client through injected hosts.

## Conventions

- Every entry point returns its outcome as data; the error branch carries a taxonomy code and a `next_action` that names the recovery, so a runner hands the failure straight to the model.
- Bounded everything: read budgets, queue sizes, candidate lists, fuzzy scan caps. Nothing streams into a caller; a truncated read hands back one payload plus an opaque cursor.
- Durable state is written atomically (temp file, fsync, rename, directory fsync) with 0700/0600 modes.
- Discovery metadata keeps policy prose out of per-tool entries; the family policy lives in exactly one `promptGuidelines` string.

## Anti-patterns

- Don't throw for an expected failure anywhere in this family; construct the failure through `threadToolFailure` so the code stays taxonomy-validated.
- Don't claim exactly-once delivery, and don't add dedupe to the engine on the correlation id here; the receipt layer is the dedupe seam.
- Don't cap mailbox retry attempts; classify-as-terminal on a live-but-busy host strands a message that must not be dropped.
- Don't describe cwd-basename fuzzy matching as auto-accepting; at weight 0.70 it can never clear the 0.72 floor alone.
- Don't put negated-use sentences in any indexed metadata field, and don't repeat a keyword string across the nine tools.
- Don't send into sessions from the mirror, and don't write desktop data back into the host.
