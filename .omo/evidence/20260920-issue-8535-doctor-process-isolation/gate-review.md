# Final gate review: issue #8535

## Verdict

PASS. No commit or PR-opening blocker was found. The patch satisfies issue #8535 within the stated
scope and is ready to commit and open as one atomic PR against `dev`.

This verdict does not authorize merge before the required remote CI and review gates pass.

## Requirement match

- The copied-launcher tests no longer inherit the developer process table. The shared `run` helper
  supplies `OMO_TEST_DOCTOR_PROCESS_TABLE_JSON=[]` by default, and the separate canonical-home spawn
  receives the same controlled input through `envWithoutAgentDir`
  (`packages/omo-native/test/doctor.test.ts:52-61`, `255-265`). This covers the four host-dependent
  assertions named in issue #8535 as well as the rest of that file.
- A non-empty fixed fixture crosses the real launcher subprocess boundary and produces the expected
  stale-engine warning for pid `853501` (`doctor.test.ts:99-116`). This distinguishes a working seam
  from a test that only happens to pass on a quiet machine.
- The implementation changes only the two non-destructive process-derived reports. With no injected
  `options.list` and no test variable, `reportProcessList` returns the existing live `listProcesses`
  reader (`packages/omo-native/bin/lib/doctor.js:150-169`, `316-318`, `381-391`). Production default
  behavior and classification rules are unchanged.
- Empty, malformed, and structurally invalid fixtures fail closed to an empty report source instead
  of falling back to the host table (`doctor.js:153-168`; `doctor.test.ts:119-141`).
- The destructive boundary remains separate. `reapStaleEngines` still resolves
  `options.list ?? listProcesses` and never reads the report fixture (`doctor.js:263-313`). The
  forged-fixture test targets a dedicated sacrificial child, proves refusal and post-attempt
  liveness, and removes it in `finally` (`doctor.test.ts:143-178`).

## Evidence audit

- The RED artifact shows the copied launcher completed normally before implementation but omitted
  pid `853501`, failing the intended assertion.
- The restored GREEN artifact passes all five new boundary cases. The mutation artifact is
  discriminating: routing reap through the forged report list changes the command from refusal to
  success and fails the safety assertion.
- The manual driver independently records fixed, empty, malformed, and forged-reap results across
  the packaged launcher boundary, including child and fixture cleanup receipts.
- The current product/test diff SHA-1 is
  `03549c9d067af1e3784179d3023b1088ecb48472`, matching the C001-C003 ULW evidence entries. The base
  commit is `91ca94f642ef9d8de8b5c9b95bdf25e9ad94b7ad`.
- This gate reran both affected files with Bun 1.4.2: 33 tests passed, 0 failed, with 100 assertions.
  `node --check packages/omo-native/bin/lib/doctor.js`, `git diff --check`, and the temporary-fixture
  cleanup check also passed; zero `omo-doctor-*` directories remained.
- The independent code and QA reviews report no actionable findings. Their stated limitations match
  the raw artifacts: the isolated worktree cannot provide the installed-workspace package
  typecheck, and the broader dependency-free run has one unchanged registry/dependency failure.

## Scope and false-pass check

The tracked patch is limited to `packages/omo-native/bin/lib/doctor.js` and
`packages/omo-native/test/doctor.test.ts`. It does not change process classification, kill policy,
package metadata, lockfiles, CI, or public configuration. The evidence directory is the only other
pending path.

The empty-fixture assertions alone would be weak on a quiet Windows host. That false pass is ruled
out by the fixed non-empty fixture, the source-level no-fallback branch, the forged-reap mutation
failure, and the independent manual launcher run.

## Residual risk and remote gates

- The private `OMO_TEST_` variable exists in shipped code. A caller who deliberately sets it can
  suppress process-derived diagnostic warnings for that invocation. It cannot authorize a signal,
  because `--reap` ignores it. This is an accepted, scoped tradeoff from the issue's requested
  subprocess seam.
- Local live evidence is Windows-only. Linux and macOS CI must exercise the POSIX `ps` reader and
  signal behavior, and Windows CI must retain the copied-launcher coverage.
- The full installed-workspace typecheck and repository CI were not available as local evidence.
  They remain mandatory before merge, along with Cubic and any repository review-claim gate.

No blocker remains for commit or PR creation. Do not merge on the strength of this local gate alone.
