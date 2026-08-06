# git-bash-mcp — Windows Git Bash stdio MCP (MCP layer)

**Generated:** 2026-06-17

## OVERVIEW

Internal **Bun-targeted** MCP-layer package (`@oh-my-opencode/git-bash-mcp`, private). Serves the Windows-only `git_bash` tool family for the Codex edition: resolve Git Bash's `bash.exe` and run shell commands through it. Consumes [`mcp-stdio-core`](../mcp-stdio-core/AGENTS.md) for JSON-RPC framing and [`utils`](../utils/AGENTS.md) for the bash resolver. NOT registered by the OpenCode edition (it has tmux-based `interactive_bash`). Package server name `git_bash`.

## TOOLS SERVED

- `which_bash` — resolve the `bash.exe` path; returns `{found, path, source, candidates}`. Cross-platform.
- `diagnose` — report whether Git Bash execution is available; returns `{platform, enabled, status, resolution}`. Cross-platform.
- `run` — **Windows-only.** Run a command via `bash.exe -lc`. Params `command` (required), `timeout` (≤30 min), `workdir`, `description`. Registered only when `platform === "win32" && canRunGitBash()`; otherwise omitted from `tools/list`.

## KEY FILES

| File | Role |
|------|------|
| `cli.ts` | Bin `omo-git-bash`. `mcp` subcommand → `runMcpStdioServer()` |
| `mcp.ts` | `handleGitBashMcpRequest()` + tool registration over `runJsonRpcStdioServer` |
| `runner.ts` | `runGitBashCommand()` — spawns `bash.exe -lc`, temp-fd output capture, timeout kill |
| `git-bash-resolver.ts` | re-exports `resolveGitBash(ForCurrentProcess)` from `@oh-my-opencode/utils/runtime` |

## NOTES

- **Bun-targeted (NOT npm+vitest like `lsp-tools-mcp`/`lsp-daemon`).** Build: `bun build src/cli.ts --outdir dist --target node --format esm` (root: `bun run build:git-bash-mcp`). Tests via `bun:test`. No biome, no `engines.node`.
- **Codex-only consumption:** `omo-codex/plugin/.mcp.json` declares it; `script/sync-lazycodex-marketplace.ts` copies `dist/` → `<plugin>/components/git-bash-mcp/dist/` and rewrites the `.mcp.json` path. Root `files` ships `packages/git-bash-mcp/dist`.
- **Temp-fd output capture** (`mkdtempSync` + `openSync` + `rmSync`) avoids Windows pipe-buffer deadlocks.
- **Timeout env chain:** `OMO_CODEX_GIT_BASH_TIMEOUT_MS` → `OMO_CODEX_EXEC_COMMAND_TIMEOUT_MS` → `CODEX_EXEC_COMMAND_TIMEOUT_MS` → `EXEC_COMMAND_TIMEOUT_MS` → 120_000 default (max 30 min).
- Parent: [`packages/AGENTS.md`](../AGENTS.md).
