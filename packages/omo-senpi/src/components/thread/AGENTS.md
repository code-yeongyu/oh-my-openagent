# thread component

Cross-session thread tools: six agent-callable tools that address PEER sessions (terminal, desktop, or tool-created) through the shared `senpi --mode rpc --multi-session` socket host. The host, its ensure/handshake, and the lifecycle supervisor live in senpi (`packages/coding-agent/src/modes/rpc/`); this directory owns the tool contracts, addressing, the address book, the transcript reader, durable receipts, the ordered-delivery mailbox, prompt routing, and the tool-search discovery metadata.

Assembly status: `index.ts` re-exports contracts and errors only. No assembled `thread_*` tool handler exists yet; the components are driven directly, which is exactly what the QA suites do.

## Anatomy

| Path | Purpose |
|------|---------|
| `contracts.ts` | TypeBox param schemas for the six tools, shared byte limits (`THREAD_MESSAGE_MAX_BYTES` 32 KiB, read default 128 KiB / cap 1 MiB), the discriminated result unions, and `parseThreadParams` (invalid input returns `invalid_arguments` as data, never throws). |
| `errors.ts` | The 26-code failure taxonomy and `threadToolFailure`. Every failure is `{ code, message, next_action, details? }`; `next_action` names the recovery step for the model. |
| `addressing.ts` | `resolveTarget` (id-then-name ladder), `fuzzyMatch` (trigram Dice), `checkNameConflict`, `normalizeThreadName` (NFKC + trim + lowercase + whitespace collapse). Workspace scope is git-worktree equality, realpath equality outside git. |
| `address-book.ts` | `assembleAddressBook`: merges live `list_sessions` results from every reachable host with resumable sessions scanned from disk JSONL (`scanDiskSessions`). Stateless per call; a dead host degrades its sessions to disk truth plus an `error_note`. |
| `reader.ts` | Bounded synchronous transcript reader for `thread_read`. Names its source (`live_host` vs `session_jsonl`); on the jsonl path `source_incomplete` is true exactly when no live host holds the session. An empty file is an empty transcript, never an error. |
| `receipts.ts` | Durable idempotency receipts under `receipts/` in the component state dir. `begin`/`complete`/`execute` over fsynced atomic writes with a lock dir; 30-day retention (`RECEIPT_RETENTION_MS`), `prune()` removes expired receipts. |
| `mailbox.ts` | `createOrderedDeliveryMailbox`: per-target FIFO with durable on-disk state, delivery modes auto/steer/follow_up, bounds of 128 messages and 1 MiB per queue, and a 50 ms retry timer per target. |
| `prompt-routing.ts` | `PromptRouter` over senpi's existing `extension_ui_request` frames: routes each prompt per policy (`answer-here`, `leave-to-own-client`, `auto-cancel`), authorizes the answerer, and cancels with a recorded reason on timeout or `close()`. |
| `metadata.ts` | Tool-search entries (`exposure: "search"`, group `threads`, verb-led labels, unique keywords) plus the single family-wide `promptGuidelines` string. No indexed field carries a negated-use sentence because BM25 indexes negated words positively. |
| `discovery.test.ts` and the other `*.test.ts` | Pure-seam unit tests; live-socket behavior is proven by the QA harnesses below instead. |

## The six tools

All six return discriminated unions: `{ kind: "ok", ... }` or `{ kind: "error", error: ThreadToolFailure }`. Errors are data, never exceptions.

- `thread_create` `{ name?, cwd?, fork_from?, idempotency_key? }` -> `{ thread, deduplicated }`. A normalized name collision is `name_conflict`; there is no auto-suffix anywhere in the family.
- `thread_list` `{ all_scope? }` -> `{ threads, scope: "workspace" | "all" }`.
- `thread_read` `{ thread, cursor?, max_bytes?, all_scope? }` -> `{ thread_id, items, truncated, next_cursor?, source }`. A cursor the transcript revision moved past is `cursor_stale`.
- `thread_send` `{ thread, message, delivery?, expected_turn_id?, summary?, idempotency_key?, all_scope? }` -> `{ thread_id, delivery, message_seq, deduplicated }`. Delivery outcome is one of `steered`/`started` (with `turn_id`) or `queued` (with `queue_position`).
- `thread_interrupt` `{ thread, turn_id?, all_scope? }` -> `{ thread_id, turn_id?, interrupted }`. Interrupting an idle thread succeeds with `interrupted: false`.
- `thread_handoff` `{ thread, match?, message, delivery?, ... }` -> `{ thread, resolved_by, delivery, message_seq, deduplicated }`. The only tool with fuzzy resolution (`match: "fuzzy"`).

