# src/mcp-servers/ — Standalone stdio MCP Servers

Standalone MCP servers shipped inside this repo and registered as **Tier 2** (Claude Code `.mcp.json`) — distinct from `src/mcp/` (Tier 1: remote HTTP only) and skill-embedded servers (Tier 3, per-session).

Each subdirectory is a self-contained stdio server that can be spawned by any MCP client (OpenCode, Claude Code, Devin CLI itself, etc.).

## Servers

| Server | Dir | Tools | Wrapped CLI |
|--------|-----|-------|-------------|
| **devin** | `devin/` | `devin_start`, `devin_status`, `devin_wait`, `devin_cancel`, `devin_list` | [`devin`](https://cli.devin.ai/docs) — runs background Devin sessions via `devin -p` |

## Conventions

- Entry point: `<server>/index.ts` exports the factory + auto-runs when invoked directly (`import.meta.main`).
- Server factory: `createXxxMcpServer(): McpServer` using `@modelcontextprotocol/sdk`.
- Background subprocesses: log stdout/stderr to a file under `os.tmpdir()/oh-my-opencode-<server>-mcp/` and expose status/tail-output tools.
- Run with: `bun run src/mcp-servers/<server>/index.ts` (or the `mcp:<server>` package.json script).
- Registered at project root via `.mcp.json` so the Claude Code MCP loader picks it up automatically.

## devin/ — Devin CLI wrapper

Wraps the `devin` CLI binary as a background-session MCP server. The OpenCode/oh-my-openagent agent can:

1. `devin_start({prompt, model?, cwd?, permission_mode?, resume?})` → spawns `devin -p <prompt>` detached, returns `session_id`
2. `devin_status({session_id, tail_bytes?})` → polls log file + process state
3. `devin_wait({session_id, timeout_ms?})` → blocks until exit (or timeout)
4. `devin_cancel({session_id})` → SIGKILL the subprocess
5. `devin_list({include_output?})` → enumerate all sessions managed by this server instance

Sessions live in memory (`session-store.ts` — `Map<id, DevinSession>`); logs persist on disk. State is per-MCP-process: if the MCP server restarts, in-memory sessions are gone but log files remain.

### Agent guidance

The `devin-cli` built-in skill ([`src/features/builtin-skills/skills/devin-cli.ts`](../features/builtin-skills/skills/devin-cli.ts)) tells agents when and how to delegate to Devin. The skill is auto-loaded by `createBuiltinSkills()`; disable via `disabled_skills: ["devin-cli"]` in your oh-my-openagent config if you don't want agents to delegate.

### User-facing slash commands

Built-in commands ([`src/features/builtin-commands/templates/devin.ts`](../features/builtin-commands/templates/devin.ts)) give the user direct entry points:

| Command | Purpose |
|---------|---------|
| `/devin "<task>" [--model=<name>] [--wait] [--cwd=<path>]` | Delegate a task; agent auto-selects model from complexity |
| `/devin-models` | Show the available Devin models with use cases and selection heuristics |
| `/devin-status [<id-prefix>] [--full]` | List running sessions (or render full output for a specific id) |
| `/devin-cancel [<id-prefix>] [--all]` | Cancel one session (prefix match) or every running session |

Disable any subset via `disabled_commands: ["devin", "devin-status", ...]` in oh-my-openagent config.

### Smoke test

```bash
( printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"x","version":"0"}}}' \
            '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
            '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
) | bun run src/mcp-servers/devin/index.ts
```
