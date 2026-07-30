# PR 6043 Final Round Seven Evidence

Date: 2026-07-17

## What Was Tested

- Exact repair commit `3bb8bb8067e8ff98043aadfadf63a4db62c7fa8b`.
- Stale cleanup while status retry is paused in agent resolution.
- Stale cleanup while fallback dispatch is paused in message loading.
- Same-session-ID reuse before a detached abort resolves or rejects.
- Deferred terminal payload cleanup.
- Existing runtime-fallback and shared prompt/model-fallback boundaries.
- OpenCode typecheck, Biome, no-excuse rules, diff checks, and pure LOC.
- Isolated OpenCode harness self-check, SSE event stream, tmux TUI smoke, and production-duration local-plugin behavior.

## What Was Observed

- Failing-first status continuation probe: `0 pass`, `2 fail` on the prior exact head; stale work aborted, dispatched fallback, and recreated state.
- Focused repaired races: `6 pass`, `0 fail`.
- Runtime-fallback suite: `350 pass`, `0 fail`, `702` expectations across `54` files.
- Shared boundaries: `33 pass`, `0 fail`, `61` expectations across `5` files.
- Typecheck, Biome, no-excuse, and `git diff --check`: pass.
- Every touched TypeScript file is at or below `250` pure LOC.
- Isolated TUI and SSE probes passed; the real OpenCode DB remained unchanged at `5,751` sessions.
- Live local-plugin run proved silent-root fallback, two active roots, older-root restoration after newer-root deletion, no watchdog re-arm, and later user abort classified as external.

## Why It Is Enough

The deterministic tests cover every stale-cleanup await window reported by the independent reviewers, including same-ID ABA and retained deferred events. The full suite and shared boundaries cover adjacent retry and prompt-gate behavior. The isolated production-duration run drives the real OpenCode server, plugin loader, event stream, provider wire, root-session state, and abort path without touching the real database.

## Artifact Map

- `source-identity.txt`: exact commit and integrated base identity.
- `status-continuation-red.txt`: failing-first output from the prior head.
- `focused-races.txt`: exact-head cleanup race matrix.
- `runtime-fallback-suite.txt`: full affected suite.
- `shared-boundaries.txt`: adjacent prompt/model-fallback boundaries.
- `static-gates.txt`: typecheck, Biome, diff, and pure LOC results.
- `no-excuse.txt`: TypeScript no-excuse audit.
- `harness-self-check.txt`: OpenCode common, SSE, TUI, and DB isolation checks.
- `live-isolation-receipt.txt`: production-duration behavior and isolation receipt.
- `live-plugin-watchdog.txt`, `live-sse-events.jsonl`, `live-root-state.jsonl`, `live-fake-provider.txt`: sanitized live observations.
- `fake-silent-provider.mjs`, `root-state-probe.ts`: deterministic local QA fixtures.

## Omitted

Raw server output, raw SSE streams, temporary sandboxes, request credentials, and unfiltered plugin logs were removed. The retained files contain only sanitized reviewer-readable evidence and test-only fake provider values.
