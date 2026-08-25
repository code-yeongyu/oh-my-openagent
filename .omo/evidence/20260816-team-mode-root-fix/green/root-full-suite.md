# PR B root `bun test` final gate (post dev-merge)

Command: `bun test` (repo root, worktree fix/senpi-team-runtime-boundaries, after merging origin/dev)

Result: **15184 pass / 5 skip / 0 fail**, 123005 expect() calls, 1981 files, 464.97s. Exit code 0.

This run is on the reconciled tree that merges upstream PR #6887, so it also covers upstream's
`handle.test.ts` and `adaptRpcHandle` cases alongside this PR's new regressions.

## Note on the earlier pre-merge run

An earlier root run on the pre-merge tree reported 2 failures, both `shouldProposeRefresh` timeouts in
`packages/omo-senpi/src/components/init-deep-advisor/drift.test.ts` - a module this PR does not touch.
They passed 15/15 in isolation at ~2.2s against a 5s budget, and they pass here in the full suite too,
confirming they were load-induced timeouts rather than a behavioral regression.

## Companion gates

- `bun run typecheck` (root + script + all 30 package projects): exit 0.
- `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check` under CI Bun 1.3.12: build is current.
- `bun test packages/senpi-task packages/omo-senpi/src/components/task`: 1661 pass / 0 fail.
- `bunx tsgo --noEmit -p packages/senpi-task/tsconfig.json`: exit 0.
- `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json`: exit 0.
