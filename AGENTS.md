# PROJECT KNOWLEDGE BASE

**Generated:** 2026-01-02T10:35:00+09:00
**Commit:** bebe660
**Branch:** dev

## OVERVIEW

OpenCode plugin: multi-model agent orchestration (Claude Opus 4.5, GPT-5.2, Gemini 3, Grok), 11 LSP tools, AST-Grep, Claude Code compatibility layer. "oh-my-zsh" for OpenCode.

## STRUCTURE

```
oh-my-opencode/
├── src/
│   ├── agents/        # 7 AI agents - see src/agents/AGENTS.md
│   ├── hooks/         # 22 lifecycle hooks - see src/hooks/AGENTS.md
│   ├── tools/         # LSP, AST-Grep, session mgmt - see src/tools/AGENTS.md
│   ├── features/      # Claude Code compat layer - see src/features/AGENTS.md
│   ├── auth/          # Google Antigravity OAuth - see src/auth/AGENTS.md
│   ├── shared/        # Cross-cutting utilities - see src/shared/AGENTS.md
│   ├── cli/           # CLI installer, doctor - see src/cli/AGENTS.md
│   ├── mcp/           # MCP configs: context7, websearch_exa, grep_app
│   ├── config/        # Zod schema, TypeScript types
│   └── index.ts       # Main plugin entry (723 lines)
├── script/            # build-schema.ts, publish.ts, generate-changelog.ts
└── dist/              # Build output (ESM + .d.ts)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add agent | `src/agents/` | Create .ts, add to builtinAgents, update types.ts |
| Add hook | `src/hooks/` | Dir with createXXXHook(), export from index.ts |
| Add tool | `src/tools/` | Dir with constants/types/tools.ts, add to builtinTools |
| Add MCP | `src/mcp/` | Create config, add to index.ts |
| Add skill | `src/features/builtin-skills/` | Dir with SKILL.md |
| Config schema | `src/config/schema.ts` | Run `bun run build:schema` after |
| Claude Code compat | `src/features/claude-code-*-loader/` | Command, skill, agent, mcp loaders |

## CONVENTIONS

- **Bun only**: `bun run`, `bun test`, `bunx` (NEVER npm/npx)
- **Types**: bun-types (not @types/node)
- **Build**: `bun build` (ESM) + `tsc --emitDeclarationOnly`
- **Exports**: Barrel pattern in index.ts; explicit named exports for tools/hooks
- **Naming**: kebab-case directories, createXXXHook/createXXXTool factories
- **Testing**: BDD comments `#given`, `#when`, `#then` (same as AAA)
- **Temperature**: 0.1 for code agents, max 0.3

## ANTI-PATTERNS

| Category | Forbidden |
|----------|-----------|
| Type Safety | `as any`, `@ts-ignore`, `@ts-expect-error` |
| Package Manager | npm, yarn, npx |
| File Ops | Bash mkdir/touch/rm for code file creation |
| Publishing | Direct `bun publish`, local version bump |
| Agent Behavior | High temp (>0.3), broad tool access, sequential agent calls |
| Hooks | Heavy PreToolUse logic, blocking without reason |
| Year | 2024 in code/prompts (use current year) |

## AGENT MODELS

| Agent | Model | Purpose |
|-------|-------|---------|
| Sisyphus | anthropic/claude-opus-4-5 | Primary orchestrator |
| oracle | openai/gpt-5.2 | Strategy, code review |
| librarian | anthropic/claude-sonnet-4-5 | Docs, OSS research |
| explore | opencode/grok-code | Fast codebase grep |
| frontend-ui-ux-engineer | google/gemini-3-pro-preview | UI generation |
| document-writer | google/gemini-3-pro-preview | Technical docs |
| multimodal-looker | google/gemini-3-flash | PDF/image analysis |

## COMMANDS

```bash
bun run typecheck      # Type check
bun run build          # ESM + declarations + schema
bun run rebuild        # Clean + Build
bun test               # Run tests (380+)
```

## DEPLOYMENT

**GitHub Actions workflow_dispatch only**

1. Never modify package.json version locally
2. Commit & push to dev
3. Trigger: `gh workflow run publish -f bump=patch|minor|major`

CI auto-commits schema changes on master, maintains rolling `next` draft release on dev.

## COMPLEXITY HOTSPOTS

| File | Lines | Description |
|------|-------|-------------|
| `src/index.ts` | 723 | Main plugin, all hook/tool init |
| `src/cli/config-manager.ts` | 669 | JSONC parsing, env detection |
| `src/auth/antigravity/fetch.ts` | 621 | Token refresh, URL rewriting |
| `src/tools/lsp/client.ts` | 611 | LSP protocol, JSON-RPC |
| `src/hooks/anthropic-context-window-limit-recovery/executor.ts` | 554 | Multi-stage recovery |
| `src/agents/sisyphus.ts` | 504 | Orchestrator prompt |

## NOTES

- **OpenCode**: Requires >= 1.0.150
- **Config**: `~/.config/opencode/oh-my-opencode.json` or `.opencode/oh-my-opencode.json`
- **JSONC**: Config files support comments and trailing commas
- **Claude Code**: Full compat layer for settings.json hooks, commands, skills, agents, MCPs
- **Skill MCP**: Skills can embed MCP server configs in YAML frontmatter
