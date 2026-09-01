# QA summary - PR #6611 manual model reset

Captured 2026-08-13 on Windows 11 with Bun 1.3.14. Real OpenCode QA
ran under WSL2 as the non-root `codexqa` user with OpenCode 1.18.13.

## What was tested

1. A red-green regression test that seeds retry-status deduplication keys,
   changes the model through the real chat-message handler, and checks that a
   new retry-key generation starts.
2. The focused chat-message and session-status handler tests.
3. The complete runtime-fallback test directory.
4. The repository TypeScript no-excuse audit and workspace package typecheck.
5. The production build.
6. A real isolated OpenCode server loaded with this worktree's
   `dist/index.js`; the driver subscribed before prompting and awaited a
   `session.status` event.

## What was observed

- Before the source fix, the regression failed because the retained key map
  survived a manual model reset.
- After deleting that session's key set in the existing reset branch, the
  focused tests passed: 10 pass, 0 fail.
- The complete runtime-fallback suite passed: 256 pass, 0 fail.
- The no-excuse audit reported no violations.
- Workspace package typecheck exited zero.
- The real prompt returned HTTP 204 and the SSE subscription observed
  `{"type":"session.status"}`.
- OpenCode loaded this worktree's `dist/index.js`.
- The real Linux OpenCode database contained 0 sessions before and after QA.

Exact concise captures:

- `verification.txt`
- `manual-qa.txt`
- `opencode-hook-qa.sh`
- `opencode.json`

## Why it is enough

The red-green test toggles the review finding at the exact lifecycle boundary:
manual model selection now resets fallback state and retry deduplication state
together. The focused and full suites cover adjacent retry and reset behavior.
Typecheck and the production build validate the shipped TypeScript bundle.
The isolated real OpenCode run proves that the matching lifecycle event reaches
the loaded plugin surface without touching the host database.

## What was omitted

No credentials, tokens, authentication headers, environment dumps, session
payloads, or raw secret-bearing logs were copied. Repetitive compiler output
was summarized with its command, exit status, and test counts.
