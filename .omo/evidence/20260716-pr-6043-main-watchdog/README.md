# PR #6043 QA Evidence

Review candidate: `66b9195a4aaaee5a0caed14557d88b15f111b89a`

PR source head before refresh: `b5142814d4e4d5d14449ae95f55c17b3e845cdc8`

Integrated `dev`: `4b8b44b9efbd9886324adf2ac428ebaa8c3af93a`

## What Was Tested

1. Focused watchdog and abort ownership tests:

   ```text
   bun test packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog.test.ts packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog-progress-events.test.ts packages/omo-opencode/src/hooks/runtime-fallback/auto-retry-abort.test.ts
   ```

   Captured in `refreshed-head-focused-tests.txt`.

2. Full runtime-fallback hook suite:

   ```text
   bun test packages/omo-opencode/src/hooks/runtime-fallback
   ```

   Captured in `refreshed-head-runtime-fallback-suite.txt`.

3. OpenCode adapter typecheck:

   ```text
   node_modules/.bin/tsgo --noEmit -p packages/omo-opencode/tsconfig.json
   ```

   Captured in `refreshed-head-omo-opencode-typecheck.txt`.

4. Real OpenCode live harness:

   ```text
   .omo/evidence/20260716-pr-6043-main-watchdog/run-live-watchdog-qa.sh
   ```

   The script loads the exact local plugin through `file://`, starts OpenCode
   under isolated `HOME` and `XDG_*` directories, drives a real main-session
   prompt against `fake-silent-provider.mjs`, and waits for the production
   90,000 ms watchdog deadline. The primary model accepts connections but
   emits no response; the fallback model returns `QA_FALLBACK_OK`.

## What Was Observed

- Focused suite: 47 pass, 0 fail.
- Full runtime-fallback suite: 249 pass, 0 fail.
- Scoped TypeScript check: pass.
- OpenCode accepted the asynchronous main-session prompt with HTTP 204.
- The primary provider request remained silent through OpenCode's five
  response-header retries.
- At the real 90-second deadline the plugin logged `dispatching fallback`,
  aborted the in-flight request as `first-prompt-watchdog`, selected
  `openai/fallback`, and dispatched the retry.
- The provider received one fallback request and returned
  `QA_FALLBACK_OK`; the SSE stream recorded the fallback text delta and final
  assistant completion.
- The isolated OpenCode database contained one QA session.
- The real OpenCode database remained unchanged at 5,751 sessions before and
  after the run.

Artifacts:

- `live-plugin-watchdog.txt`: first-party plugin hook and abort markers.
- `live-fake-provider.txt`: primary silence/connection closure and fallback
  request/response record.
- `live-sse-events.jsonl`: parsed lifecycle events from the real OpenCode
  server.
- `live-isolation-receipt.txt`: exact SHA, session, HTTP, request counts, and
  unchanged real database count.
- `refreshed-head-live-watchdog-run.txt`: terminal harness result.

## Why It Is Enough

The unit suite covers progress cancellation, terminal events, removed
subagents, abort ownership, retry dedupe, fallback timeout, compaction, and
cleanup boundaries. The live harness covers the behavior unit tests cannot:
the local plugin loading in OpenCode, real lifecycle events, a genuinely
silent main-session provider request, production watchdog timing, abort of
the active request, fallback prompt dispatch, model substitution, and final
assistant output. The unchanged real database count proves isolation.

No blocking implementation defect remained after review. The earlier review
finding about internal abort ownership is fixed by `b5142814d`; this evidence
closes the remaining live-harness gap.

## What Was Omitted

Raw environment dumps, credentials, tokens, auth headers, and unrelated
shared logs were not captured. The provider API key and server password in
the harness are fixed local-only dummy values.

## Cleanup

Each live run terminates the SSE watcher, OpenCode server, and fake provider,
then removes its temporary sandbox. Final worktree and process cleanup is
recorded in the terminal review artifact after merge.
