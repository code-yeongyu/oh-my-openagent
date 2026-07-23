# PR 6043 twenty-seventh review repair

## Finding

The final code-review lane found two HIGH lifecycle defects at source head
`abd538a298da3d5411547d8a6695353f16728cca`.

1. A generic internal status abort could publish its abort event before the
   HTTP response. The watchdog observer cleared the shared ownership even
   though it had no watchdog provenance, so retry state reset and the next
   retry repeated fallback one instead of advancing to fallback two.
2. `dispose()` cleared current maps and timers but did not invalidate async
   handlers already awaiting abort or prompt I/O. Resolving an in-flight abort
   after disposal could dispatch a fallback and install fresh state.

Failing-first `hook-abort-lifecycle-races.test.ts` reported 0 pass / 2 fail:
the first sequence produced fallback one twice, and the disposal sequence
produced one post-disposal prompt.

## Repair

Source commit `a5d9298c5581b90cad1822995456edb6f82a9268`:

- clears generic internal-abort ownership only when the watchdog actually held
  watchdog-generation provenance;
- makes hook disposal a terminal lifecycle transition;
- blocks events and chat messages after disposal; and
- checks the lifecycle after abort, message lookup, prompt dispatch, retry
  waits, and timeout awaits before any later side effect can recreate state.

## Exact-head verification

- Focused composed lifecycle and ownership races: 24 pass / 0 fail across 7
  files (`twenty-seventh-exact-focused-regressions.txt`).
- Full runtime fallback: 302 pass / 0 fail across 48 files
  (`twenty-seventh-exact-runtime-fallback-suite.txt`).
- Model fallback, plugin lifecycle, and session state: 66 pass / 0 fail across
  4 files (`twenty-seventh-exact-session-lifecycle-suite.txt`).
- Static gates: package `tsgo --noEmit`, the bundled no-excuse audit over all
  12 files, documented Biome lint-only check, `git diff --check`, and pure-LOC
  audit pass. Biome reports only two pre-existing informational literal-key
  notices; every touched file is at or below 249 pure lines.
- Pinned `@opencode-ai/sdk@1.15.13` loopback: HTTP 404 returns false, clears
  internal abort ownership, preserves the exact prompt reservation, and sends
  no sibling model-fallback prompt
  (`twenty-seventh-exact-sdk-abort-boundary.txt`).
- Mandatory isolated real OpenCode QA: two active roots were observed; the
  older silent root recovered through watchdog fallback; deleting the newer
  root restored the older root; fallback success did not re-arm the watchdog;
  a later user abort remained external; and the real DB count stayed 5751
  (`twenty-seventh-exact-live-*`).

## Why this is enough

The two new composed-hook tests force both disputed event orderings without
wall-clock timing and assert public outcomes. The full hook and sibling suites
cover the adjacent ownership, timeout, model-fallback, and root-lifecycle
contracts. The SDK probe covers the actual cancellation transport boundary,
while the production-duration server/SSE run covers plugin loading, root
selection, fallback dispatch, later cancellation, cleanup, and DB isolation.

## Omitted or bounded

No secrets, auth headers, raw environments, private credentials, or unrelated
logs are copied. The live harness does not intentionally dispose the plugin
during an active HTTP abort; that exact teardown interleaving is proven by the
deterministic composed-hook regression instead.
