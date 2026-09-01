# RED: current `dev` CI failure

## What was tested

- Workflow: `CI`
- Run: `31522065556`
- Commit: `55326d2a8408920c8578a239aa39b9967595777f`
- Command inspected: `gh run view 31522065556 --log-failed`
- Failing surface: root `bun test` suite on `windows-latest`

## What was observed

The only failed job was `test (windows-latest)`. The root suite reported:

```text
1 tests failed:
(fail) gitHead and gitCommitsSince > #given five commits after a base sha #when counting #then it returns five [5516.00ms]
^ this test timed out after 5000ms.

14379 pass
61 skip
1 fail
Ran 14441 tests across 1865 files. [773.31s]
Process completed with exit code 1.
```

Ubuntu and macOS root test jobs passed. Windows typecheck, Codex compatibility,
and Senpi compatibility also passed.

## Why this is enough

This captures a right-reason failing-first proof from the exact required CI
surface. The assertion did not fail and the implementation did not return an
incorrect count. The test exceeded Bun's default five-second test budget while
creating a six-commit fixture on Windows.

## What was omitted

The full 6,350-line job log is not copied here because it contains unrelated
test output. No credentials or environment dumps are included.
