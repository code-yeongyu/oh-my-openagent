# git-bash — Codex plugin component: Windows git_bash MCP reminder hook

**Generated:** 2026-07-03

## OVERVIEW

Component wrapper (`@sisyphuslabs/codex-git-bash-hook`, private, bin `omo-git-bash-hook`) that steers Windows Codex sessions toward the OMO `git_bash` MCP: a `PreToolUse` hook on `^Bash$` injects one `additionalContext` reminder per session to prefer `git_bash` over built-in `exec_command`; a `PostCompact` hook clears the once-per-session marker so the reminder re-fires after compaction. This component is NOT the MCP — the `git_bash` stdio server is declared plugin-wide in [`.mcp.json`](../../.mcp.json) (`node ../../git-bash-mcp/dist/cli.js mcp`) and implemented by [`packages/git-bash-mcp`](../../../../git-bash-mcp/AGENTS.md). Emits nothing on non-Windows hosts.

## KEY FILES

| File | Role |
|------|------|
| `src/codex-hook.ts` | All logic: payload parsing + type guards, Windows detection, reminder marker lifecycle, hook JSON output |
| `src/cli.ts` | Bin entry; subcommands `hook pre-tool-use` / `hook post-compact` (stdin JSON in, hook JSON on stdout) |
| `src/index.ts` | Barrel export of the `codex-hook` API |
| `hooks/hooks.json` | Codex wiring: `PreToolUse` matcher `^Bash$` + `PostCompact`, both `node "${PLUGIN_ROOT}/dist/cli.js"`, 5s timeout |
| `test/codex-hook.test.ts` | 7 `bun:test` cases (given/when/then): once-per-session reminder, non-Bash / non-Windows skip, PostCompact reset, CLI stream round-trip |

## WHERE TO LOOK

- MCP internals (tools `run` / `which_bash` / `diagnose`, `bash.exe` resolution, timeout env chain) → [`packages/git-bash-mcp/AGENTS.md`](../../../../git-bash-mcp/AGENTS.md). Do not document them here.
- Install-time handling → `packages/omo-codex/src/install/`: `codex-cache-bundled-mcps.ts` copies the MCP dist into the plugin cache and rewrites the `.mcp.json` arg to `./components/git-bash-mcp/dist/cli.js`; `codex-config-plugins.ts` sets `[plugins."omo@sisyphuslabs".mcp_servers.git_bash]` `enabled = true` only on win32 with Git Bash resolved (`enabled = false` elsewhere); `codex-git-bash-mcp-env.ts` `stampGitBashMcpEnv()` stamps `OMO_CODEX_GIT_BASH_PATH` into the server `env` on win32 when the override env var is set.
- Component roster + skills sync pipeline → [`packages/omo-codex/AGENTS.md`](../../../AGENTS.md).

## NOTES

- **Windows detection is env-tolerant** (`isWindowsHost`): `platform === "win32"` OR any of `OS=Windows_NT` / `ComSpec` / `SystemRoot` present, so bash-hosted shells on Windows still count.
- **Marker path:** `${PLUGIN_DATA:-~/.codex/omo-git-bash}/git-bash-reminder/<session_id>.seen`; session id sanitized to `[A-Za-z0-9._-]`. `PostCompact` removes it with `rmSync(force)`.
- **Hook must never block the user's Bash call:** the CLI swallows parse/fs errors and exits 0 on both hook paths; malformed or empty stdin yields empty output.
- **Runtime dep-free Node >=20 ESM.** `@oh-my-opencode/utils` is a devDependency only (`file:` link). Build `tsc -p tsconfig.build.json`; tests run via `bun test test/*.test.ts` (unlike the vitest-based `lsp` component).
- **Windows absolute MCP targets are valid:** `isPluginRuntimePathArg` in `packages/omo-opencode/src/cli/doctor/checks/codex-components.ts` and `script/lazycodex-marketplace-validation.ts` gained `isAbsolute(arg)` so a rewritten `C:\...` git_bash/lsp entrypoint passes validation (commit 3b1681ae8).
