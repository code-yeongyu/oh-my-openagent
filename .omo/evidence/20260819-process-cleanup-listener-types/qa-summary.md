# QA evidence: process cleanup listener typecheck

## What changed

Removed the unused `ProcessCleanupEvent` alias and unused exported `getNewListener` test helper from `packages/omo-opencode/src/features/background-agent/process-cleanup.test-helpers.ts`. Repository-wide search found no caller. Production cleanup registration, shutdown listeners, and the active `getRegisteredProcessCleanupSignalListener` test seam are unchanged.

## Before

**Command:** `bun run typecheck`

**Observed:** exit 1 with exactly two diagnostics in the removed helper:

- TS2769: the event union could not select a `process.listeners()` overload.
- TS2322: Bun's typed `BeforeExitListener` was not assignable to the helper's `() => void` return type.

**Artifact:** `baseline-typecheck.txt`

## Automated verification

### Targeted process-cleanup behavior

**Command:** `bun test packages/omo-opencode/src/features/background-agent/process-cleanup.test.ts`

**Observed:** 44 pass, 0 fail, 83 expectations.

**Artifact:** `targeted-test.txt`

**Why sufficient:** this is the only test file importing the edited helper module and it exercises registration, signal cleanup, error listeners, shutdown state, and cleanup-manager lifecycle.

### Type safety

**Command:** `bun run typecheck`

**Observed:** exit 0 across the root, script, and every workspace package typecheck.

**Artifact:** `typecheck.txt`

**Why sufficient:** directly proves both baseline diagnostics are gone without suppressions or casts.

### Build

**Command:** `bun run build`

**Observed:** exit 0; all build stages completed, including declarations, OpenCode bundles, Codex plugin, LSP packages, and Senpi plugin.

**Artifact:** `build.txt`

**Why sufficient:** proves the edited source still emits declarations and the OpenCode distribution bundles successfully.

### OpenCode adapter suite

**Command:** `bun test packages/omo-opencode`

**Observed:** 8,241 pass, 1 skipped tmux live smoke, 0 fail, 18,222 expectations.

**Raw artifact:** `omo-opencode-tests.txt` (kept locally; not intended for commit because it is 10,218 repetitive lines).

**Why sufficient:** the entire adapter containing the changed test helper is green.

### Root suite

**Command:** `bun test`

**Observed:** 15,888 pass, 13 skip, 3 fail. None of the failures imports or resides in the changed module:

1. `script/codex-installer-version.test.ts`: the checked-in generated installer is stale relative to the root version when generated build drift is restored.
2. `packages/ast-grep-mcp/src/tools/scan.test.ts`: `/opt/homebrew/bin/sg` exists, so the fixture suite runs, but the separately asserted pinned `~/.omo/runtime/.../sg` file is absent.
3. `packages/team-core/src/team-worktree/manager.test.ts`: existing worktree cleanup removes the directory before asking Git for its repository root.

All 8,241 tests under the changed `packages/omo-opencode` adapter pass in the dedicated command above.

**Raw artifact:** `root-tests.txt` (kept locally; not intended for commit because it is 20,495 repetitive lines).

## Real OpenCode QA

**Surface:** OpenCode 1.18.18 headless server with an isolated HOME and all four XDG directories. The only configured plugin was the worktree's built `dist/index.js` via an absolute `file://` URI.

**Actions:**

1. Started real `opencode serve` in the isolated sandbox.
2. Read `/config` to force the local plugin to load and run its config hook.
3. Opened `/event` and observed `server.connected`.
4. Confirmed the resolved agent registry contains `Sisyphus - ultraworker` and the local plugin URI.
5. Compared the real user OpenCode DB session count before and after.

**Observed:** healthy server; local Sisyphus agent present; one `server.connected` event; live DB count unchanged at 5,492.

**Artifacts:** `run-opencode-smoke.sh`, `opencode-smoke.txt`

**Why sufficient:** the code edit is test-only and changes no lifecycle hook. Loading the rebuilt local distribution through real OpenCode proves the production plugin still initializes. The unchanged live DB count proves isolation.

## Omissions and residual risk

- TUI/tmux smoke was omitted because `tmux` is not installed. The edit has no TUI or runtime code path, and the real headless OpenCode surface plus full adapter suite cover the relevant regression risk.
- No provider prompt was sent because no model or tool behavior changed.
- Server passwords, auth headers, credentials, and environment dumps were not recorded.
- Raw 2 MB test logs remain in the local evidence directory but are summarized above to keep the review artifact readable.
