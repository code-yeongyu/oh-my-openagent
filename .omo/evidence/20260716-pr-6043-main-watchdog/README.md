# PR #6043 QA Evidence

Reviewed runtime source head: `d4cfbad8afb836ae6ffdc3f4e82126b883621b37`

Integrated `dev`: `81180f3759c55262a49be6883bb9db5c102e2b4d`

The following evidence commit is content-only. It refreshes reviewer-readable
artifacts and does not change the tested runtime behavior.

## What Was Tested

1. Focused watchdog, abort-provenance, timeout-abort, and lifecycle tests:

   ```text
   bun test packages/omo-opencode/src/hooks/runtime-fallback/abort-provenance-race.test.ts packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog-lifecycle.test.ts packages/omo-opencode/src/hooks/runtime-fallback/auto-retry-timeout.test.ts packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog.test.ts packages/omo-opencode/src/hooks/runtime-fallback/message-update-handler.test.ts
   ```

   Captured in `final-exact-focused-tests.txt`.

2. Full runtime-fallback hook suite:

   ```text
   bun test packages/omo-opencode/src/hooks/runtime-fallback
   ```

   Captured in `final-exact-runtime-fallback-suite.txt`.

3. OpenCode adapter typecheck and scoped Biome linter:

   ```text
   bun run --cwd packages/omo-opencode typecheck
   bunx --bun @biomejs/biome@2.4.16 check --javascript-formatter-enabled=false --assist-enabled=false --javascript-linter-enabled=true --error-on-warnings <changed files>
   ```

   Captured in `final-exact-omo-opencode-typecheck.txt` and
   `final-exact-biome.txt`. Formatting is intentionally disabled because this
   adapter has no Biome configuration and the repository style is enforced by
   its existing source and CI gates.

4. OpenCode QA harness self-check:

   ```text
   bash .agents/skills/opencode-qa/scripts/lib/common.sh --self-check
   ```

   Captured in `final-repair-opencode-harness-self-check.txt` with local paths
   and transient port values redacted.

5. Real OpenCode live harness:

   ```text
   bash .omo/evidence/20260716-pr-6043-main-watchdog/run-live-watchdog-qa.sh
   ```

   The script loads the exact local plugin through `file://`, starts OpenCode
   under isolated `HOME` and `XDG_*` directories, and drives a real main
   session against `fake-silent-provider.mjs`. The primary model remains
   silent through the production 90-second watchdog. The fallback returns
   `QA_FALLBACK_OK`; a second user turn is then held open and cancelled through
   OpenCode's real abort endpoint.

## What Was Observed

- Focused suite: 52 pass, 0 fail.
- Full runtime-fallback suite: 263 pass, 0 fail.
- Scoped TypeScript and Biome linter checks: pass.
- A failing-first lifecycle regression reproduced the live OpenCode race: the
  watchdog's own abort emitted assistant completion plus `session.idle` before
  the abort promise resolved, and the stale callback was incorrectly
  invalidated. The repaired exact head preserves ownership for that internal
  completion/idle pair while explicit terminal cancellation still suppresses
  fallback dispatch.
- A compaction-agent `role=user` update no longer arms the main-session
  watchdog, while a later genuine user turn can re-arm after normal progress.
- OpenCode accepted both asynchronous main-session prompts with HTTP 204.
- At the production watchdog deadline, the plugin aborted the silent primary
  request and dispatched `openai/fallback`.
- The fallback provider returned `QA_FALLBACK_OK` through the real SSE stream.
- The later user abort returned HTTP 200 and the plugin logged that the
  cancellation cleared retry state, proving stale internal-abort provenance
  did not survive the completed fallback cycle.
- The isolated OpenCode database contained one QA session.
- The real OpenCode database count was unchanged before and after the run.

Artifacts:

- `live-plugin-watchdog.txt`: sanitized first-party watchdog, abort, fallback,
  and later external-cancellation markers.
- `live-fake-provider.txt`: primary silence/connection closure, successful
  fallback response, and held second request.
- `live-sse-events.jsonl`: sanitized lifecycle events from the real server.
- `live-isolation-receipt.txt`: HTTP results, request counts, isolated session
  count, and unchanged-real-DB assertion.
- `final-exact-live-watchdog-run.txt`: terminal harness result.

## Why It Is Enough

The tests cover main and subagent watchdog ownership, progress and terminal
cancellation, cancellation while abort is in flight, expected internal-abort
completion/idle events, removed-subagent suppression, abort failure,
zero-timeout semantics, retry dedupe, fallback timeout, delayed abort
provenance, compaction exclusion, re-arming after progress, disposal during
asynchronous work, and cleanup boundaries. The live harness covers what unit
tests cannot: local plugin loading, real OpenCode lifecycle events, production
watchdog timing, active-request abort, fallback dispatch after the internal
idle edge, visible assistant output, a later genuine user cancellation, and
database isolation.

## What Was Omitted

Raw environment dumps, credentials, tokens, auth headers, session IDs, local
paths, transient diagnostic runs, and unrelated shared logs are omitted or
redacted. The provider API key and server password in the harness are fixed
local-only dummy values. The optional TypeScript no-excuse helper was omitted
as a gate because its own compiler-API import fails before inspecting files
(`ts.ScriptTarget` is undefined); strict package typecheck and the scoped Biome
linter completed successfully.

## Cleanup

Each live run terminates the SSE watcher, OpenCode server, and fake provider,
then removes its temporary sandbox. Final branch/worktree/process cleanup is
recorded in the terminal review artifact after merge.
