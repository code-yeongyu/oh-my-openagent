# Issue #8535 doctor fixture isolation evidence

## Change under test

The copied-launcher helper in `packages/omo-native/test/doctor.test.ts` now removes all supported inherited agent-directory variables before applying fixture-controlled overrides. Production doctor behavior and agent-directory precedence are unchanged.

## Evidence index

- `red-ambient-agent-dir.txt`: failing-first reproduction on the unmodified source.
- `green-hostile-agent-dir.txt`: focused and neighboring doctor suites after the fix.
- `manual-copied-launcher.txt`: single copied-launcher surface check under a hostile ambient variable.
- `typecheck-and-scope.txt`: TypeScript, whitespace, cleanup, and source-scope checks.
- `package-gate-windows-baseline.txt`: package-wide test result and unrelated Windows environment limitations.

## Coverage judgment

The RED run proves the corrected cause: canonical ambient state shadows the fixture's legacy override. The GREEN run proves that the test helper owns all agent-directory inputs while preserving explicit per-test overrides. The copied real launcher, neighboring stale-engine tests, package typecheck, and source-scope checks cover the intended behavior without introducing a production seam.

## Omitted data

Raw environment dumps, absolute workstation paths, random temporary names, process tables, credentials, and auth material are not retained.
