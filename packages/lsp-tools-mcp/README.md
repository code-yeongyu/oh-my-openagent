# lsp-tools-mcp

[![ci](https://github.com/code-yeongyu/lsp-tools-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/code-yeongyu/lsp-tools-mcp/actions/workflows/ci.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Standalone Language Server Protocol tools exposed as a stdio MCP server.

## Used By

This package is the upstream source of truth for downstream plugins. In `oh-my-openagent`, it is vendored in-tree under `packages/lsp-tools-mcp/` so CI and release jobs do not need extra checkout initialization:

| Project | Path | Role |
|---------|------|------|
| **[codex-lsp](https://github.com/code-yeongyu/codex-lsp)** | `packages/lsp-tools-mcp/` | Codex plugin that ships these LSP MCP tools plus a Codex-specific PostToolUse diagnostics hook. |
| **[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)** (a.k.a. `oh-my-opencode`) | `packages/lsp-tools-mcp/` | OpenCode plugin that registers this server as a built-in Tier-1 stdio MCP and starts the shared OMO daemon through the `@code-yeongyu/lsp-daemon` proxy. Exposes `lsp_diagnostics`, `lsp_goto_definition`, `lsp_find_references`, `lsp_symbols`, `lsp_prepare_rename`, `lsp_rename`, `lsp_status`, and `lsp_install_decision` to all agents. |

If you fix or extend the LSP runtime here, downstreams should sync the vendored package source rather than carrying divergent forks.

## Quick Start

```bash
npm install
npm run check
npm test
npm run build
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/cli.js mcp
```

## MCP Tools

This server exposes the following tools:

- `lsp.status`
- `lsp.diagnostics`
- `lsp.goto_definition`
- `lsp.find_references`
- `lsp.symbols`
- `lsp.prepare_rename`
- `lsp.rename`
- `lsp.install_decision`

Tool aliases are also available for compatibility:

- `lsp_status`
- `lsp_diagnostics`
- `lsp_goto_definition`
- `lsp_find_references`
- `lsp_symbols`
- `lsp_prepare_rename`
- `lsp_rename`
- `lsp_install_decision`

When an MCP host registers this server under the name `lsp` (the default in both downstreams), the tools are exposed to agents as `lsp_status`, `lsp_diagnostics`, and so on, matching the alias names above.

## Configuration

Standalone MCP hosts translate these environment variables into the typed request context sent to the shared OMO daemon:

- `LSP_TOOLS_MCP_PROJECT_CONFIG`: delimiter-separated project config paths. Relative entries are resolved inside the canonical request cwd.
- `LSP_TOOLS_MCP_USER_CONFIG`: user-level config path. Relative entries are resolved inside the user's home directory.
- `LSP_TOOLS_MCP_INSTALL_DECISIONS`: install-decision cache path. Relative entries are resolved inside the user's home directory.

When an MCP host omits the variables, the standalone default remains the Codex-compatible fallback. OpenCode sets all three variables explicitly:

- Project paths, in order: `<cwd>/.opencode/lsp.json`, `<cwd>/.omo/lsp.json`, `<cwd>/.omo/lsp-client.json`
- User config: `<opencode config dir>/lsp.json`
- Install decisions: `<opencode config dir>/lsp-install-decisions.json`

The shared daemon runtime itself is configured only through `OMO_LSP_DAEMON_DIR`, or the paired `OMO_LSP_DAEMON_CLI` plus `OMO_LSP_DAEMON_VERSION` override. OpenCode source mode uses the paired override to run `packages/lsp-daemon/src/cli.ts` with Bun; dist mode resolves the daemon package `./cli` export.

Examples:

```bash
LSP_TOOLS_MCP_PROJECT_CONFIG="$PWD/.opencode/lsp.json:$PWD/.omo/lsp.json:$PWD/.omo/lsp-client.json" node dist/cli.js mcp
LSP_TOOLS_MCP_USER_CONFIG="$HOME/.config/opencode/lsp.json" node dist/cli.js mcp
```

Example config file:

```json
{
	"lsp": {
		"typescript": {
			"command": ["typescript-language-server", "--stdio"],
			"extensions": [".ts", ".tsx", ".js", ".jsx"]
		}
	}
}
```

## Architecture

- `src/lsp/*` standalone LSP runtime (process management, JSON-RPC transport, configuration, diagnostics, workspace edits)
- `src/tools.ts` MCP tool definitions and handlers
- `src/mcp.ts` stdio MCP server entry and registration
- `src/cli.ts` standalone CLI entry (`mcp` subcommand only)
- `../lsp-daemon` shared authenticated OMO daemon/proxy layer used by Codex, OpenCode, and Senpi adapters

## Local Development

```bash
npm install
npm run check
npm test
npm pack --dry-run
```

## License

[MIT](LICENSE)
