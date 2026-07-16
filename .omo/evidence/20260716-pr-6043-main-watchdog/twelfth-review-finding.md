# Twelfth Review Finding: Delayed Abort Provenance Was Cleared Too Early

Reviewed head: `d57bd79bf3d157ef01649a089f6b257e4dcc4128`

Reviewer: `019f6c18-3e06-7be2-b65b-fb96440fdf98`

Verdict: `FINDING HIGH`

## Finding

Generation one can dispatch a fallback and retain an abort event that arrives
late. If generation two is then externally cancelled, the watchdog's broad
`cancel()` cleanup erased generation one's abort provenance. Generation three
could arm before the delayed generation-one abort arrived, causing that old
abort to be classified as generation three's terminal event and cancelling the
new watchdog.

The same loss existed in two external-cancellation paths: assistant-parent
correlation and status resolution. The reviewer reproduction observed one
dispatch and no third-turn recovery:

```json
{"dispatchCount":1,"thirdTurnRecovered":false,"stateModel":"openai/gpt-5.4-mini","attemptCount":0}
```

## Failing-First Proof

- `twelfth-review-red-three-generation-abort.txt`: direct progress resolution
  returned `undefined` instead of `defer-terminal` after generation three
  armed.
- `twelfth-review-red-status-resolution-provenance.txt`: independently toggling
  the status-resolution call site reproduced the same failure.

## Repair

Runtime commit `03762c06deaee52f60b07d9c227c634a9e7e955e` makes cancellation
optionally preserve older abort tombstones. Only the three current-generation
external-cancellation paths use preservation. Explicit terminal, stop, delete,
and normal lifecycle cleanup still clear all provenance.

The two three-generation regressions live in
`first-prompt-watchdog-three-generation.test.ts`, keeping every changed source
and test file below 250 pure LOC.

## Verification

- Focused watchdog/race suite: 26 pass, 0 fail.
- Full runtime-fallback suite: 279 pass, 0 fail across 36 files.
- OpenCode adapter typecheck, scoped Biome, and no-excuse audit: pass.
- OpenCode QA harness self-check: pass with isolated XDG cleanup.
- Production-duration live OpenCode run at exact runtime head: `fallback_seen=yes`,
  `fallback_watchdog_rearmed=no`, `later_user_abort=external`, and
  `real_db_unchanged=yes`.

## Why This Is Enough

The red/green toggle independently covers both provenance-loss call sites, the
full hook suite covers surrounding lifecycle behavior, and the real harness
proves the production watchdog, fallback dispatch, later cancellation, and DB
isolation through OpenCode's actual event surface.

## Omitted

Raw credentials, auth headers, environment dumps, transient session IDs, and
private logs are omitted. The live harness uses local dummy credentials and
records only reviewer-readable behavior and isolation receipts.
