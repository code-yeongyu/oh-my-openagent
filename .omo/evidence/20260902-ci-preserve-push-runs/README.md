# CI concurrency preservation evidence

## Scope

- Branch: `fix/ci-preserve-merge-push-runs` from `origin/dev@a0dd6cc91`.
- Incident basis: the supplied repair plan identifies 25 cancelled CI runs and one
  cancelled Web CI run for merged commits because later pushes cancelled the same
  workflow/ref concurrency group.

## Change

Both `CI` and `Web CI` now set `cancel-in-progress` to
`${{ github.event_name == 'pull_request' }}`.

The concurrency group remains `${{ github.workflow }}-${{ github.ref }}`.

## Failing-first contract

Command:

```sh
bun test script/ci-fast-path.test.ts
```

Before either workflow changed, the new YAML-parsing contract failed with the
expected pull-request-only expression and `Received: true`; see
`red-contract-summary.txt`.

## Validation

- `bun test script/ci-fast-path.test.ts`: 14 pass, 0 fail. The added contract
  parses both workflows and requires the workflow/ref group plus the
  pull-request-only cancellation expression. See `green-focused-contract.txt`.
- `bun test script/ci-fast-path.test.ts script/ci-job-summary-workflow.test.ts`:
  18 pass, 0 fail. See `green-workflow-tests.txt`.
- `bun run typecheck:script`: exit 0. See `typecheck-script.txt`.
- `actionlint` 1.7.10 on both edited workflows: exit 0. See `actionlint.txt`.
- `actionlint` 1.7.10 using the repository workflow-lint invocation over every
  workflow: exit 0. See `actionlint-all-workflows.txt`.

Each command was run against the final worktree state on macOS arm64 with Bun
1.3.14, except the failing-first run, which intentionally used the old workflow
policy before the two workflow edits.

## Why this is enough

GitHub Actions evaluates `cancel-in-progress` for each run. The predicate is true
