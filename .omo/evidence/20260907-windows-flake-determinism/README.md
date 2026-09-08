# Windows flake determinism (#7898)

## What was tested

- Host: gorky (Linux x86_64, bun 1.4.0, clone of dev b885f13f8), never the authoring machine. Raw transcripts: gorky-runs.txt.
- `bun test packages/omo-opencode/src/features/team-mode/tools/messaging.test.ts` (baseline, RED with the test change only, GREEN with the seam, per-test timings).
- `bun test script/senpi-hooks-state.test.ts` and `bun script/fixtures/senpi-hooks-state-legacy-reader.ts` directly, plus two fixture mutations.
- `tsgo --noEmit -p packages/omo-opencode/tsconfig.json` and `-p script/tsconfig.json`.
- Windows: `.github/workflows/windows-flake-soak.yml` on this branch, targets `team-message` and `hooks-state`, 20 iterations each (run links in the PR).

## What was observed

- Baseline: `inbox stays intact when live delivery fails so the fallback path still works` 8632 ms on Linux against a 12 s event budget; five cancelled-wake cases at ~2.5 s each; file 25.87 s.
- RED (test tightened, production unchanged): `timed out waiting for fallback wake after pre-send transport failure` at 3024 ms, rc 1.
- GREEN: same test 100 ms; file 41 pass / 0 fail in 7.96 s, slowest test 560 ms.
- hooks-state fixture output: `{"released":true,"truncatedReads":1,"lockAttempts":2,"state":{...hk_trusted...}}`; file 6 pass / 0 fail.
- Mutation "writer never releases": `lockAttempts: 10, released: false, hooks: {}` -> test fails (this is the exact shape of the Windows failure in #7898).
- Mutation "snapshot complete before read": counters 0 -> test fails.
- Typecheck rc 0 for both projects.

## Why it is enough

Both tests now wait on the event they depend on; no assertion depends on a duration. The only remaining timers are circuit breakers (3 s event timeout, 30 s subprocess timeout) that fail with a message. The mutations prove each new assertion can fail for the regression it names. The Windows soak repeats the exact previously-flaky targets on the runner class that flaked.

## What was omitted

No credentials, environment dumps, or private paths beyond /tmp on the disposable runner.
