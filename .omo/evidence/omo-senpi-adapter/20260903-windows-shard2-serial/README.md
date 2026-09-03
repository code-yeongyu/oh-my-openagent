# Windows Shard 2 Serial QA Evidence

## What Was Tested

1. Failing-first contract:
   `bun test script/ci-root-test-partition.test.ts`
2. Green contract after the workflow change:
   `bun test script/ci-root-test-partition.test.ts`
3. Required workflow regression set:
   `bun test script/ci-root-test-partition.test.ts script/ci-job-summary-workflow.test.ts script/windows-flake-soak-workflow.test.ts`
4. Repository-equivalent workflow lint:
   `actionlint -shellcheck="" .github/workflows/ci.yml`
5. Diff review of the Windows shard-2 remainder, its telemetry wrapper, the
   serial quarantine command, and the workflow-summary invariant.
6. Windows flake soak workflow run `33713505691`, dispatched against
   `ci/windows-shard2-serial` with `target=full-shard-2` and `iterations=3`.
   Each iteration ran both parts of shard 2 under serial execution.

The commands were run from the isolated
`ci/windows-shard2-serial` worktree.

## What Was Observed

- RED failed for the intended reason with the exact diagnostic:
  `windows shard 2 must remain serial while five-gate repairs are pending`.
  The full output is in `red.txt`.
- GREEN passed with `17 pass`, `0 fail`, and `96 expect() calls`.
  The full output is in `green.txt`.
- The required three-file regression set passed with `28 pass`, `0 fail`,
  and `203 expect() calls`. The full output is in `verification.txt`.
- Repository-equivalent actionlint exited 0 with no output. The command and
  result are in `actionlint.txt`.
- A plain actionlint run with shellcheck enabled reported the existing
  `SC2129` finding at the CI classifier block and `SC2016` finding at the
  draft-release block. Neither finding is in the changed Windows invocation.
  The repository's `lint-workflows` gate disables shellcheck, so the
  repository-equivalent actionlint command above is the relevant clean gate.
- CI run `33712499816` previously completed `test (windows-latest, 2/2)` with
  `5377 pass, 1 fail`. The single failure that triggered this investigation
  was:
  `omo setup credential inheritance > #given pinned omp and gjc databases #when accepted #then allow-listed rows import and unknown schema is noticed`.
  The job did not time out.
- Soak run `33713505691` completed successfully with three full iterations:
  - iteration 1: `89 pass / 0 fail` and `5379 pass / 0 fail`;
  - iteration 2: `89 pass / 0 fail` and `5379 pass / 0 fail`;
  - iteration 3: `89 pass / 0 fail` and `5379 pass / 0 fail`.
- The soak therefore executed `16404` tests under serial execution with zero
  failures.
- The Windows shard-2 job duration increased from approximately `7m44s` with
  `--parallel` to `10m38s` under serial execution, remaining far below the
  60-minute job timeout.
- The three clean serial iterations show that the earlier credential-
  inheritance failure was an intermittent flake, not a regression caused by
  serialization. Serializing Windows shard 2 is safe.

## Known Defect

The `.github/workflows/windows-flake-soak.yml` job summary reported
`SOAK_ITERATIONS_RAN=0` even though the run logs prove that all three requested
iterations completed. This counter defect is intentionally not fixed in this
PR. It must be addressed as follow-up work before relying on the summary for
trustworthy 20-pass receipts.

## Why It Is Enough

The failing-first contract proves that the previous telemetry-wrapped Windows
shard-2 remainder is rejected specifically for carrying `--parallel`. The
same contract then proves that the remainder keeps the telemetry invocation
and uses the unchanged `bunfig.win2.parallel.toml` without the parallel flag.

The combined regression run also proves that:

- the serial quarantine and root-test partition remain intact;
- every step-based job still writes its required Markdown job summary; and
- `.github/workflows/windows-flake-soak.yml` remains unchanged and satisfies
  its contract.

Actionlint provides the closest local execution surface for validating that
the edited GitHub Actions workflow remains structurally valid.

The dedicated Windows soak directly exercised both parts of shard 2 three
times with the proposed serial invocation. Its `16404` passing executions
cover the suspected module-state-leak risk and distinguish the prior isolated
failure from a deterministic serialization regression.

## What Was Omitted

This change only removes `--parallel` from the Windows shard-2 remainder. It
does not affect the separate `senpi-compatibility` job and does not affect
shard 1. It is expected to help only shard-2 flakes, such as the OpenClaw
reply-listener startup test and the
`script/senpi-hooks-state.test.ts` legacy-boundary test. This evidence does not
claim that the change fixes `senpi-compatibility` flakes.

No test was skipped, retried, or given a longer timeout. The serial quarantine
command was preserved. `bunfig.win2.parallel.toml` and
`.github/workflows/windows-flake-soak.yml` were not edited. CI was not awaited
because the requested stop point is immediately after PR creation.
