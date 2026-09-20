# Independent QA review

## Verdict

PASS. No blocking QA defect was found in the current diff or in the evidence for C001-C003.
The reviewed source diff is bound to base
`91ca94f642ef9d8de8b5c9b95bdf25e9ad94b7ad` and has SHA-1
`03549c9d067af1e3784179d3023b1088ecb48472`, matching the ULW evidence ledger.

## Evidence review

### C001 — fixed process table across the launcher boundary

- The RED artifact drove the copied `bin/omo.js` launcher and failed only because pid `853501`
  was absent from the report before the seam existed.
- The GREEN artifact drove the same copied launcher and passed the fixed, empty, malformed, and
  forged-reap cases (5/5).
- The separate Node manual driver also copied the packaged launcher and observed
  `fixturePidReported=true`; it did not call report helpers directly.
- Source inspection confirms the fixture replaces the normal report list. It is not concatenated
  with the live process table.

This is a real CLI/subprocess surface with a valid failing-first proof, not a helper-only test.

### C002 — deterministic normal reports

- Every launcher spawn in `doctor.test.ts` supplies
  `OMO_TEST_DOCTOR_PROCESS_TABLE_JSON`: the shared helper defaults to `[]`, the canonical-home spawn
  uses `envWithoutAgentDir`, and the reap case supplies its forged fixture explicitly.
- Empty and malformed input return an empty list from `reportProcessList`; source inspection shows
  neither branch falls through to `listProcesses`.
- The independent rerun of the affected pair produced exactly 33 passes, 0 failures, and 100
  assertions across `doctor.test.ts` and `doctor-stale-engines.test.ts`.
- The temporary-fixture inventory was empty after the test and manual runs.

The individual malformed-input artifact does not repeat the tree hash or a cleanup receipt, even
though its ULW ledger entry binds it to the current diff hash and the suite/final-check artifacts
provide the cleanup receipt. This is a documentation granularity mismatch, not a behavioral blocker.

### C003 — report data cannot authorize reap

- `reapStaleEngines` still selects `options.list ?? listProcesses`; it never calls
  `reportProcessList` and therefore never consumes the test-only environment fixture.
- The mutation artifact is discriminating: temporarily routing reap through the report list changed
  the forged-reap status from refusal (`1`) to success (`0`), so the assertion failed for the
  intended trust-boundary reason.
- Restored GREEN drove the copied launcher, observed a non-zero refusal, proved the sacrificial
  child was alive after the attempt, then proved it was dead after `finally` cleanup.
- An independent rerun of the manual driver reproduced
  `FORGED_REAP status=1 refused=true childAliveAfterAttempt=true`, followed by
  `CLEANUP childAlive=false` and `CLEANUP fixtureExists=false`.

This covers the destructive boundary with both mutation RED and restored GREEN evidence.

## Local gate accuracy

- Scoped gate: independently reproduced as 33/33 passing with 100 assertions.
- Full package tsconfig: correctly **not** claimed as passing. This worktree has no root or package
  `node_modules`; the direct package command first fails to resolve `bun-types`. When the isolated
  type runtime is supplied as `typeRoots`, TypeScript proceeds and reports the pre-existing missing
  Senpi/Pi deep imports plus `zod`. The targeted changed test file check is therefore a reasonable
  local substitute, while installed-workspace CI remains the authoritative full check.
- Broad five-file doctor run: independently reproduced as 53 passes and 1 failure. The sole failure
  is the unchanged `doctor-edition.test.ts` registry-unavailable assertion matching the existing
  missing-package/Senpi diagnostic (including the npm reinstall text) in this dependency-free
  worktree. None of the process-table cases fail. The limitation described in
  `independent-local-gates.txt` is accurate.
- `git diff --check` passes and no `omo-doctor-*` temporary directory remains.

## False-pass and host-dependence assessment

- The fixed non-empty fixture makes the subprocess seam observable even on Windows, where the
  production process reader is otherwise empty.
- The empty/malformed black-box assertions alone cannot prove on a clean Windows host that `ps` was
  never consulted. That guarantee currently also relies on direct inspection of the small
  `reportProcessList` branch. This is a residual test-strength limitation, not current host
  dependence in the implementation.
- Current live evidence is Windows-only. POSIX behavior relies on the same environment parsing and
  subprocess interface, but Linux/macOS CI should remain required before merge because those
  platforms exercise the real `ps` path and signal semantics.
- The test-only variable is still present in production code by design. If a user deliberately sets
  it, normal process warnings can be hidden; it cannot authorize signaling because reap ignores it.

## Residual risk

The remaining risk is limited to cross-platform execution and the intentionally private report-only
environment seam. No classification rule, production process reader, or reap authorization rule was
changed. Remote installed-workspace CI is required before merge; no additional local blocker was
found.