`ThreadDeliveryMode` is an enum, not a boolean: `auto` steers a running turn and otherwise starts one; `steer` requires `expected_turn_id` and becomes `turn_conflict` when the active turn changed; `follow_up` queues behind the running turn.

## Addressing rules

Address entries carry both identities: the `routing_id` (the live host's `sessionId`, used to reach the session on its host) and the durable id, which is `thread_id`, the address every tool accepts. Resolution ladder in `resolveTarget`:

1. An exact durable-id match wins immediately over every entry. Under default scope, an id hit outside the caller's workspace is `scope_denied`, never `not_found`, because the id already names one thread.
2. Otherwise NFKC-normalized name match over the visible entries: one hit resolves, two or more are `ambiguous_target` with up to ten candidates, zero is `not_found`.

Scope: two paths share a workspace when they sit in the same canonical git work tree (linked worktrees of one repo count as separate workspaces); outside git, realpath equality. `all_scope: true` widens to every entry the daemon knows. A scoped call with no known caller workspace root is `caller_context_missing`.

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

Thread tool codes (`THREAD_ERROR_CODES`): `invalid_arguments`, `caller_context_missing`, `not_found`, `ambiguous_target`, `scope_denied`, `name_conflict`, `not_resumable`, `orphaned`, `foreign_live_owner`, `no_active_turn`, `turn_conflict`, `not_steerable`, `message_too_large`, `queue_full`, `cursor_invalid`, `cursor_stale`, `idempotency_conflict`, `idempotency_in_progress`, `idempotency_uncertain`, `approval_unavailable`, `approval_route_locked`, `partial_commit`, `unsupported`, `overloaded`, `transport_closed`, `internal_error`.

Prompt-route codes (separate union in `prompt-routing.ts`): `prompt_route_locked`, `prompt_response_not_authorized`, `prompt_not_found`.

Common mappings: an oversized message is `message_too_large` (32 KiB tool cap, 1 MiB mailbox cap); a full per-target queue (128 messages or 1 MiB) is `queue_full`; a changed active turn under steer is `turn_conflict` with the message held undelivered; reusing an idempotency key with different arguments is `idempotency_conflict`; a concurrent in-flight operation on the same key is `idempotency_in_progress`; a delivery target with no live owner is `not_resumable`.

## Desktop mirror

The mirror service (desktop side, task 17) reflects host sessions into the desktop thread list read-only, through the existing `thread.create` / `thread.meta.update` / subscribeShell pipeline. Title ownership: host-side rename TRANSITIONS propagate to the shell row; a desktop-side user rename survives host updates; a host rename that happened during mirror downtime is adopted as the new baseline on restart (the dual of the guard, resolved in the user's favor). A `project.create` failure warns once per session and drops that session from mirroring for the rest of the run.

## QA

From the repo root:

```
bun test packages/omo-senpi/src/components/thread
bun packages/omo-senpi/scripts/qa/thread-tools/run-all.mjs
bun packages/omo-senpi/scripts/qa/task-14/run-all.mjs
```

The first runs the pure-seam unit tests. The second runs the four cross-surface scenarios (cli-surface, desktop-client, terminal-to-ui, desktop-to-cli) sequentially, one at a time on purpose: each owns a QA port and a unix socket. The third runs the resilience injections (kill-mid-turn, version-capability, queued-resume, uncertain-operation) and writes evidence plus cleanup receipts. All three drive the components directly against a real socket host; none depends on an assembled tool handler.

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
- Don't put negated-use sentences in any indexed metadata field, and don't repeat a keyword string across the six tools.
- Don't send into sessions from the mirror, and don't write desktop data back into the host.
