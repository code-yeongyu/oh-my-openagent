# PR #6043 QA Evidence

Reviewed source head: `16fdcee8cf29b6d5fbde3f9e5f81a553481251ec`

Integrated `dev`: `2622e145ee64df12264142dd14e78c078cccb1aa`

The final evidence commit is content-only and does not change the reviewed
runtime source.

## What Was Tested

1. Focused watchdog, progress-event, abort-ownership, and lifecycle tests:

   ```text
   bun test packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog.test.ts packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog-progress-events.test.ts packages/omo-opencode/src/hooks/runtime-fallback/auto-retry-abort.test.ts packages/omo-opencode/src/hooks/runtime-fallback/message-update-handler.test.ts
   ```

   Captured in `final-exact-focused-tests.txt`.

2. Full runtime-fallback hook suite:

   ```text
   bun test packages/omo-opencode/src/hooks/runtime-fallback
   ```

   Captured in `final-exact-runtime-fallback-suite.txt`.

3. OpenCode adapter typecheck and Biome check:

   ```text
   bun run --cwd packages/omo-opencode typecheck
   bunx biome check <changed runtime-fallback TypeScript files>
   ```

   Captured in `final-exact-omo-opencode-typecheck.txt` and
   `final-exact-biome.txt`.

4. OpenCode QA harness self-check:

   ```text
   bash .agents/skills/opencode-qa/scripts/lib/common.sh --self-check
   ```

   Captured in `final-repair-opencode-harness-self-check.txt`.

5. Real OpenCode live harness:

   ```text
   bash .omo/evidence/20260716-pr-6043-main-watchdog/run-live-watchdog-qa.sh
   ```

   The script loads the exact local plugin through `file://`, starts OpenCode
   under isolated `HOME` and `XDG_*` directories, and drives a real main
   session against `fake-silent-provider.mjs`. The primary model remains
   silent through the production 90,000 ms watchdog. The first fallback
   returns `QA_FALLBACK_OK`; a second user turn is then held open and cancelled
   through OpenCode's real abort endpoint.

## What Was Observed

- Focused suite: 57 pass, 0 fail.
- Full runtime-fallback suite: 255 pass, 0 fail.
- Scoped TypeScript and Biome checks: pass.
- OpenCode accepted both asynchronous main-session prompts with HTTP 204.
- At the real 90-second deadline, the plugin aborted the silent primary
  request and dispatched `openai/fallback`.
- The fallback provider returned `QA_FALLBACK_OK` through the real SSE stream.
- The later user abort returned HTTP 200 and the plugin logged
  `session.error matched cancellation; cleared retry state`, proving stale
  internal-abort provenance did not survive the completed fallback cycle.
- The isolated OpenCode database contained one QA session.
- The real OpenCode database remained unchanged at 5,751 sessions before and
  after the run.

Artifacts:

- `live-plugin-watchdog.txt`: first-party watchdog, abort, fallback, and later
  external-cancellation markers.
- `live-fake-provider.txt`: primary silence/connection closure, successful
  fallback response, and held second request.
- `live-sse-events.jsonl`: parsed lifecycle events from the real OpenCode
  server.
- `live-isolation-receipt.txt`: source SHA, HTTP results, request counts, and
  unchanged real database count.
- `final-exact-live-watchdog-run.txt`: terminal harness result.

## Why It Is Enough

The tests cover main and subagent watchdog ownership, progress and terminal
cancellation, removed-subagent suppression, abort failure, zero-timeout
semantics, retry dedupe, fallback timeout, compaction, and cleanup boundaries.
The live harness covers the behavior unit tests cannot: local plugin loading,
real OpenCode lifecycle events, production watchdog timing, active-request
abort, fallback dispatch, visible assistant output, a later genuine user
cancellation, and database isolation.

## What Was Omitted

Raw environment dumps, credentials, tokens, auth headers, transient diagnostic
runs, and unrelated shared logs were not committed. The provider API key and
server password in the harness are fixed local-only dummy values. The optional
`check-no-excuse-rules.ts` helper was omitted because its own TypeScript import
failed under both available launch paths; strict package typecheck and Biome
completed successfully.

## Cleanup

Each live run terminates the SSE watcher, OpenCode server, and fake provider,
then removes its temporary sandbox. Final worktree/process cleanup is recorded
in the terminal review artifact after merge.
