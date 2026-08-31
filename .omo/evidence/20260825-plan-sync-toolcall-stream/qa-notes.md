# QA notes - issue #3588 sync task toolcall progress streaming

## WHAT WAS TESTED

1. Failing-first regression suite `sync-session-poller.progress-streaming.test.ts` (6 tests):
   - Busy child session with growing tool parts -> progress snapshots stream to `onProgress`
     WHILE the child is still busy (before completion), with monotonic `toolCalls` and
     `latestTool` tracking the newest tool part.
   - Multi-turn busy session -> streamed snapshots report the rising `assistantTurns` count.
   - Guards: frozen transcript publishes exactly once (signature dedupe); a throwing
     `onProgress` cannot break polling; anchor gating suppresses progress before the first
     new child message; a huge `progressIntervalMs` produces zero active-phase fetch traffic.
2. Publisher unit suite `sync-progress-reporter.test.ts` (4 tests): activity extraction
   counts + publisher merges base sync metadata with the snapshot and honors a fresh
   session ID after a fallback retry (no stale sessionId).
3. Scoped suite: `bun test packages/omo-opencode/src/tools/delegate-task/` -> 497 pass / 0 fail (44 files),
   including the pre-existing `sync-poll-timeout.test.ts` pin that callers WITHOUT
   `onProgress` see zero extra message fetches (gating verified).
4. Repo typecheck: `bun run typecheck` (tsgo root + script + all workspace packages) -> exit 0.

## WHAT WAS OBSERVED

- Pre-implementation baseline (`failing-test-output.txt`): both core streaming tests failed
  exactly as the issue describes - no messages were fetched while the child status was busy,
  so zero progress snapshots reached the parent; the first test additionally burned the full
  inactivity window because its transcript shape never satisfied terminal detection.
- Post-implementation (`passing-test-output.txt`, `scoped-suite-output.txt`): all green.
  Progress sampling is active-phase-only, throttled (default 2s), signature-deduped,
  anchor-gated, and fault-isolated.

## WHY IT IS ENOUGH

- The regression tests reproduce the exact production failure mode from the issue timeline:
  parent sees nothing while the sync child runs toolcalls; progress appears only at completion.
  They now pin the opposite contract: snapshots stream during the busy phase via the same
  `ctx.metadata()` live-update seam native OpenCode tools use for TUI progress rendering.
- The four guard tests pin conservatism so the fix cannot add cost or fragility: dedupe
  bounds publish volume, fault isolation protects the poll loop, anchor gating preserves
  the existing "no processing before first child message" rule, and the throttle bound plus
  the no-publisher gating keep request traffic identical for callers that opt out.
- The change is confined to `packages/omo-opencode/src/tools/delegate-task/` (4 source files
  touched/added + 2 co-located test files); background mode, result fetching, and completion
  contracts are untouched. PR #7230 (stall detection) touches the same poller file but
  disjoint regions (post-text-fallback stall block, `stallWindowMs` input) - rebase-safe.

## WHAT WAS OMITTED

- Live end-to-end harness QA (real opencode + real provider driving a sync delegation and
  watching the parent TUI re-render): this environment has no provider credentials and the
  LSP daemon socket could not start in the worktree (typecheck covered by the repo's own
  tsgo strict gate instead). Risk accepted as low: the fix only adds an optional, throttled,
  error-isolated metadata publish on an already-polled transcript; it changes no completion,
  abort, timeout, or result-extraction path, and every existing delegate-task test (497 total)
  still passes. Mirrors the evidence standard of merged prior art PR #7230.
- No secrets, tokens, or env dumps are contained in this evidence directory.
