# Stale background cleanup QA

## What was tested

- Focused regression: `bun test packages/omo-opencode/src/features/background-agent/manager.test.ts -t "should clean stale-interrupted child session bookkeeping"`
- Adjacent background-agent tests: `bun test packages/omo-opencode/src/features/background-agent/manager.test.ts packages/omo-opencode/src/features/background-agent/task-poller.test.ts`
- Typecheck: `bun run typecheck:packages`
- Build attempt: `bun run build`
- OpenCode QA harness self-check: `bash .agents/skills/opencode-qa/scripts/lib/common.sh --self-check`
- OpenCode isolated server smoke: `bash .agents/skills/opencode-qa/scripts/server-smoke.sh`
- OpenCode isolated SSE smoke: `bash .agents/skills/opencode-qa/scripts/sse-hook-probe.sh --self-test`
- Throwaway archive command checks for `unzip -o -d <dest> -- <archive>` and `unzip -p -- <archive> <entry>`.

## What was observed

- Focused stale cleanup regression passed: 1 test, 7 assertions.
- Background-agent focused suite passed: 234 tests, 707 assertions.
- `typecheck:packages` completed successfully.
- `bun run build` is blocked by the pre-existing deleted Codex comment-checker source files: `packages/omo-codex/plugin/components/comment-checker/src/core.ts` and `packages/omo-codex/plugin/components/comment-checker/test/core.test.ts`. The build fails when `codex-hook.ts` imports `./core.js`.
- OpenCode QA self-check passed and confirmed required dependencies plus isolated sandbox cleanup.
- OpenCode server smoke passed in an isolated XDG sandbox: `/global/health`, `/doc`, and auth rejection behaved correctly.
- OpenCode SSE smoke passed: `/event` delivered `server.connected`.
- The hardened `unzip` argument order successfully extracted and printed entries from throwaway archives under `/tmp/opencode`.

## Why it is enough

- The stale cleanup behavior is covered by a regression that verifies root descendant state, pending parent tracking, delegated child bootstrap, session category, session agent state, and subagent session state are cleared after stale interruption.
- The wider background-agent manager and poller tests cover the lifecycle paths most likely to regress from the new terminalization callback.
- The OpenCode smoke tests prove the installed OpenCode harness still starts, serves, authenticates, and emits lifecycle events in an isolated environment. A fresh plugin bundle could not be produced until the unrelated Codex deletion blocker is resolved.

## What was omitted

- No secret-bearing logs, env dumps, tokens, auth headers, or private credentials were recorded.
- Full `bun run build` success was omitted because the workspace currently has unrelated deleted Codex comment-checker files that break `build:codex-plugin` before the OpenCode bundle step.
