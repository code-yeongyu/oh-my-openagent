# src/features/claude-code-agent-loader/ -- Claude Code Agent Compatibility Layer

**Generated:** 2026-05-18

## OVERVIEW

Sibling to `claude-code-mcp-loader`. Loads Claude Code agent definitions from `.opencode/agents/`, `~/.claude/agents/`, and inline `opencode.json` config, then translates them to OpenCode `AgentConfig`. Shared parsing and compatibility primitives are extracted to [`packages/claude-code-compat-core/`](../../../../../packages/claude-code-compat-core); this directory is the OpenCode adapter shim.

## LOAD PIPELINE

```
loadUserAgents() / loadProjectAgents() / loadOpencodeGlobalAgents() / loadOpencodeProjectAgents()
  -> loader.ts: discover .md files in agents/ directories
  -> agent-definitions-loader.ts: parse YAML frontmatter + body, load from explicit paths
  -> json-agent-loader.ts: parse .json / .jsonc agent definitions
  -> opencode-config-agents-reader.ts: read inline agents from opencode.json
  -> claude-model-mapper.ts: translate "sonnet" / "opus" / "haiku" -> OpenCode provider/model IDs
  -> return Record<string, ClaudeCodeAgentConfig>
```

## KEY FILES

| File | Purpose |
|------|---------|
| `index.ts` | Barrel: all exports |
| `loader.ts` | `loadUserAgents()`, `loadProjectAgents()`, `loadOpencode*Agents()` main entry |
| `agent-definitions-loader.ts` | `parseMarkdownAgentFile()`, `loadAgentDefinitions()` |
| `json-agent-loader.ts` | `parseJsonAgentFile()` -- JSON/JSONC agent definitions |
| `claude-model-mapper.ts` | Claude aliases -> OpenCode `providerID/modelID` |
| `opencode-config-agents-reader.ts` | Reads inline `agents` and `agent_definitions` from `opencode.json` |
| `types.ts` | `ClaudeCodeAgentConfig`, `AgentScope`, `LoadedAgent` |

## INTEGRATION

Phase 3 of config loading (`src/plugin-handlers/agent-config-handler.ts`) calls this loader to populate the agent registry before the plugin interface is built.

## COMPANION LOADERS

- **`claude-code-plugin-loader`**: full plugins with commands, skills, hooks, MCPs
- **`claude-code-mcp-loader`**: Tier 2 MCPs from `.mcp.json`

## RELATED

- Phase 3 integration: `src/plugin-handlers/agent-config-handler.ts`
- Plugin loader: `src/features/claude-code-plugin-loader/`
- MCP loader: `src/features/claude-code-mcp-loader/`
