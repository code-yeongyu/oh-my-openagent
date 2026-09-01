# QA summary - issue #6579 - runtime fallback repeated-error stall

Captured 2026-08-05 on Windows 11 with Bun 1.3.14 and Node v24.18.0.
OpenCode harness QA ran as the non-root `codexqa` user in Ubuntu 22.04 under
WSL2 with OpenCode 1.18.13.

Base: `upstream/dev` at `302c5eaec605ce7f800ff893a74189247fc785a2`.

## What was tested

1. Red-green regression tests for:
   - duplicate retry events from one model remaining deduplicated;
   - the same attempt and normalized error from a different model advancing;
   - fallback state surviving 31 minutes of inactivity;
   - fallback state older than 12 hours being cleaned.
2. The complete runtime-fallback test directory.
3. Repository typecheck and production build.
4. A direct Bun driver importing the exported session-status handler and
   replaying the issue's exact three-event sequence.
5. A direct Bun driver importing stale-session cleanup and checking the
   31-minute and 13-hour boundaries.
6. A real isolated OpenCode server loaded with this worktree's `dist/index.js`.
   The QA subscribed to `/event`, created a session, sent a prompt through
   `prompt_async`, and asserted a `session.status` SSE event.

## What was observed

- Before the source fix, both new regression tests failed:
  - the second model produced no fallback dispatch;
  - the 31-minute session state was deleted.
- After the source fix, the targeted tests passed: 6 pass, 0 fail.
- The complete runtime-fallback suite passed: 252 pass, 0 fail.
- `bun run typecheck` exited 0.
- `bun run build` exited 0.
- The direct retry driver observed exactly two dispatches:
  `openai/gpt-5.4`, then `google/gemini-2.5-pro`.
- The direct retention driver retained the 31-minute state and removed only
  the 13-hour state.
- The real prompt returned HTTP 204.
- The SSE probe observed `{"type":"session.status"}` and exited 0.
- The real Linux OpenCode database contained 0 sessions before and after QA.
- The server used isolated XDG paths under `.omo/qa-sandbox-6579`.

Exact concise captures:

- `red-green.txt`
- `manual-qa.txt`
- `verification.txt`

## Why it is enough

The red-green tests toggle both reported causes directly. The full hook suite
guards adjacent retry, abort, watchdog, and cleanup behavior. Typecheck and
build validate the shipped TypeScript bundle. The two direct drivers execute
the changed exported modules with the reported values. The isolated OpenCode
server proves the matching `session.status` lifecycle event reaches the real
hook surface after a real HTTP prompt.

## What was omitted

No credentials, tokens, authentication headers, environment dumps, or raw
secret-bearing logs were copied. Repetitive build and test output was
summarized while preserving commands, exit statuses, counts, and observed
behavior.
