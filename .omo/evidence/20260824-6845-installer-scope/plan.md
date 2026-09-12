# Plan: issue #6845 installer scope confirmation (crash recovery)

Branch: issue/6845-installer-scope-confirm (base dev @8833800ae)
Worktree: /home/viprix/projects/oom-wt-6845

## Contract (from gh issue 6845 comments, maintainer ragtimelab)

- Custom root (OPENCODE_CONFIG_DIR) != default global root:
  - interactive install: display both paths, require explicit active|global choice
  - --no-tui: fail unless --config-scope=active|global supplied
- No distinct custom root: existing behavior unchanged
- "both" excluded; never silently move/delete an existing registration in the other layer
- doctor reporting both roots: allowed as separate linked patch; this patch is installer-only + regression coverage

## Crash salvage inventory (git status before work)

SOUND (kept as-is):
- packages/omo-opencode/src/cli/install-config-scope.ts (new): resolveDistinctConfigRoots / resolveNonTuiInstallScope / applyInstallConfigScope
- packages/omo-opencode/src/cli/config-manager/config-context.ts: setConfigDirOverride + applyConfigDirOverride in getConfigContext
- packages/omo-opencode/src/cli/types.ts: InstallConfigScope + InstallArgs.configScope
- packages/omo-opencode/src/cli/tui-install-prompts.ts: promptInstallConfigScope (both paths shown, explicit choice)
- packages/omo-opencode/src/cli/tui-installer.ts: prompt when distinct roots, cancel -> exit 1
- packages/omo-opencode/src/cli/cli-installer.ts: non-TUI validation gate before any mutation
- packages/omo-opencode/src/cli/install.test.ts: 4 new regression tests (given/when/then)

UNSOUND / MISSING (redo):
1. cli-program.ts never wired: InstallCommandOptions.configScope missing, resolveInstallArgs drops configScope, no --config-scope Option on install command. Without it the public CLI contract does not exist.
2. resetConfigContext() does not clear configDirOverride -> module-level override leaks across tests (and any future reset path).

## Steps

1. Backup all 7 dirty files to /tmp/opencode/6845-salvage/
2. Failing-first proof: revert behavior files (cli-installer.ts, config-context.ts, tui-install-prompts.ts, tui-installer.ts), delete install-config-scope.ts; KEEP types.ts + install.test.ts. Run bun test install.test.ts -> expect RED (no scope gate; registration written to custom dir regardless of scope). Capture output.
3. Restore salvaged files from backup.
4. Edit cli-program.ts: add configScope to InstallCommandOptions, pass through resolveInstallArgs, addOption(new Option("--config-scope <scope>", ...).choices(["active","global"])).
5. Edit config-context.ts: resetConfigContext() also clears configDirOverride.
6. Run bun test packages/omo-opencode/src/cli/install.test.ts -> GREEN. Capture output.
7. Typecheck: bun run typecheck (tsgo). No as any / ts-ignore anywhere.
8. Evidence files: WHAT TESTED / OBSERVED / WHY ENOUGH / OMITTED (secrets redacted).
9. git add ONLY intended files + git add -f evidence dir. Conventional commit: fix(cli): require explicit config scope when a distinct custom OpenCode config dir is active
10. Push fork issue/6845-installer-scope-confirm; gh pr create --repo code-yeongyu/oh-my-openagent --base dev --head "AceRothstein71:issue/6845-installer-scope-confirm", body What/Why/Verified/Risk ending "Fixes #6845".

## Verification per step

- Step 2: exit code of bun test nonzero, at least one behavioral assertion failure
- Step 6: all tests pass, 0 fail
- Step 7: tsgo exits 0
- Step 9: git status shows only intended paths staged; upstream submodules untouched
