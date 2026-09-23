# Plan: fix `omo update` reporting success without updating (#7172)

## Root cause

`packages/omo-native/bin/lib/launcher.js` (`runLauncher`, self-update branch, lines 141-148):
every self-update spelling of `omo update` is intercepted and answered with a guidance line,
but the line reads as completed ("omo is updated via bun: <command>") and the branch sets
`process.exitCode = 0`. Nothing is spawned; no update happens. The refusal-by-design (the
engine `@code-yeongyu/senpi` is exact-pinned) is correct; the reporting makes it
indistinguishable from success for humans and automation alike.

## Change

1. `packages/omo-native/bin/lib/launcher.js` - self-update branch prints:
   ```
   omo does not self-update (the senpi engine is version-pinned).
   Run: <updateTarget().command>
   ```
   and sets `process.exitCode = 1`. Comment updated to state the non-zero exit contract.
2. `packages/omo-native/test/launcher.test.ts`:
   - NEW regression tests (written first, proven red): bare `update` and each self-update
     spelling exit 1, print the honest wording plus the runnable command, and never spawn senpi.
   - Existing assertions that pinned the old contract (status 0 + "omo is updated via ...")
     are re-pointed at the corrected contract. No test deleted or weakened.

## Out of scope (flagged in PR)

- `packages/omo-senpi/src/install/local-launcher.ts` + its bundled artifact
  `plugin/scripts/install.mjs` carry the identical message/exit-0 branch for local installs.
  Fixing them pulls in the full senpi adapter gate; filed as follow-up in the PR body.

## Verification

1. `bun install` (worktree).
2. New tests red before fix, green after: `bun test packages/omo-native/test`.
3. `bunx tsc -p packages/omo-native/tsconfig.json --noEmit`.
4. Entry smoke: `node packages/omo-native/bin/omo.js --version`.

## Evidence

QA output captured under this directory (`qa.log`, evidence.md).
