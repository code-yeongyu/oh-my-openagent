# DAG completion verification directive - evidence

Worktree: /private/tmp/ulw-wt-dag-directive (branch feat/dag-completion-verification-directive)
Base commit: 5d2742bf7232bb8a8691936d06c043b5d81d4cea

## RED (before any production code)

- `red-notification.txt` - FAIL: `Cannot find module './dag-verification-directive'`. Correct reason (missing module), no syntax errors.
- `red-dag-wake.txt` - FAIL: `Export named 'DAG_VERIFICATION_DIRECTIVE' not found in module .../senpi-task/src/index.ts`. Correct reason (missing export).

## Directive byte-equality

- `expected-directive.txt` holds the specified directive text. Compared against the exported
  `DAG_VERIFICATION_DIRECTIVE` via a Bun one-liner: `match: true` (exact, no trailing newline).

## GREEN

- `green-completion.txt` - PASS. `bun test packages/senpi-task/src/completion/` -> 62 pass / 0 fail.
- `green-dag-wake.txt` - PASS. `bun test packages/omo-senpi/src/components/task/dag-wake.test.ts` -> 10 pass / 0 fail.
- `green-senpi-task-full.txt` - PASS. `cd packages/senpi-task && bun test` -> 1686 pass / 1 skip / 0 fail.
- `green-omo-senpi-full.txt` - `cd packages/omo-senpi && bun test` -> 2090 pass / 27 fail. WRONG CWD (see below).
- `green-omo-senpi-rootcwd.txt` - `bun test packages/omo-senpi` from repo root (CI-accurate) -> 2104 pass / 13 fail.
- `typecheck-senpi-task.txt` - PASS. `bun run typecheck` (tsgo --noEmit) exit 0.
- `typecheck-omo-senpi.txt` - PASS. `bun run typecheck` (tsgo --noEmit) exit 0.

## CWD finding

14 of the 27 package-CWD failures are pure CWD artifacts: those tests resolve paths relative to the
repo root (e.g. `ENOENT ... packages/omo-senpi/packages/omo-senpi/scripts/qa/drive.mjs`,
`scandir 'packages/omo-senpi/src/components/lsp'`, root `package.json` workspaces read).
Per root AGENTS.md, CI runs the senpi gate as `bun test packages/omo-senpi` from the repo root.
Re-running those three files from the repo root: 15 pass / 0 fail. Files affected:
`scripts/qa/task-13.test.ts` (8), `src/package-shape.test.ts` (3), `src/components/ultrawork/ultrawork.test.ts` (2),
`src/components/lsp/lsp-architecture.test.ts` (1).

## Failure attribution (baseline adjudication)

A pristine detached worktree at 5d2742bf7 (node_modules symlinked) was run unmodified:
`baseline-omo-senpi-full.txt` -> 2075 pass / 40 fail across 13 files.

| Comparison | Result |
|---|---|
| package-CWD: 27 failures / 8 files, vs baseline | `comm -13 baseline green` = EMPTY -> zero MINE-ONLY |
| root-CWD: 13 failures / 4 files, vs baseline | `comm -13 baseline rootcwd` = EMPTY -> zero MINE-ONLY |
| reconciliation | 27 mine + 13 baseline-only = 40 baseline total (exact) |

Sorted name lists: `baseline-fails.txt`, `green-fails.txt`, `rootcwd-fails.txt`.

Every failure observed with the change reproduces at baseline, name-for-name and file-for-file.
Zero DAG/completion/wake failures in either run (`grep '^(fail)' | grep -i dag` -> NONE);
all 20+ DAG-related tests in the root-CWD run pass. `src/components/task/dag-runtime.test.ts`
failed at BASELINE and passes in both of my runs.

## Baseline worktree cleanup receipt

```
git worktree remove /tmp/ulw-dag-baseline --force     # symlinked node_modules unlinked first
git worktree prune -v                                 # exit 0, no output
git worktree list | grep -i ulw-dag-baseline          # ABSENT
ls -d /tmp/ulw-dag-baseline                           # No such file or directory
```
