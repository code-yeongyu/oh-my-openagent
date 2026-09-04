# PR 7621 orphaned recovery-claim QA

Tested source commit: `baf667d576ec1d72adce0ae279b7db2526336e14`

## What was tested

- Failing-first orphan regression:
  `/tmp/bun-v1.4.0-darwin-aarch64/bun-darwin-aarch64/bun test packages/memory-core/src/locks/stale-recovery-lock.test.ts`
- Deterministic two-reclaimer ABA regression using promise barriers, with no
  sleeps or polling.
- Full lock suite:
  `/tmp/bun-v1.4.0-darwin-aarch64/bun-darwin-aarch64/bun test packages/memory-core/src/locks`
- Package typechecks:
  `bun x tsgo --noEmit -p packages/memory-core/tsconfig.json`
  and
  `bun x tsgo --noEmit -p packages/omo-senpi/tsconfig.json`
- Generated Senpi bundle refresh:
  `bun run build:senpi-plugin`
- Exact package gate with official Bun 1.4.0:
  `bun run test:senpi`
- Live harness preflight:
  `node packages/omo-senpi/scripts/qa/drive.mjs --self-test`
- Real isolated Senpi run:
  `node packages/omo-senpi/scripts/qa/drive.mjs`

## What was observed

- The original orphan regression failed as intended: 5 passed and 1 failed
  because the deterministic claim pathname remained blocked.
- The first claimant-record repair was rejected by a deterministic ABA
  regression: 6 passed and 1 failed because a paused reclaimer displaced the
  elected live claimant.
- The immutable successor protocol passed all 9 focused recovery tests,
  including orphan progress, legacy fail-closed behavior, a replacement-owner
  race, bounded-chain diagnostics, candidate sweeping, and the two-reclaimer
  schedule.
- The complete lock suite passed: 28 tests, 0 failures, 79 assertions.
- Both package typechecks completed with exit code 0 and no diagnostics.
- The exact Senpi gate passed: 2677 tests passed, 32 skipped, 0 failed, 8503
  assertions across 352 files.
- The live driver reported `result=PASS`, injected ultrawork correctly, and
  passed comment checking. It used `<sandbox>/agent` rather than a caller
  agent directory and attributed no changed paths to either observed real
  agent home.
- On this macOS host, directory-identity certification correctly failed closed
  with `DIRECTORY_IDENTITY_UNAVAILABLE`; protected-state snapshots were
  complete and reported no errors. See `live-driver.json`.

## Why this is enough

The focused tests directly exercise the reported crash gap and the adversarial
two-contender interleaving that invalidated pathname deletion and reuse. The
full lock suite covers ordinary publication, live-owner exclusion, PID reuse,
cross-host fail-closed behavior, subprocess contention, and candidate cleanup.
The package gate proves the generated Senpi consumers remain compatible, while
the real driver proves the built adapter still loads and runs in an isolated
Senpi session.

## What was omitted

Raw host-specific home paths, usernames, private skill inventories, credentials,
tokens, and full environment dumps were not copied. Sandbox and real-home paths
are normalized in the committed artifact. The skipped tests are the gate's
documented platform/fixture skips, not suppressed failures.
