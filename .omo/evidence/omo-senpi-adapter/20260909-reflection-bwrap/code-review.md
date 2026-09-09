# Code review: reflection bind-source initialization

Verdict: no blocking source findings.
Reviewer: implementation lead, separate from the final gate reviewer.
Scope: `sandbox-platform.ts` and `sandbox-absent-paths.test.ts` against
base `6d7889172`; generated extension files came from `bun run test:senpi`.

## Programming perspective

- The fix uses the already imported memory-core filesystem wrapper. No new
  dependency, exported type, assertion escape, or error-suppression path exists.
- Recursive `mkdirSync` operates on the canonical, explicitly declared writable
  directory list. New directories use mode `0700`; existing directory modes
  are not reset. Filesystem failures propagate rather than disabling isolation.
- Placement is after unavailable/disabled policy returns, bwrap usability
  checks, lock-path handling, and the Darwin branch. Linux binding arguments
  remain exact and unchanged.
- The operation addresses the real bwrap precondition at the boundary where
  it is needed. It does not change the identity launch API or add an unrelated
  compatibility path.
- New regression assertions inspect actual directory existence, type, and
  mode as well as machine-consumed bind arguments. No new sleeps, polling,
  skipped tests, or prose assertions were added.

## Remove-ai-slops and overfit perspective

- The production addition is a three-line loop and an explanation of the OS
  failure it prevents. There is no new production helper, redundant parser,
  speculative interface, unused import, or duplicated validation.
- Existing test setup is reused. The two new assertion helpers are used in
  multiple cases and describe repeated filesystem/argv checks, not production
  implementation text.
- Coverage is not tied only to one identity: it includes a missing runtime
  directory, missing nested ancestors, and off/unavailable/Darwin behavior.
  No hard-coded user path is in the production code or regression tests.
- The real CLI/bwrap reproducer fails before the fix and passes afterward.
  It verifies writes inside the grant and an unchanged outside file, so a
  bypassed sandbox or broadened parent mount would not satisfy the evidence.
- No unrelated refactor or cleanup is needed for this bounded change.

## Verification reviewed

- Focused regression: two intended failures before the fix, eight passes after.
- Existing sandbox suite: 15 passes and one existing platform skip.
- Adapter type check: exit 0.
- Full adapter gate: exit 0, 3,047 passes, three existing skips, zero failures;
  evidence-resolver suite: 10 passes. See `full-gate.txt`.
- Real surface: `live-bwrap-before.txt`, `live-bwrap.mjs`, and
  `live-bwrap.json`; final receipt records sandbox enabled, exit 0, modes 700,
  granted write success, outside file unchanged, and cleanup complete.

No additional test/build rerun was performed solely to write this report.
The final gate reviewer independently checks the source and these artifacts.
