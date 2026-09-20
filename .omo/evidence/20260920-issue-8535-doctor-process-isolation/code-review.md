# Independent code review: issue #8535

## Scope reviewed

- `packages/omo-native/bin/lib/doctor.js`
- `packages/omo-native/test/doctor.test.ts`
- The `runDoctor` to report/reap call paths and the existing stale-engine and retired-payload tests
- The complete worktree diff against `dev`

## Result

No actionable findings.

## Boundary analysis

- The production default is preserved. When no explicit `options.list` and no
  `OMO_TEST_DOCTOR_PROCESS_TABLE_JSON` variable exist, `reportProcessList` returns the existing
  `listProcesses` function (`doctor.js:150-152`). Both process-derived, non-destructive report
  paths now use that selector (`doctor.js:317`, `doctor.js:382`).
- Explicit report fixtures fail closed. The JSON must be an array whose entries carry integer
  `pid`/`ppid` fields and string `elapsed`/`tty`/`command` fields; a wrong shape or parse failure
  returns an empty list rather than falling through to the host process table (`doctor.js:153-169`).
- The destructive boundary is intact. `reapStaleEngines` still resolves its process source through
  `options.list ?? listProcesses` and never calls `reportProcessList` (`doctor.js:283`). Therefore
  the subprocess environment fixture can influence diagnostic output but cannot authorize a
  signal.
- The copied-launcher tests set an explicit empty table for every ordinary spawn through `run`
  (`doctor.test.ts:52-61`) and for the no-agent-dir spawn through `envWithoutAgentDir`
  (`doctor.test.ts:254-266`). This removes dependence on a developer's live OMO sessions without
  changing classification rules.
- The reap-safety test uses a dedicated sacrificial child, asserts that the copied launcher refuses
  the forged entry and that the child remains alive, and terminates that child in `finally`
  (`doctor.test.ts:143-181`). It never targets the test runner or a user process.
- The patch does not modify `classifyEngineProcesses`, `classifyRetiredPayloadEngines`,
  `reapStaleEngines`, the launcher dispatch, package metadata, or any public configuration surface.
  `git diff --check` is clean.

## Input, platform, race, and cleanup review

- The environment input is parsed in the launched process and uses only JSON scalar fields, so it
  does not introduce executable input or path lookup.
- Windows retains its existing empty live-process behavior; the injected report table remains
  usable because it is selected before `listProcesses`. POSIX continues to use `ps` when the test
  variable is absent.
- The child `exit` listener is installed before cleanup sends the termination signal. The spawned
  command is an isolated long-lived process, and `finally` runs even if a reap assertion fails.
- Temporary package fixtures remain covered by the existing `afterEach` removal. The reviewed
  evidence also records zero remaining `omo-doctor-*` fixture directories and no surviving
  sacrificial child.

## Residual risk

- The seam is intentionally selected by an internal `OMO_TEST_` environment variable rather than
  a build-time test flag. A caller who deliberately exports that undocumented variable can suppress
  process-derived report warnings for that invocation. It still cannot affect `--reap`, and the
  narrow name plus issue design make this an accepted non-blocking tradeoff.
- The empty/malformed subprocess assertions prove output behavior, while the stronger guarantee
  that no host fallback occurs is also established by direct inspection of the selector branch.
  A test-only fake `ps` probe could measure the absence of the read, but it would add
  platform-specific machinery without changing the safety conclusion.
- This review did not treat the dependency-free worktree's unavailable repository-wide typecheck
  as product evidence. The focused tests and targeted typecheck are recorded separately; the full
  installed-workspace CI gate remains required before merge.

## What was omitted

No credentials, environment dump, host process listing, private paths, or process identifiers were
copied into this review. No product code or tests were modified by the reviewer.
