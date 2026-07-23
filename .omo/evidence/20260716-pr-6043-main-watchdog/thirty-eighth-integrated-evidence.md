# Thirty-Eighth Integrated Evidence

## Exact Source

- Runtime repair commit: `054aa9cbc876132b4838d5cf767d399641760b59`.
- Fresh fetched `origin/dev`: `5459b09d04989b2d9bdad4709c88de41772bae34`.
- Merge commit under test: `2ba20e4e8c4bcd2915df5041acb0ff18c0d9242a`.
- The merge commit's second parent equals the fetched dev tip: yes.
- The complete `packages/omo-opencode` tree is identical between the repair
  commit and the merge commit: `2b7ea99767ab002076ce9065e910237562a21b4b`.
- Both live runs executed source `f726df3f072865c4ccada3e81a246c0ac9daf544`,
  whose complete OpenCode tree has that same hash; the final incoming delta was
  confined to `docs/reference/known-issues.md`.

## What Was Tested

1. The exact stale-watchdog regression plus status retry rejection and
   three-generation ownership boundaries.
2. The complete runtime-fallback package suite.
3. The established five-file plugin lifecycle, model-fallback, and session
   state boundary suite.
4. The OpenCode adapter strict typecheck, scoped Biome lint, bundled
   TypeScript no-excuse audit, pure-line ceiling, and diff integrity.
5. The OpenCode QA common harness self-check.
6. A new isolated real OpenCode server scenario in which a loopback provider
   returns HTTP 429, OpenCode publishes a real `session.status` retry, and the
   runtime fallback takes ownership before the original watchdog deadline.
7. The established isolated production-duration silent-provider scenario,
   including two root sessions, deletion restoration, watchdog fallback, and
   a later genuine user abort.

## What Was Observed

- Focused tests: `11 pass, 0 fail`, 41 expectations across 3 files.
- Complete runtime-fallback suite: `333 pass, 0 fail`, 670 expectations
  across 48 files.
- Lifecycle and model boundary: `66 pass, 0 fail`, 140 expectations across
  5 files.
- Typecheck, Biome, no-excuse, harness self-check, pure-line, and integrity
  gates passed. `first-prompt-watchdog.ts` remains at exactly 250 pure lines.
- Live status takeover: `session.status` retry observed, fallback one sent
  exactly once, `fallback ownership transferred` logged before dispatch,
  fallback two remained at zero after 100 seconds, and the real OpenCode DB
  count was unchanged.
- Live silent-provider scenario: older-root watchdog fallback, two active
  roots, restoration after newer-root deletion, no fallback watchdog re-arm,
  later user abort classified external, and real DB unchanged.
- Both live harnesses terminated the fake provider, SSE watcher, OpenCode
  server, and temporary XDG/HOME sandbox through their cleanup traps.

## Why It Is Enough

The deterministic regression proves the exact reviewer trace and its toggle:
without ownership transfer the original deadline dispatches fallback two;
with the repair only `session.status` dispatches. The new real-server scenario
then proves that same boundary through OpenCode's actual retry event, abort
route, plugin hook, fallback prompt, and production 90-second watchdog. The
established live scenario retains coverage for timeout-owned fallback, root
lifecycle, later cancellation, and database isolation.

## Harness Development Note

The first new status-harness attempt timed out before exercising product code
because its fake provider accepted only `/chat/completions` while OpenCode
selected `/responses`. The corrected fake supports both OpenAI wire surfaces;
the same product assertions then passed. No failed sandbox or QA process
remained, and the real DB count stayed unchanged.

## What Was Omitted

No raw environment dump, credential, auth header, private database path, or
unsanitized server log is retained. Both providers bind only to loopback and
use fixed local dummy credentials. Session IDs and sandbox/worktree paths are
redacted in durable artifacts.
