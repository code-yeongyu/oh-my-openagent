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
