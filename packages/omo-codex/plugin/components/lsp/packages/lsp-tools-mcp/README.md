# lsp-tools-mcp

[![ci](https://github.com/code-yeongyu/lsp-tools-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/code-yeongyu/lsp-tools-mcp/actions/workflows/ci.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Standalone Language Server Protocol tools exposed as a stdio MCP server.

## Used By

This repository is the upstream source of truth for two downstream plugins. Both consume it as a git submodule:

| Project | Path | Role |
|---------|------|------|
| **[codex-lsp](https://github.com/code-yeongyu/codex-lsp)** | `packages/lsp-tools-mcp/` | Codex plugin that ships these LSP MCP tools plus a Codex-specific PostToolUse diagnostics hook. |
| **[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)** (a.k.a. `oh-my-opencode`) | `vendor/lsp-tools-mcp/` | OpenCode plugin that registers this server as a built-in Tier-1 stdio MCP. Exposes `lsp_diagnostics`, `lsp_goto_definition`, `lsp_find_references`, `lsp_symbols`, `lsp_prepare_rename`, `lsp_rename`, and `lsp_status` to all agents. |

If you fix or extend the LSP runtime here, both downstreams pick up the change by bumping the submodule pointer. Do not fork the runtime into a downstream; land changes here instead.

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

Tool aliases are also available for compatibility:

- `lsp_status`
- `lsp_diagnostics`
- `lsp_goto_definition`
- `lsp_find_references`
- `lsp_symbols`
- `lsp_prepare_rename`
- `lsp_rename`

When an MCP host registers this server under the name `lsp` (the default in both downstreams), the tools are exposed to agents as `lsp_status`, `lsp_diagnostics`, and so on, matching the alias names above.

## Configuration

Default config paths (matches codex-lsp's historical layout):

- Project: `.codex/lsp-client.json`
- User: `~/.codex/lsp-client.json`

Path overrides via environment variables:

- `LSP_TOOLS_MCP_PROJECT_CONFIG`
- `LSP_TOOLS_MCP_USER_CONFIG`

Examples (oh-my-openagent points the project config at `.opencode/lsp.json` via the env var):

```bash
LSP_TOOLS_MCP_PROJECT_CONFIG=.opencode/lsp.json node dist/cli.js mcp
LSP_TOOLS_MCP_USER_CONFIG=.opencode/lsp.json node dist/cli.js mcp
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

## Local Development

```bash
npm install
npm run check
npm test
npm pack --dry-run
```

## License

[MIT](LICENSE)
