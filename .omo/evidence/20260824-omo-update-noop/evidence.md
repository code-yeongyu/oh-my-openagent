# QA evidence: `omo update` honest refusal + non-zero exit (#7172)

## WHAT WAS TESTED

- Surface: the published omo-ai launcher (`packages/omo-native/bin/lib/launcher.js`, entry
  `bin/omo.js`), self-update branch only. No engine-spawn path was modified.
- Hermetic suite: `bun test packages/omo-native/test/launcher.test.ts` drives the REAL launcher
  binary via `spawnSync` against a fake senpi tree in a temp dir (fixture covers bun-global,
  bun-legacy, npm, and unknown install layouts; capture file proves senpi never spawns).
  New regression block "#when any self-update spelling is answered" covers every self-update
  spelling (`update`, `update --self|self|senpi|omo`) plus the Bun-layout command rendering.
- Real-binary drive: `HOME=<isolated tmp> node packages/omo-native/bin/omo.js update`.
- Scoped typecheck: `bunx tsc -p packages/omo-native/tsconfig.json --noEmit`.
- Entry smoke: `node packages/omo-native/bin/omo.js --version`.

## WHAT WAS OBSERVED

- RED (fix reverted to HEAD, new tests in place): all 6 new regression tests fail - launcher
  exits 0 with "omo is updated via ..." (exact log: `qa.log`, RED section).
- GREEN (fix applied): 43 pass / 0 fail for the full launcher suite, including the re-pointed
  assertions that previously pinned the old contract (`qa.log`, GREEN section).
- Real drive: exit code 1, stdout exactly:
  ```
  omo does not self-update (the senpi engine is version-pinned).
  Run: npm i -g omo-ai@beta
  ```
  stderr empty; isolated temp HOME untouched after the run (no state written by the refusal path).
- Typecheck OK; smoke prints `omo 5.0.0-0.beta.18 (engine: senpi 2026.8.23)`.

## WHY IT IS ENOUGH

The bug is the reporting contract of one branch: past-tense success wording + exit 0 on a path
that performs no update. The suite spawns the real binary per case and asserts exit status,
exact stdout, and that no child process runs - precisely the three observable behaviors the
issue asks to change, across every argument spelling and every install layout the branch can
encounter. The failing-first run proves the tests detect the defect; the green run plus the
real-binary drive prove the fix resolves it on the shipped entry point. Remaining risk is
limited to surfaces outside this package (see below).

## WHAT WAS OMITTED

- No live global-install update was performed (would mutate the host's real toolchain); the
  issue itself does not ask self-update to be implemented, only honest reporting.
- `payload.test.ts` ("staged payload" completeness) fails in this environment identically on a
  clean checkout: it needs `bun run build:omo-native`, whose chain requires shared-skills git
  submodules that cannot be fetched here (root `prepare` failed during `bun install`). Pre-existing,
  unrelated to this change; verified via stash run.
- Twin sites NOT changed (flagged as follow-up in the PR): the local-install launcher generator
  `packages/omo-senpi/src/install/local-launcher.ts` and its bundled artifact
  `plugin/scripts/install.mjs` print the same misleading line with exit 0 for local installs.
  Fixing them belongs to the senpi adapter gate (own QA protocol), kept out of this minimal fix.
- No secrets, tokens, or env dumps were produced or recorded by any of these commands.
