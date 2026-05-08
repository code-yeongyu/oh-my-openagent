# src/features/claude-code-plugin-loader/ — Unified Claude Code Plugin Loader

**Generated:** 2026-05-08

## OVERVIEW

16 files. Full Claude Code plugin compatibility layer. Discovers and loads ALL plugin components (commands, agents, skills, hooks, MCP servers, LSP servers) from `.opencode/plugins/` and `~/.claude/plugins/`.

## WHY IT EXISTS

Claude Code plugins ship commands/agents/skills as separate files with `plugin.json` manifest. OmO uses this loader to ingest them into its own registry so existing Claude Code plugins work unchanged under OmO.

## LOAD PIPELINE

```
loadAllPluginComponents(ctx)
  → discoverPlugins()                  # scan .opencode/plugins + ~/.claude/plugins
  → readPluginManifest(plugin.json)    # parse name/version/commands/agents/skills/hooks/mcpServers
  → loadPluginCommands()
  → loadPluginAgents()
  → loadPluginSkills()
  → loadPluginHooks()                  # register hook handlers
  → loadPluginMcpServers()             # feed into mcp-config-handler (tier 2)
  → loadPluginLspServers()
  → return LoadedPluginBundle
```

Called from `src/plugin-handlers/plugin-components-loader.ts` during Phase 2 of config handler (10s timeout with error isolation — one broken plugin does not sink the plugin load).

## KEY FILES

| File | Purpose |
|------|---------|
| `index.ts` | Barrel: `loadAllPluginComponents`, `PluginManifest`, `ClaudeSettings` types |
| `plugin-discovery.ts` | Find plugin directories across scopes |
| `plugin-manifest-parser.ts` | Parse `plugin.json` with Zod validation |
| `command-loader.ts` | Load commands from `commands/` or `COMMANDS.md` |
| `agent-loader.ts` | Load agents from `agents/` or `AGENTS.md` frontmatter |
| `skill-loader.ts` | Load skills from `skills/` or `SKILL.md` |
| `hook-loader.ts` | Load hooks config from `hooks/` or manifest |
| `mcp-loader.ts` | Extract MCP server configs |
| `lsp-loader.ts` | Extract LSP server configs |
| `settings-loader.ts` | Parse Claude Code `settings.json` |

## PLUGIN MANIFEST (plugin.json)

```jsonc
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "...",
  "commands": ["./commands"],       // or string[] of paths
  "agents": ["./agents"],
  "skills": ["./skills"],
  "hooks": "./hooks/config.json",
  "mcpServers": "./.mcp.json",
  "lspServers": "./lsp"
}
```

## SCOPES

| Scope | Path | Priority |
|-------|------|----------|
| `project` | `.opencode/plugins/` | Highest |
| `local` | `~/.opencode/plugins/` | Medium |
| `user` | `~/.claude/plugins/` | Medium |
| `managed` | Built-in | Lowest |

## ERROR ISOLATION

Each plugin loads in isolation — if one fails (bad manifest, missing file, syntax error), others still load. Errors surface as warnings in `bunx oh-my-opencode doctor`.

## RELATED

- Phase 2 loader: `src/plugin-handlers/plugin-components-loader.ts`
- Tier 2 MCP integration: `src/features/claude-code-mcp-loader/`
- Claude Code compat hooks: `src/hooks/claude-code-hooks/`
