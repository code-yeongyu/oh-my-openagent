# PR #6043 Abort Ownership Overlap Repair Evidence

## What Was Tested

1. A `session.status` provider-retry abort pauses while a same-generation replacement retry owner takes over.
2. A `message.updated` provider-retry abort pauses through the same replacement-owner overlap.
3. The adjacent retry-owner, watchdog-owner, abort-wire-ordering, timeout-overlap, and abort-rejection matrix.
4. The complete runtime-fallback suite, adapter typecheck, pinned Biome lint, TypeScript no-excuse audit, diff integrity, and 250 pure-LOC ceiling.
5. The real OpenCode adapter over HTTP and SSE with a local fake provider in an isolated HOME/XDG sandbox.

## What Was Observed

- Failing-first regression: `0 pass`, `2 fail`; both stale abort continuations dispatched `provider/fallback` after erasing replacement ownership.
- Repaired regression: `2 pass`, `0 fail`, `6` expectations.
- Focused ownership matrix: `16 pass`, `0 fail`, `49` expectations across five files.
- Complete runtime-fallback suite: `368 pass`, `0 fail`, `767` expectations across 60 files.
- Adapter typecheck, scoped Biome correctness checks, no-excuse audit, and `git diff --check` passed.
- Pure LOC remained below 250 in all four touched files: 45, 188, 220, and 125.
- Real OpenCode recovered the silent older root with one fallback, retained two active root sessions, restored the older root after deleting the newer root, did not re-arm the settled watchdog, and classified a later user abort as external.
- The live OpenCode database stayed unchanged at `5751` sessions, the isolated sandbox was removed, and the source files were unchanged during QA.

## Why It Is Enough

The deterministic tests force the exact same-generation replacement-owner window that lifecycle generation checks cannot reject. They verify both handler entry points preserve the replacement token and suppress a competing fallback dispatch. The adjacent and full suites cover retry rejection, timeout, watchdog, abort ordering, cleanup, and fallback-chain regressions. The isolated real-harness run independently proves the surrounding main-session watchdog behavior through the production adapter without touching user state.

## Artifacts

- `red-abort-owner-overlap.txt`: failing-first proof against the pre-repair implementation.
- `green-abort-owner-overlap.txt`: focused green proof after the minimal ownership repair.
- `focused-ownership-matrix.txt`: replacement-owner and adjacent concurrency boundaries.
- `runtime-fallback-suite.txt`: complete affected suite.
- `typecheck.txt`, `biome-lint.txt`, `no-excuse.txt`, `static-integrity.txt`: static and size gates.
- `opencode-harness-self-check.txt`: harness dependency and cleanup self-check.
- `run-live-watchdog-qa.sh`, `live-watchdog-qa.txt`, `live-working-tree-source.txt`: exact live command, result, and dirty-source identity.
- `live-isolation-receipt.txt`, `live-fake-provider.txt`, `live-plugin-watchdog.txt`, `live-sse-events.jsonl`, `live-root-state.jsonl`: sanitized runtime and isolation observations.

## Omitted

Raw authorization headers, temporary credentials, private environment values, and unsanitized service logs were not retained. Cubic is explicitly skipped because its monthly quota is exhausted until August 1, 2026.
