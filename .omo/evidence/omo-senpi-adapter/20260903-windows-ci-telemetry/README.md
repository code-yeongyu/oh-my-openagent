# Windows CI Telemetry Evidence

## What was tested

- Native Windows CI run
  [33701704942](https://github.com/code-yeongyu/oh-my-openagent/actions/runs/33701704942)
  at commit `f57a652e3` exercised the complete 18-job matrix, including
  `senpi-compatibility (windows-latest)`, `test (windows-latest, 1/2)`, and
  `test (windows-latest, 2/2)`.
- The two Windows root-test telemetry artifacts from that run were downloaded
  and inspected:
  `windows-root-test-telemetry-33701704942-1-shard-1` and
  `windows-root-test-telemetry-33701704942-1-shard-2`.
- TDD RED:
  `bun test script/ci-root-test-partition.test.ts` against the contract before
  telemetry implementation.
- Senpi coverage TDD RED:
  `bun test script/ci-root-test-partition.test.ts` after adding the Windows
  Senpi telemetry contract and before changing `.github/workflows/ci.yml`.
- Contract GREEN:
  `bun test script/ci-root-test-partition.test.ts`.
- Required local gate:
  `bun test script/ci-root-test-partition.test.ts script/ci-fast-path.full-matrix.test.ts`.
- Workflow validation:
  `actionlint -shellcheck= .github/workflows/ci.yml`. The repository's workflow
  lint configuration disables shellcheck and validates the Actions/YAML
  contract.
- TypeScript review:
  LSP diagnostics and the programming skill's
  `check-no-excuse-rules.ts` against `script/ci-root-test-partition.test.ts`.
- Senpi QA:
  `node packages/omo-senpi/scripts/qa/drive.mjs --self-test`,
  `node packages/omo-senpi/scripts/qa/drive.mjs`,
  `tsgo --noEmit -p packages/omo-senpi/tsconfig.json`, and
  `bun run test:senpi`.

## What was observed

- CI run `33701704942` completed successfully with all 18 jobs green.
- GitHub reported exactly two artifacts:
  `windows-root-test-telemetry-33701704942-1-shard-1` (601 bytes) and
  `windows-root-test-telemetry-33701704942-1-shard-2` (1,246 bytes).
- The shard 1 artifact contains `shard-1.json`. The shard 2 artifact contains
  `shard-2-quarantine.json` and `shard-2-remainder.json`.
- Every telemetry JSON records both `timing.preTest` and `timing.postTest`.
  Each post-test UTC timestamp and stopwatch timestamp is greater than its
  matching pre-test value, so both clocks are monotonic across each test
  invocation.
- Every telemetry JSON records `testExitCode: 0`, plus named
  `telemetryProcess` and `testProcess` records with `pid`, `parentPid`, and
  `creationTimeUtc`. No surviving descendants or telemetry errors were
  reported.
- Telemetry did not alter any test outcome: each wrapped Bun invocation
  returned exit code `0`, and the full CI run remained green.
- RED failed for the intended reason with the exact diagnostic:
  `windows telemetry contract: missing post-test capture`.
- Six of nine observed `windows-latest` failures occurred in
  `senpi-compatibility`, while only three occurred in the instrumented root
  test shards. The Senpi failures included `memory run supervisor > released
  child`, `reflection and dream run reconciliation`, `ordered delivery
  mailbox`, and three `assembled DAG runtime` cases.
- Run
  [33703009335](https://github.com/code-yeongyu/oh-my-openagent/actions/runs/33703009335)
  failed in `senpi-compatibility (windows-latest)` on `assembled DAG runtime >
  #given an unknown node skill` and produced no Senpi telemetry because that
  job was not instrumented.
- The Senpi coverage RED failed with
  `Windows Senpi compatibility tests must be telemetry-wrapped`, received
  workflow step index `-1`, and exited `1`. The full RED and GREEN outputs are
  appended to `tdd-red.txt`.
- After the workflow change, the focused GREEN passed 16 tests with 93
  expectations and exited `0`.
- The coverage-extension two-file gate passed 37 tests with 151 expectations,
  and `actionlint -shellcheck= .github/workflows/ci.yml` exited `0` with no
  output.
- The focused GREEN run passed 15 tests with 81 expectations.
- The final required two-file run passed 36 tests with 139 expectations.
- `actionlint -shellcheck=` exited 0 with no output.
- The strict TypeScript audit reported no violations.
- The Senpi driver self-test reported `SELF-TEST OK`.
- The live Senpi driver reported `PASS`, proved ultrawork injection and comment
  checking, used an isolated temporary agent directory, and reported both the
  real `~/.senpi/agent` and `~/.omo/agent` untouched.
- The Senpi package gate passed 2,537 tests with one declared skip and zero
  failures, then passed all 10 evidence-resolver tests.

## Why it is enough

The contract tests pin the machine-consumed workflow and collector invariants:
all three Windows Bun invocations use the telemetry wrapper, the wrapper records
pre/post QPC and UTC timing plus allowlisted process and temporary-path data,
the Bun exit code remains authoritative, and a uniquely named artifact uploads
from an `always()` step with telemetry failures marked non-gating. The live
Senpi run proves the CI-facing Senpi surface still loads through the real
harness in isolation. Native Windows run `33701704942` proves the wrapper
captured the expected fields for all three real Windows Bun invocations while
all 18 jobs passed. Together, the contract tests, isolated live Senpi run, and
downloaded Windows artifacts cover both the collector contract and its
observable behavior in the required CI environment.

The coverage extension applies that same collector to the flaky
`bun test packages/omo-senpi` invocation on Windows only. It leaves the
Linux/macOS Bash step unchanged, preserves the preceding Windows build, pack,
daemon test, typecheck, and evidence-resolver order, exits with the wrapped
test's real status, and uploads `senpi-compatibility.json` from a separate
non-gating `if: always()` artifact step. This closes the larger uncovered
surface represented by six of the nine observed Windows failures.

## What was omitted

Raw environment dumps, command lines, credentials, tokens, cookies, and full
host logs were not captured. The evidence records only allowlisted process
metadata, temporary paths, exit status, selected isolation fields, and
reviewer-relevant command summaries. The downloaded artifacts omit test stdout
and stderr because those remain available in the linked CI run and are not
needed to establish the telemetry schema or process lineage.
