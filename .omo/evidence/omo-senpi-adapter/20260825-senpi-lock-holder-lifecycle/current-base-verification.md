# Current-base verification receipt

## Base integration

- Branch: `fix/senpi-memory-lock-holder-lifecycle`
- Previous base: `26865364e`
- Current `origin/dev` base: `8c57e463e`
- Method: force-stage ignored plan/evidence, stash the complete dirty lane, fast-forward to current `origin/dev`, restore the stash.
- Result: no conflicts and no lost source, test, plan, or evidence artifacts.

## Focused process regressions

Command, repeated three times:

```sh
bun test packages/omo-senpi/src/components/memory/worker/hold-lock-lifecycle.test.ts \
  packages/omo-senpi/src/components/memory/facts-run-prune.test.ts \
  packages/omo-senpi/src/components/memory/facts-failure-streaks.test.ts \
  packages/omo-senpi/src/components/memory/worker/model-preflight.test.ts
```

Each round: 37 pass, 0 fail, 108 expectations. After each round, exact task-owned scans for
`hold-lock.ts`, `grandchild.mjs`, abrupt-wrapper/exit-vs-close wrappers, and task temp-root
prefixes were empty.

## Package gates

- `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json`: exit 0.
- `bun run test:senpi`: build/stage/typecheck passed; 2270 pass, 7 skip, 0 fail, 7009 expectations across 311 files; evidence resolver 10 pass, 0 fail.
- `git diff --check` and `git diff --cached --check`: pass after removing two trailing spaces from captured RED evidence.
- Source hygiene across all five changed TypeScript files: no `as any`, `@ts-ignore`, `@ts-expect-error`, or empty catches.
- LSP proxy diagnostics were unavailable because the user-scoped `.omo/lsp-daemon/v0.1.0/daemon.sock` was unreachable after automatic retry. Strict package `tsgo` passed and is the static diagnostics gate used here.

## Live Senpi QA

- Evidence directory re-resolved through `.agents/skills/senpi-qa/scripts/resolve-evidence-dir.mjs`; it returned this canonical directory.
- `node packages/omo-senpi/scripts/qa/drive.mjs --self-test`: PASS; see `current-base-drive-selftest.log`.
- Change tree: `SENPI_BIN="$SENPI_BIN" node packages/omo-senpi/scripts/qa/memory-e2e.mjs`; S1 passed, then S2 failed with stale extension context and Node ESM `ERR_MODULE_NOT_FOUND` for extensionless `packages/omo-senpi/src/extension/compose`; see `current-base-memory-e2e.log`.
- Exact detached `origin/dev` at 8c57e463e: the same command with the same binary produced the same S1 pass and same S2 failure class; see `current-base-memory-e2e-base.log`.
- Verdict: live S2 is a reproduced base-identical infrastructure blocker, not a pass. The changed lock-holder fixture and test-only process teardown do not participate in the failing extension-import path.
- Isolation limitation: the S2 exception aborts the driver before its final real-home digest checks, so this refresh does not claim those assertions passed. All driver sandboxes were under unique `/tmp/omo-senpi-qa-*` roots.

## Cleanup

Removed only the six sandboxes created by the two current-base comparison runs:

- `/tmp/omo-senpi-qa-C2ul5Z`
- `/tmp/omo-senpi-qa-kVtXZ5`
- `/tmp/omo-senpi-qa-WuTbam`
- `/tmp/omo-senpi-qa-lHMIzt`
- `/tmp/omo-senpi-qa-wHq6TZ`
- `/tmp/omo-senpi-qa-vMG3hs`

Removed detached worktree `/tmp/opencode/omo-7335-base`. All listed paths were absent afterward.
Exact task-owned process scans were clean; no holder, wrapper, or grandchild from this lane remained.
