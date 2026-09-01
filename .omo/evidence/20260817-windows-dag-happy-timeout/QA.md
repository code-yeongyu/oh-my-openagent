# QA - Windows mixed-eight DAG timeout

Base: `b57dcd82555ccf41c96b4e18bca2e19101666ca8` (`origin/dev` after PR #6928)
Runtime: Bun `1.3.12` (`700fc117`)

## Authoritative RED

PR #6937, Actions run `32030280199`, original Windows job `95388592225`:

```text
(fail) DAG happy-path end to end > #given eight mixed-route nodes across four waves #when the real engine runs #then routes, membership, events, and outputs stay intact [6454.00ms]
  ^ this test timed out after 5000ms.

15678 pass
73 skip
1 fail
```

No assertion failure was emitted. The next two tests passed in the same process.

## Local timeout-mutation RED

Command: Bun 1.3.12 focused file with the mixed-eight budget temporarily changed to `1ms`.

```text
(fail) ... eight mixed-route nodes across four waves ... [68.72ms]
  ^ this test timed out after 1ms.
(pass) ... completed run key ... [16.42ms]
(pass) ... shipped SDK builder ... [35.74ms]

4 pass
1 fail
81 expect() calls
```

The expectation count is identical to GREEN, proving the real event-driven run and all assertions completed; only the test-runner deadline failed. Full output: `red-timeout-mutation-bun-1.3.12.txt`.

## Post-rebase GREEN

### Focused happy-path E2E

```text
$ npm exec --yes --package=bun@1.3.12 -- bun test packages/senpi-task/src/dag/e2e-happy.test.ts

(pass) ... eight mixed-route nodes across four waves ... [78.77ms]
5 pass
0 fail
81 expect() calls
```

Full output: `post-rebase-focused-bun-1.3.12.txt`.

### Affected package

```text
$ npm exec --yes --package=bun@1.3.12 -- bun test packages/senpi-task

1612 pass
1 skip
0 fail
1 snapshots, 5114 expect() calls
Ran 1613 tests across 234 files. [23.20s]
```

### Root typecheck

```text
$ npm exec --yes --package=bun@1.3.12 -- bun run typecheck
$ tsgo --noEmit && bun run typecheck:script && bun run typecheck:packages
```

Exit code `0`, including `packages/senpi-task/tsconfig.json`.

### Root build

```text
$ npm exec --yes --package=bun@1.3.12 -- bun run build
build: all steps completed
```

Build-generated tracked artifacts were restored because they were unrelated byte drift; the PR contains only the test budget and evidence.

### Static checks

```text
pure LOC packages/senpi-task/src/dag/e2e-happy.test.ts: 344
git diff --check: clean
no-excuse audit: No violations in 1 file(s).
```

## Root-shard local limitation

A local Bun 1.3.12 `--shard=2/2` run executed without CI's full install/prepare path after an `--ignore-scripts` dependency install. It reached `15714 pass / 18 skip / 20 fail`; all 20 failures were unrelated materialized-package/install-dist checks (missing generated Codex/Senpi payloads and submodule materialization), not `senpi-task` or the changed E2E. The affected package suite and root typecheck/build are green. The PR's fresh `windows-latest, 2/2` check is the authoritative root-shard gate.

## Required remote QA

The PR must not merge until its own `test (windows-latest, 2/2)` check passes. PR #6937 reruns are not evidence for this fix.
