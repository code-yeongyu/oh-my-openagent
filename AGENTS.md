# oh-my-opencode — OpenCode Plugin

**Generated:** 2026-02-18 | **Commit:** 04e95d7e | **Branch:** dev

## OVERVIEW

OpenCode plugin (npm: `oh-my-opencode`) that extends Claude Code (OpenCode fork) with multi-agent orchestration, 44 lifecycle hooks, 26 tools, skill/command/MCP systems, and Claude Code compatibility. 1149 TypeScript files, 132k LOC.

## STRUCTURE

```
oh-my-opencode/
├── src/
│   ├── index.ts              # Plugin entry: loadConfig → createManagers → createTools → createHooks → createPluginInterface
│   ├── plugin-config.ts      # JSONC multi-level config: user → project → defaults (Zod v4)
│   ├── agents/               # 11 agents (Sisyphus, Hephaestus, Oracle, Librarian, Explore, Atlas, Prometheus, Metis, Momus, Multimodal-Looker, Sisyphus-Junior)
│   ├── hooks/                # 44 hooks across 39 directories + 6 standalone files
│   ├── tools/                # 26 tools across 15 directories
│   ├── features/             # 19 feature modules (background-agent, skill-loader, tmux, MCP-OAuth, etc.)
│   ├── shared/               # 101 utility files in 13 categories
│   ├── config/               # Zod v4 schema system (22 files)
│   ├── cli/                  # CLI: install, run, doctor, mcp-oauth (Commander.js)
│   ├── mcp/                  # 3 built-in remote MCPs (websearch, context7, grep_app)
│   ├── plugin/               # 8 OpenCode hook handlers + 44 hook composition
│   └── plugin-handlers/      # 6-phase config loading pipeline
├── packages/                 # Monorepo: comment-checker, opencode-sdk
└── local-ignore/             # Dev-only test fixtures
```

## INITIALIZATION FLOW

```
OhMyOpenCodePlugin(ctx)
  ├─→ loadPluginConfig()         # JSONC parse → project/user merge → Zod validate → migrate
  ├─→ createManagers()           # TmuxSessionManager, BackgroundManager, SkillMcpManager, ConfigHandler
  ├─→ createTools()              # SkillContext + AvailableCategories + ToolRegistry (26 tools)
  ├─→ createHooks()              # 3-tier: Core(35) + Continuation(7) + Skill(2) = 44 hooks
  └─→ createPluginInterface()    # 8 OpenCode hook handlers → PluginInterface
```

## 8 OPENCODE HOOK HANDLERS

| Handler | Purpose |
|---------|---------|
| `config` | 6-phase: provider → plugin-components → agents → tools → MCPs → commands |
| `tool` | 26 registered tools |
| `chat.message` | First-message variant, session setup, keyword detection |
| `chat.params` | Anthropic effort level adjustment |
| `event` | Session lifecycle (created, deleted, idle, error) |
| `tool.execute.before` | Pre-tool hooks (file guard, label truncator, rules injector) |
| `tool.execute.after` | Post-tool hooks (output truncation, metadata store) |
| `experimental.chat.messages.transform` | Context injection, thinking block validation |

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add new agent | `src/agents/` + `src/agents/builtin-agents/` | Follow createXXXAgent factory pattern |
| Add new hook | `src/hooks/{name}/` + register in `src/plugin/hooks/create-*-hooks.ts` | Match event type to tier |
| Add new tool | `src/tools/{name}/` + register in `src/plugin/tool-registry.ts` | Follow createXXXTool factory |
| Add new feature module | `src/features/{name}/` | Standalone module, wire in plugin/ |
| Add new MCP | `src/mcp/` + register in `createBuiltinMcps()` | Remote HTTP only |
| Add new skill | `src/features/builtin-skills/skills/` | Implement BuiltinSkill interface |
| Add new command | `src/features/builtin-commands/` | Template in templates/ |
| Add new CLI command | `src/cli/cli-program.ts` | Commander.js subcommand |
| Add new doctor check | `src/cli/doctor/checks/` | Register in checks/index.ts |
| Modify config schema | `src/config/schema/` + update root schema | Zod v4, add to OhMyOpenCodeConfigSchema |

## MULTI-LEVEL CONFIG

```
Project (.opencode/oh-my-opencode.jsonc)  →  User (~/.config/opencode/oh-my-opencode.jsonc)  →  Defaults
```

Fields: agents (14 overridable), categories (8 built-in + custom), disabled_* arrays, 19 feature-specific configs.

## THREE-TIER MCP SYSTEM

| Tier | Source | Mechanism |
|------|--------|-----------|
| Built-in | `src/mcp/` | 3 remote HTTP: websearch (Exa/Tavily), context7, grep_app |
| Claude Code | `.mcp.json` | `${VAR}` env expansion via claude-code-mcp-loader |
| Skill-embedded | SKILL.md YAML | Managed by SkillMcpManager (stdio + HTTP) |

## CONVENTIONS

- **Test pattern**: Vitest, co-located `*.test.ts`, given/when/then style
- **Factory pattern**: `createXXX()` for all tools, hooks, agents
- **Hook tiers**: Session (22) → Tool-Guard (9) → Transform (4) → Continuation (7) → Skill (2)
- **Agent modes**: `primary` (respects UI model) vs `subagent` (own fallback chain) vs `all`
- **Model resolution**: 3-step: override → category-default → provider-fallback → system-default
- **Config format**: JSONC with comments, Zod v4 validation, snake_case keys

## ANTI-PATTERNS

- Never use `as any`, `@ts-ignore`, `@ts-expect-error`
- Never suppress lint/type errors
- Never add emojis to code/comments unless user explicitly asks
- Never commit unless explicitly requested
- Test: given/when/then — never use Arrange-Act-Assert comments
- Comments: avoid AI-generated comment patterns (enforced by comment-checker hook)

## COMMANDS

```bash
bun test                    # Vitest test suite
bun run build              # Build plugin
bunx oh-my-opencode install # Interactive setup
bunx oh-my-opencode doctor  # Health diagnostics
bunx oh-my-opencode run     # Non-interactive session
```

## NOTES

- Logger writes to `/tmp/oh-my-opencode.log` — check there for debugging
- Background tasks: 5 concurrent per model/provider (configurable)
- Plugin load timeout: 10s for Claude Code plugins
- Model fallback priority: Claude > OpenAI > Gemini > Copilot > OpenCode Zen > Z.ai > Kimi
- Config migration runs automatically on legacy keys (agent names, hook names, model versions)
