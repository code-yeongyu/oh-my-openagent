# PROJECT KNOWLEDGE BASE

**Generated:** 2026-01-17T19:00:25+09:00
**Commit:** 987ae468
**Branch:** dev

## OVERVIEW

OpenCode plugin implementing Claude Code/AmpCode features. Multi-model agent orchestration (GPT-5.2, Claude, Gemini, Grok), LSP tools (11), AST-Grep search, MCP integrations (context7, websearch_exa, grep_app). "oh-my-zsh" for OpenCode.

## STRUCTURE

```
oh-my-opencode/
├── src/
│   ├── agents/        # AI agents (10+): Sisyphus, oracle, librarian, explore, frontend, document-writer, multimodal-looker, prometheus, metis, momus
│   ├── hooks/         # 22+ lifecycle hooks - see src/hooks/AGENTS.md
│   ├── tools/         # LSP, AST-Grep, Grep, Glob, session mgmt - see src/tools/AGENTS.md
│   ├── features/      # Claude Code compat layer - see src/features/AGENTS.md
│   ├── shared/        # Cross-cutting utilities - see src/shared/AGENTS.md
│   ├── cli/           # CLI installer, doctor - see src/cli/AGENTS.md
│   ├── mcp/           # MCP configs: context7, grep_app, websearch
│   ├── config/        # Zod schema, TypeScript types
│   └── index.ts       # Main plugin entry (568 lines)
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
| Orchestrator | `src/hooks/sisyphus-orchestrator/` | Main orchestration hook (771 lines) |

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
- **Testing**: BDD comments `#given/#when/#then`, TDD workflow (RED-GREEN-REFACTOR), 80+ test files
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
- **Sequential agent calls**: Use `delegate_task` for parallel execution
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
| Sisyphus | anthropic/claude-opus-4-5 | Primary orchestrator with extended thinking |
| oracle | openai/gpt-5.2 | Read-only consultation. High-IQ debugging, architecture |
| librarian | opencode/glm-4.7-free | Multi-repo analysis, docs |
| explore | opencode/grok-code | Fast codebase exploration |
| frontend-ui-ux-engineer | google/gemini-3-pro-preview | UI generation |
| document-writer | google/gemini-3-pro-preview | Technical docs |
| multimodal-looker | google/gemini-3-flash | PDF/image analysis |
| Prometheus (Planner) | anthropic/claude-opus-4-5 | Strategic planning, interview-driven |
| Metis (Plan Consultant) | anthropic/claude-sonnet-4-5 | Pre-planning analysis |
| Momus (Plan Reviewer) | anthropic/claude-sonnet-4-5 | Plan validation |

## COMMANDS

```bash
bun run typecheck      # Type check
bun run build          # ESM + declarations + schema
bun run rebuild        # Clean + Build
bun run build:schema   # Schema only
bun test               # Run tests (80+ test files, 2500+ BDD assertions)
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

## COMPLEXITY HOTSPOTS

| File | Lines | Description |
|------|-------|-------------|
| `src/agents/orchestrator-sisyphus.ts` | 1531 | Orchestrator agent, 7-section delegation, accumulated wisdom |
| `src/features/builtin-skills/skills.ts` | 1203 | Skill definitions (frontend-ui-ux, playwright) |
| `src/agents/prometheus-prompt.ts` | 1196 | Planning agent, interview mode, multi-agent validation |
| `src/features/background-agent/manager.ts` | 1165 | Task lifecycle, concurrency |
| `src/hooks/sisyphus-orchestrator/index.ts` | 771 | Orchestrator hook impl |
| `src/tools/delegate-task/tools.ts` | 770 | Category-based task delegation |
| `src/cli/config-manager.ts` | 730 | JSONC parsing, multi-level config, env detection |
| `src/agents/sisyphus.ts` | 640 | Main Sisyphus prompt |
| `src/features/builtin-commands/templates/refactor.ts` | 619 | Refactoring command template |
| `src/tools/lsp/client.ts` | 596 | LSP protocol, JSON-RPC |
| `src/index.ts` | 568 | Main plugin, all hook/tool init |

## MCP ARCHITECTURE

Three-tier MCP system:
1. **Built-in**: `websearch` (Exa), `context7` (docs), `grep_app` (GitHub search)
2. **Claude Code compatible**: `.mcp.json` files with `${VAR}` expansion
3. **Skill-embedded**: YAML frontmatter in skills (e.g., playwright)

## CONFIG SYSTEM

- **Zod validation**: `src/config/schema.ts`
- **JSONC support**: Comments and trailing commas
- **Multi-level**: User (`~/.config/opencode/`) → Project (`.opencode/`)
- **CLI doctor**: Validates config and reports errors

## NOTES

- **Testing**: Bun native test (`bun test`), BDD-style `#given/#when/#then`, 80+ test files
- **OpenCode**: Requires >= 1.0.150
- **Multi-lang docs**: README.md (EN), README.ko.md (KO), README.ja.md (JA), README.zh-cn.md (ZH-CN)
- **Config**: `~/.config/opencode/oh-my-opencode.json` (user) or `.opencode/oh-my-opencode.json` (project)
- **Trusted deps**: @ast-grep/cli, @ast-grep/napi, @code-yeongyu/comment-checker
- **JSONC support**: Config files support comments (`// comment`, `/* block */`) and trailing commas
- **Claude Code Compat**: Full compatibility layer for settings.json hooks, commands, skills, agents, MCPs
- **Skill MCP**: Skills can embed MCP server configs in YAML frontmatter
