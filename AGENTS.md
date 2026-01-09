# PROJECT KNOWLEDGE BASE

**Generated:** 2026-01-09T15:38:00+09:00
**Commit:** 0581793
**Branch:** dev

## OVERVIEW

OpenCode plugin implementing Claude Code/AmpCode features. Multi-model agent orchestration (GPT-5.2, Claude, Gemini, Grok), LSP tools (11), AST-Grep search, MCP integrations (context7, websearch_exa, grep_app). "oh-my-zsh" for OpenCode.

## STRUCTURE

```
oh-my-opencode/
├── src/
│   ├── agents/        # AI agents (7): Sisyphus, oracle, librarian, explore, frontend, document-writer, multimodal-looker
│   ├── hooks/         # 22 lifecycle hooks - see src/hooks/AGENTS.md
│   ├── tools/         # LSP, AST-Grep, Grep, Glob, session mgmt - see src/tools/AGENTS.md
│   ├── features/      # Claude Code compat layer - see src/features/AGENTS.md
│   ├── auth/          # Google Antigravity OAuth - see src/auth/AGENTS.md
│   ├── shared/        # Cross-cutting utilities - see src/shared/AGENTS.md
│   ├── cli/           # CLI installer, doctor - see src/cli/AGENTS.md
│   ├── mcp/           # MCP configs: context7, grep_app
│   ├── config/        # Zod schema, TypeScript types
│   └── index.ts       # Main plugin entry (548 lines)
├── script/            # build-schema.ts, publish.ts, generate-changelog.ts
├── assets/            # JSON schema
└── dist/              # Build output (ESM + .d.ts)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add agent | `src/agents/` | Create .ts, add to builtinAgents in index.ts, update types.ts |
| Add hook | `src/hooks/` | Create dir with createXXXHook(), export from index.ts |
| Add tool | `src/tools/` | Dir with index/types/constants/tools.ts, add to builtinTools |
| Add MCP | `src/mcp/` | Create config, add to index.ts and types.ts |
| Add skill | `src/features/builtin-skills/` | Create skill dir with SKILL.md |
| LSP behavior | `src/tools/lsp/` | client.ts (connection), tools.ts (handlers) |
| AST-Grep | `src/tools/ast-grep/` | napi.ts for @ast-grep/napi binding |
| Google OAuth | `src/auth/antigravity/` | OAuth plugin for Google/Gemini models |
| Config schema | `src/config/schema.ts` | Zod schema, run `bun run build:schema` after changes |
| Claude Code compat | `src/features/claude-code-*-loader/` | Command, skill, agent, mcp loaders |
| Background agents | `src/features/background-agent/` | manager.ts for task management |
| Skill MCP | `src/features/skill-mcp-manager/` | MCP servers embedded in skills |
| Interactive terminal | `src/tools/interactive-bash/` | tmux session management |
| CLI installer | `src/cli/install.ts` | Interactive TUI installation |
| Doctor checks | `src/cli/doctor/checks/` | Health checks for environment |
| Shared utilities | `src/shared/` | Cross-cutting utilities |
| Slash commands | `src/hooks/auto-slash-command/` | Auto-detect and execute `/command` patterns |
| Ralph Loop | `src/hooks/ralph-loop/` | Self-referential dev loop until completion |
| Orchestrator | `src/hooks/sisyphus-orchestrator/` | Main orchestration hook (660 lines) |

## TDD (Test-Driven Development)

**MANDATORY for new features and bug fixes.** Follow RED-GREEN-REFACTOR:

```
1. RED    - Write failing test first (test MUST fail)
2. GREEN  - Write MINIMAL code to pass (nothing more)
3. REFACTOR - Clean up while tests stay GREEN
4. REPEAT - Next test case
```

| Phase | Action | Verification |
|-------|--------|--------------|
| **RED** | Write test describing expected behavior | `bun test` -> FAIL (expected) |
| **GREEN** | Implement minimum code to pass | `bun test` -> PASS |
| **REFACTOR** | Improve code quality, remove duplication | `bun test` -> PASS (must stay green) |

**Rules:**
- NEVER write implementation before test
- NEVER delete failing tests to "pass" - fix the code
- One test at a time - don't batch
- Test file naming: `*.test.ts` alongside source
- BDD comments: `#given`, `#when`, `#then` (same as AAA)

## CONVENTIONS

- **Package manager**: Bun only (`bun run`, `bun build`, `bunx`)
- **Types**: bun-types (not @types/node)
- **Build**: `bun build` (ESM) + `tsc --emitDeclarationOnly`
- **Exports**: Barrel pattern in index.ts; explicit named exports for tools/hooks
- **Naming**: kebab-case directories, createXXXHook/createXXXTool factories
- **Testing**: BDD comments `#given/#when/#then`, TDD workflow (RED-GREEN-REFACTOR)
- **Temperature**: 0.1 for code agents, max 0.3

## ANTI-PATTERNS (THIS PROJECT)

