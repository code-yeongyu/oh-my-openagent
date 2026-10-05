# builtin-mcps

Registers the two remote MCP servers the OpenCode edition injects at runtime (`packages/omo-opencode/src/mcp/index.ts`) so the native Senpi edition reaches the same documentation and code-search surfaces:

| Server | Transport | URL | Auth |
|--------|-----------|-----|------|
| `context7` | `http` | `https://mcp.context7.com/mcp` | anonymous; `bearer` via `bearerTokenEnv: CONTEXT7_API_KEY` when that variable holds a real key |
| `grep_app` | `http` | `https://mcp.grep.app` | none |

Both are declared `enabled: true`, `lifecycle: "lazy"`, so nothing connects until a tool call needs it.

## Rules

- Senpi's MCP schema is `type: "http"` (not OpenCode's `"remote"`) and expresses auth as `auth: "bearer" | "oauth" | false`. Never put a literal token in `headers`: senpi resolves `bearerTokenEnv` at connect time, so the key stays in the environment instead of being copied into config dumps, diagnostics, and logs.
- `CONTEXT7_API_KEY` is normalized exactly like the OpenCode edition (`packages/omo-opencode/src/mcp/context7.ts`): blank values and `<YOUR_API_KEY>` / `your-api-key` / `"Your API Key"` placeholders are treated as absent, because sending a placeholder as a bearer token turns a working anonymous server into an authentication failure.
- No websearch server here. Senpi ships first-class `websearch` and `webfetch` builtins, so an Exa/Tavily MCP would duplicate them.
- The Senpi LSP surface is registered by the `lsp` component as direct tools, not as an MCP.
- The component writes no defaults into `~/.omo/agent/mcp.json`; extension declarations are runtime-only.

## Disabling

Three switches, in precedence order:

1. Any trusted `mcp.json` entry with the same name wins over the extension declaration (`mergeExtensionMcpServers` in senpi `core/extensions/builtin/mcp/config.ts`). Turn a server off with, in user/global or project `mcp.json`:
   ```json
   { "mcpServers": { "context7": { "enabled": false } } }
   ```
   The same entry shape also lets a user pin their own URL, headers, or tool filters.
2. `--omo-senpi-builtin-mcps-disabled` (the per-component compose flag) drops both declarations.
3. `--omo-senpi-disabled` drops every omo-senpi component.
