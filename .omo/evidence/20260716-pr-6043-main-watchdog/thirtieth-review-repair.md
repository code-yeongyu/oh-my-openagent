# PR #6043 Thirtieth Review Repair

Date: 2026-07-17 (Asia/Seoul)

## Exact Source

- Merge-candidate source: `d0778a6cc23fb59977be4d6ce933cd4441a59db5`
- Runtime repair: `655cac6e14c7b083989c087940e9ac4263aa76a6`
- Integrated `origin/dev`: `09557b20a0913f26392515e658892a5658a6808c`
- Superseded reviewed head: `20124bc44c8275dc447cb58b86c2ed414afac83b`

## Finding

The fresh code-quality lane found that `observeEventForWatchdog()` treated
every `session.next.*` event as assistant progress. OpenCode's typed event
family includes admission and stream-start events such as
`session.next.prompted`, `session.next.step.started`,
`session.next.text.started`, and agent/model switches. Those events do not
prove that the provider produced output, but they cleared the silence timer.
A provider could therefore start a step and then hang forever without the
main-session fallback that this PR exists to provide.

## Repair

`first-prompt-watchdog-events.ts` now uses an explicit semantic classifier:

- Non-empty synthetic, text, reasoning, and tool-input content is progress.
- Tool execution, shell activity, and terminal step outcomes are progress.
- Prompt admission, step/text/reasoning start, agent/model switches, retries,
  compaction, and empty content are not progress and leave the watchdog armed.

The production change is paired with a real-watchdog matrix rather than an
implementation-only helper test. Each rejected control event advances the
fake clock beyond the deadline and must produce exactly one abort and one
fallback dispatch.

## What Was Tested

### Failing-first proof

Before the classifier repair, the new matrix produced `9 pass, 6 fail`.
Every control event expected one watchdog abort but observed an empty abort
list. This reproduced the review finding through the production watchdog.

### Exact-source automated gates

- Progress/output classifier matrix: `35 pass, 0 fail`, 50 expectations.
- Full runtime-fallback suite: `330 pass, 0 fail`, 662 expectations across 48
  files.
- Main-session lifecycle, model-abort, root-state, rejected-abort, and disposal
  boundary suite: `33 pass, 0 fail`, 58 expectations across 5 files.
- OpenCode adapter `tsgo --noEmit`: pass.
- Biome 2.4.16 lint-only check: pass.
- Repository-bundled no-excuse audit: `No violations in 2 file(s).`
- `git diff --check`: pass.
- Changed files remain below the 250 pure-line ceiling.

### Isolated live OpenCode QA

The production-duration harness loaded the exact local plugin into an isolated
`HOME` and `XDG_*` sandbox with a local fake provider. It observed:

- Two active root sessions.
- Watchdog fallback for the older silent root after 90.006 seconds.
- Five primary requests closed and a successful fallback response.
- Deleting the newer root restored the older root as current and active.
- Fallback-owned success did not re-arm the watchdog.
- A later genuine user turn armed normally and its abort was classified as
  external.
- One sandbox session and an unchanged real OpenCode DB count (`5751`).
- All QA-owned processes and the temporary sandbox were removed.

## Observed Surface Limitation

The installed OpenCode build emitted zero `session.next.*` events in this live
scenario. The live run therefore proves the full watchdog/fallback lifecycle
and isolation at the exact source, while the deterministic real-watchdog
matrix proves the repaired typed event boundary. This limitation is recorded
instead of representing the live run as direct Next-event coverage.

## Why This Is Enough

The failing-first test toggles the exact mechanism: with the prefix classifier,
correctly shaped control events suppress recovery; with the semantic
classifier, the same events leave the deadline armed and fallback fires. The
full runtime-fallback and lifecycle suites protect the existing abort,
generation, deletion, disposal, and retry-key contracts. The isolated live
run proves that the merged source still works through the real OpenCode server,
SSE hook path, plugin loader, local provider boundary, and database isolation.

## What Was Omitted

- No real provider or paid API was used.
- Raw environment dumps, auth headers, and private credentials were not
  captured. The harness password and API key were local disposable values.
- Raw server logs were not promoted because they are noisy and may contain
  unnecessary environment detail. Sanitized plugin, provider, SSE, root-state,
  and isolation artifacts are preserved instead.

## Artifact Index

- `thirtieth-exact-integrity.txt`
- `thirtieth-exact-progress-event-matrix.txt`
- `thirtieth-exact-runtime-fallback-suite.txt`
- `thirtieth-exact-session-lifecycle-suite.txt`
- `thirtieth-exact-omo-opencode-typecheck.txt`
- `thirtieth-exact-biome.txt`
- `thirtieth-exact-no-excuse.txt`
- `thirtieth-exact-opencode-harness-self-check.txt`
- `thirtieth-exact-live-watchdog-run.txt`
- `thirtieth-exact-live-isolation-receipt.txt`
- `thirtieth-exact-live-plugin-watchdog.txt`
- `thirtieth-exact-live-fake-provider.txt`
- `thirtieth-exact-live-sse-events.jsonl`
- `thirtieth-exact-live-root-state.jsonl`

## Verdict

PASS at exact source `d0778a6cc23fb59977be4d6ce933cd4441a59db5`.