- **npm/yarn**: Use bun exclusively
- **@types/node**: Use bun-types
- **Bash file ops**: Never mkdir/touch/rm/cp/mv for file creation in code
- **Direct bun publish**: GitHub Actions workflow_dispatch only (OIDC provenance)
- **Local version bump**: Version managed by CI workflow
- **Year 2024**: NEVER use 2024 in code/prompts (use current year)
- **Rush completion**: Never mark tasks complete without verification
- **Over-exploration**: Stop searching when sufficient context found
- **High temperature**: Don't use >0.3 for code-related agents
- **Broad tool access**: Prefer explicit `include` over unrestricted access
- **Sequential agent calls**: Use `sisyphus_task` for parallel execution
- **Heavy PreToolUse logic**: Slows every tool call
- **Self-planning for complex tasks**: Spawn planning agent (Prometheus) instead
- **Trust agent self-reports**: ALWAYS verify results independently
- **Skip TODO creation**: Multi-step tasks MUST have todos first
- **Batch completions**: Mark TODOs complete immediately, don't group
- **Giant commits**: 3+ files = 2+ commits minimum
- **Separate test from impl**: Same commit always

## UNIQUE STYLES

- **Platform**: Union type `"darwin" | "linux" | "win32" | "unsupported"`
- **Optional props**: Extensive `?` for optional interface properties
- **Flexible objects**: `Record<string, unknown>` for dynamic configs
- **Error handling**: Consistent try/catch with async/await
- **Agent tools**: `tools: { include: [...] }` or `tools: { exclude: [...] }`
- **Temperature**: Most agents use `0.1` for consistency
- **Hook naming**: `createXXXHook` function convention
- **Factory pattern**: Components created via `createXXX()` functions

## AGENT MODELS

| Agent | Default Model | Purpose |
|-------|---------------|---------|
| Sisyphus | anthropic/claude-opus-4-5 | Primary orchestrator |
| oracle | openai/gpt-5.2 | Read-only consultation. High-IQ debugging, architecture |
| librarian | anthropic/claude-sonnet-4-5 | Multi-repo analysis, docs |
| explore | opencode/grok-code | Fast codebase exploration |
| frontend-ui-ux-engineer | google/gemini-3-pro-preview | UI generation |
| document-writer | google/gemini-3-pro-preview | Technical docs |
| multimodal-looker | google/gemini-3-flash | PDF/image analysis |

## COMMANDS

```bash
bun run typecheck      # Type check
bun run build          # ESM + declarations + schema
bun run rebuild        # Clean + Build
bun run build:schema   # Schema only
bun test               # Run tests (76 test files, 2559+ BDD assertions)
```

## DEPLOYMENT

**GitHub Actions workflow_dispatch only**

1. Never modify package.json version locally
2. Commit & push changes
3. Trigger `publish` workflow: `gh workflow run publish -f bump=patch`

**Critical**: Never `bun publish` directly. Never bump version locally.

## CI PIPELINE

- **ci.yml**: Parallel test/typecheck, build verification, auto-commit schema on master, rolling `next` draft release
- **publish.yml**: Manual workflow_dispatch, version bump, changelog, OIDC npm publish
- **sisyphus-agent.yml**: Agent-in-CI for automated issue handling via `@sisyphus-dev-ai` mentions

## COMPLEXITY HOTSPOTS

| File | Lines | Description |
|------|-------|-------------|
| `src/agents/orchestrator-sisyphus.ts` | 1484 | Orchestrator agent, complex delegation |
| `src/features/builtin-skills/skills.ts` | 1230 | Skill definitions (frontend-ui-ux, playwright) |
| `src/agents/prometheus-prompt.ts` | 982 | Planning agent system prompt |
| `src/auth/antigravity/fetch.ts` | 798 | Token refresh, URL rewriting |
| `src/auth/antigravity/thinking.ts` | 755 | Thinking block extraction |
| `src/cli/config-manager.ts` | 725 | JSONC parsing, env detection |
| `src/hooks/sisyphus-orchestrator/index.ts` | 660 | Orchestrator hook impl |
| `src/agents/sisyphus.ts` | 641 | Main Sisyphus prompt |
| `src/tools/lsp/client.ts` | 612 | LSP protocol, JSON-RPC |
| `src/features/background-agent/manager.ts` | 608 | Task lifecycle |
| `src/auth/antigravity/response.ts` | 599 | Response transformation, streaming |
| `src/hooks/anthropic-context-window-limit-recovery/executor.ts` | 556 | Multi-stage recovery |
| `src/index.ts` | 548 | Main plugin, all hook/tool init |

## NOTES

- **Testing**: Bun native test (`bun test`), BDD-style `#given/#when/#then`, 76 test files
- **OpenCode**: Requires >= 1.0.150
- **Multi-lang docs**: README.md (EN), README.ko.md (KO), README.ja.md (JA), README.zh-cn.md (ZH-CN)
- **Config**: `~/.config/opencode/oh-my-opencode.json` (user) or `.opencode/oh-my-opencode.json` (project)
- **Trusted deps**: @ast-grep/cli, @ast-grep/napi, @code-yeongyu/comment-checker
- **JSONC support**: Config files support comments (`// comment`, `/* block */`) and trailing commas
- **Claude Code Compat**: Full compatibility layer for settings.json hooks, commands, skills, agents, MCPs
- **Skill MCP**: Skills can embed MCP server configs in YAML frontmatter
