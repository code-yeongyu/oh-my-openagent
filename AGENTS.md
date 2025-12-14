# PROJECT KNOWLEDGE BASE

**Generated:** 2025-12-14T17:16:30+09:00
**Commit:** 7f27fbc
**Branch:** master

## OVERVIEW

OpenCode plugin implementing Claude Code/AmpCode features. Multi-model agent orchestration (GPT-5.2, Claude, Gemini, Grok), LSP tools (11), AST-Grep search, MCP integrations (context7, websearch_exa, grep_app). "oh-my-zsh" for OpenCode.

## STRUCTURE

```
oh-my-opencode/
├── src/
│   ├── agents/        # AI agents (OmO, oracle, librarian, explore, frontend, document-writer, multimodal-looker)
│   ├── hooks/         # 19 lifecycle hooks (comment-checker, rules-injector, keyword-detector, etc.)
│   ├── tools/         # LSP (11), AST-Grep, Grep, background-task, glob, look-at, skill, slashcommand
│   ├── mcp/           # MCP servers (context7, websearch_exa, grep_app)
│   ├── features/      # Terminal features, Claude Code loaders (agent, command, skill, mcp, session-state)
│   ├── config/        # Zod schema, TypeScript types
│   ├── auth/          # Google Antigravity OAuth
│   ├── shared/        # Utilities (deep-merge, pattern-matcher, logger, etc.)
│   └── index.ts       # Main plugin entry (OhMyOpenCodePlugin)
├── script/            # build-schema.ts, publish.ts
├── assets/            # JSON schema
└── dist/              # Build output (ESM + .d.ts)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add new agent | `src/agents/` | Create .ts file, add to builtinAgents in index.ts, update types.ts |
| Add new hook | `src/hooks/` | Create dir with createXXXHook(), export from index.ts |
| Add new tool | `src/tools/` | Dir with index/types/constants/tools.ts, add to builtinTools |
| Add MCP server | `src/mcp/` | Create config, add to index.ts |
| Modify LSP behavior | `src/tools/lsp/` | client.ts for connection, tools.ts for handlers |
| AST-Grep patterns | `src/tools/ast-grep/` | napi.ts for @ast-grep/napi binding |
| Google OAuth | `src/auth/antigravity/` | OAuth plugin for Google models |
| Config schema | `src/config/schema.ts` | Zod schema, run `bun run build:schema` after changes |
| Claude Code compat | `src/features/claude-code-*-loader/` | Command, skill, agent, mcp loaders |

## CONVENTIONS

- **Package manager**: Bun only (`bun run`, `bun build`, `bunx`)
- **Types**: bun-types (not @types/node)
- **Build**: Dual output - `bun build` (ESM) + `tsc --emitDeclarationOnly`
- **Exports**: Barrel pattern - `export * from "./module"` in index.ts
- **Directory naming**: kebab-case (`ast-grep/`, `claude-code-hooks/`)
- **Tool structure**: Each tool has index.ts, types.ts, constants.ts, tools.ts, utils.ts
- **Hook pattern**: `createXXXHook(input: PluginInput)` returning event handlers

## ANTI-PATTERNS (THIS PROJECT)

- **npm/yarn**: Use bun exclusively
- **@types/node**: Use bun-types
- **Bash file operations**: Never use mkdir/touch/rm/cp/mv for file creation in code
- **Generic AI aesthetics**: No Space Grotesk, avoid typical AI-generated UI patterns
- **Direct bun publish**: Use GitHub Actions workflow_dispatch only (OIDC provenance)
- **Local version bump**: Version managed by CI workflow, never modify locally
- **Rush completion**: Never mark tasks complete without verification
- **Interrupting work**: Complete tasks fully before stopping

## UNIQUE STYLES

- **Platform handling**: Union type `"darwin" | "linux" | "win32" | "unsupported"`
- **Optional props**: Extensive use of `?` for optional interface properties
- **Flexible objects**: `Record<string, unknown>` for dynamic configs
- **Error handling**: Consistent try/catch with async/await in all tools
- **Agent tools restriction**: Use `tools: { include: [...] }` or `tools: { exclude: [...] }`
- **Temperature**: Most agents use `0.1` for consistency
- **Hook naming**: `createXXXHook` function naming convention

## AGENT MODELS

| Agent | Model | Purpose |
|-------|-------|---------|
| OmO | anthropic/claude-opus-4-5 | Primary orchestrator, team leader |
| oracle | openai/gpt-5.2 | Strategic advisor, code review, architecture |
| librarian | opencode/big-pickle | Multi-repo analysis, docs lookup, GitHub examples |
| explore | opencode/grok-code | Fast codebase exploration, file patterns |
| frontend-ui-ux-engineer | google/gemini-3-pro-preview | UI generation, design-focused |
| document-writer | google/gemini-3-pro-preview | Technical documentation |
| multimodal-looker | google/gemini-2.5-flash | PDF/image/diagram analysis |

## COMMANDS

```bash
# Type check
bun run typecheck

# Build (ESM + declarations + schema)
bun run build

# Clean + Build
bun run rebuild

# Build schema only
bun run build:schema
```

## DEPLOYMENT

**GitHub Actions workflow_dispatch only**

1. package.json version NOT modified locally (auto-bumped by workflow)
2. Commit & push changes
3. Trigger `publish` workflow manually:
   - `bump`: major | minor | patch
   - `version`: (optional) specific version override

```bash
# Trigger via CLI
gh workflow run publish -f bump=patch

# Check status
gh run list --workflow=publish
```

**Critical**:
- Never run `bun publish` directly (OIDC provenance issue)
- Never bump version locally

## NOTES

- **No tests**: Test framework not configured
- **OpenCode version**: Requires >= 1.0.132 (earlier versions have config bugs)
- **Multi-language docs**: README.md (EN), README.ko.md (KO)
- **Config locations**: `~/.config/opencode/oh-my-opencode.json` (user) or `.opencode/oh-my-opencode.json` (project)
- **Schema autocomplete**: Add `$schema` field in config for IDE support
- **Trusted dependencies**: @ast-grep/cli, @ast-grep/napi, @code-yeongyu/comment-checker
