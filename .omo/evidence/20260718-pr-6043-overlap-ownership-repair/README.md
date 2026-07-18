# PR #6043 Overlap Ownership Repair Evidence

## Source Identity

- Final repaired source head: `07075f4be9d87a9ab4213b127b23975de6709adb`.
- Timeout-owner repair: `b1054147ea5e0d28b6e20bc4a36e4c1f53d7c0a0`.
- Detached-watchdog repair: `07075f4be9d87a9ab4213b127b23975de6709adb`.
- Pre-repair head: `0dce36a651bad04c17eeee8a2afb202fc6bffd4a`.

## What Was Tested

1. A fallback timeout starts aborting while a same-generation replacement timeout and retry owner take over.
2. A fired first-prompt watchdog pauses during agent resolution while ownership transfers, rolls back, and arms a replacement callback.
3. The complete runtime-fallback test directory, strict adapter typecheck, pinned Biome 2.4.16 lint, TypeScript no-excuse audit, pure-LOC ceiling, and diff integrity.
4. The production-duration OpenCode path through the real plugin adapter, HTTP API, SSE stream, local fake provider, root-session lifecycle, and user-abort boundary in an isolated XDG/HOME sandbox.

## What Was Observed

- Failing-first overlap run: `3 pass`, `2 fail`; the stale timeout dispatched once and the detached watchdog aborted twice.
- Repaired focused overlap matrix: `16 pass`, `0 fail`, `61` expectations across five files.
- Complete runtime-fallback suite: `366 pass`, `0 fail`, `761` expectations across 59 files.
- Typecheck, scoped lint, no-excuse, `git diff --check`, and all seven touched-file pure-LOC checks passed. The largest files are 249 pure LOC.
- Exact-head live OpenCode run recovered the silent root request through one owned fallback, restored the older root after deleting the newer root, did not re-arm after success, and classified the later user abort as external cancellation.
- The live OpenCode database remained unchanged at `5751` sessions; the isolated sandbox was removed.

## Why It Is Enough

The deterministic tests force both asynchronous overlap windows that serialized fake timers previously hid, and assert the observable owner, timer, abort, and dispatch outcomes. The isolated live run independently proves the exact committed watchdog source still works through the real OpenCode adapter without touching user state. Together they cover the two review blockers and the surrounding regression surface.

## Artifacts

- `red-overlap-reproduction.txt`: failing-first proof against the pre-repair implementation.
- `focused-overlap-matrix.txt`: exact overlap and adjacent boundary tests.
- `runtime-fallback-suite.txt`: complete affected suite.
- `typecheck.txt`, `biome-lint.txt`, `no-excuse.txt`, `pure-loc-and-diff-check.txt`: static gates.
- `opencode-harness-self-check.txt`: QA harness dependencies and sandbox cleanup self-test.
- `run-live-watchdog-qa.sh`, `live-watchdog-qa.txt`, `live-isolation-receipt.txt`: exact live command and terminal receipt.
- `live-fake-provider.txt`, `live-plugin-watchdog.txt`, `live-sse-events.jsonl`, `live-root-state.jsonl`: sanitized runtime observations.
- `source-identity-and-db.txt`: exact commits, source-diff digest, and post-run live DB count.

## Omitted

Raw authorization headers, temporary credentials, private environment values, and unsanitized service logs were not retained. Cubic is skipped because its monthly quota is exhausted until August 1, 2026.
