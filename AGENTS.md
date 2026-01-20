# PROJECT KNOWLEDGE BASE

**Generated:** 2026-01-19T18:10:00+09:00
**Commit:** 45660940
**Branch:** dev

## OVERVIEW

OpenCode plugin implementing multi-model agent orchestration (Claude Opus 4.5, GPT-5.2, Gemini 3, Grok, GLM-4.7). 31 lifecycle hooks, 20+ tools (LSP, AST-Grep, delegation), 10 specialized agents, Claude Code compatibility layer. "oh-my-zsh" for OpenCode.

## STRUCTURE

```
oh-my-opencode/
├── src/
│   ├── agents/        # 10 AI agents (Sisyphus, oracle, librarian, explore, frontend, etc.) - see src/agents/AGENTS.md
│   ├── hooks/         # 31 lifecycle hooks (PreToolUse, PostToolUse, Stop, etc.) - see src/hooks/AGENTS.md
│   ├── tools/         # 20+ tools (LSP, AST-Grep, delegation, session) - see src/tools/AGENTS.md
│   ├── features/      # Background agents, Claude Code compat layer - see src/features/AGENTS.md
│   ├── shared/        # 43 cross-cutting utilities - see src/shared/AGENTS.md
│   ├── cli/           # CLI installer, doctor, run - see src/cli/AGENTS.md
│   ├── mcp/           # Built-in MCPs: websearch, context7, grep_app
│   ├── config/        # Zod schema, TypeScript types
│   └── index.ts       # Main plugin entry (568 lines)
├── script/            # build-schema.ts, publish.ts, build-binaries.ts
├── packages/          # 7 platform-specific binaries
└── dist/              # Build output (ESM + .d.ts)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add agent | `src/agents/` | Create .ts with factory, add to `builtinAgents` in index.ts |
| Add hook | `src/hooks/` | Create dir with `createXXXHook()`, register in index.ts |
| Add tool | `src/tools/` | Dir with index/types/constants/tools.ts, add to `builtinTools` |
| Add MCP | `src/mcp/` | Create config, add to index.ts |
| Add skill | `src/features/builtin-skills/` | Create dir with SKILL.md |
| LSP behavior | `src/tools/lsp/` | client.ts (connection), tools.ts (handlers) |
| AST-Grep | `src/tools/ast-grep/` | napi.ts for @ast-grep/napi binding |
| Config schema | `src/config/schema.ts` | Zod schema, run `bun run build:schema` after changes |
| Claude Code compat | `src/features/claude-code-*-loader/` | Command, skill, agent, mcp loaders |
| Background agents | `src/features/background-agent/` | manager.ts (1165 lines) for task lifecycle |
| Skill MCP | `src/features/skill-mcp-manager/` | MCP servers embedded in skills |
| CLI installer | `src/cli/install.ts` | Interactive TUI (462 lines) |
| Doctor checks | `src/cli/doctor/checks/` | 14 health checks across 6 categories |
| Orchestrator | `src/hooks/sisyphus-orchestrator/` | Main orchestration hook (771 lines) |

## TDD (Test-Driven Development)

**MANDATORY for new features and bug fixes.** Follow RED-GREEN-REFACTOR:

| Phase | Action | Verification |
|-------|--------|--------------|
| **RED** | Write test describing expected behavior | `bun test` → FAIL (expected) |
| **GREEN** | Implement minimum code to pass | `bun test` → PASS |
| **REFACTOR** | Improve code quality, remove duplication | `bun test` → PASS (must stay green) |

**Rules:**
- NEVER write implementation before test
- NEVER delete failing tests to "pass" - fix the code
- Test file naming: `*.test.ts` alongside source
- BDD comments: `#given`, `#when`, `#then` (same as AAA)

## CONVENTIONS

- **Package manager**: Bun only (`bun run`, `bun build`, `bunx`)
- **Types**: bun-types (not @types/node)
- **Build**: `bun build` (ESM) + `tsc --emitDeclarationOnly`
- **Exports**: Barrel pattern in index.ts; explicit named exports
- **Naming**: kebab-case directories, `createXXXHook`/`createXXXTool` factories
- **Testing**: BDD comments `#given/#when/#then`, 83 test files
- **Temperature**: 0.1 for code agents, max 0.3

## ANTI-PATTERNS (THIS PROJECT)

| Category | Forbidden |
|----------|-----------|
| **Package Manager** | npm, yarn - use Bun exclusively |
| **Types** | @types/node - use bun-types |
| **File Ops** | mkdir/touch/rm/cp/mv in code - agents use bash tool |
| **Publishing** | Direct `bun publish` - use GitHub Actions workflow_dispatch |
| **Versioning** | Local version bump - managed by CI |
| **Date References** | Year 2024 - use current year |
| **Type Safety** | `as any`, `@ts-ignore`, `@ts-expect-error` |
| **Error Handling** | Empty catch blocks `catch(e) {}` |
| **Testing** | Deleting failing tests to "pass" |
| **Agent Calls** | Sequential agent calls - use `delegate_task` for parallel |
| **Tool Access** | Broad tool access - prefer explicit `include` |
| **Hook Logic** | Heavy PreToolUse computation - slows every tool call |
| **Commits** | Giant commits (3+ files = 2+ commits), separate test from impl |
| **Temperature** | >0.3 for code agents |
| **Trust** | Trust agent self-reports - ALWAYS verify independently |

## UNIQUE STYLES

- **Platform**: Union type `"darwin" | "linux" | "win32" | "unsupported"`
- **Optional props**: Extensive `?` for optional interface properties
- **Flexible objects**: `Record<string, unknown>` for dynamic configs
- **Agent tools**: `tools: { include: [...] }` or `tools: { exclude: [...] }`
- **Hook naming**: `createXXXHook` function convention
- **Factory pattern**: Components created via `createXXX()` functions

## AGENT MODELS

| Agent | Default Model | Purpose |
|-------|---------------|---------|
| Sisyphus | anthropic/claude-opus-4-5 | Primary orchestrator with extended thinking |
| oracle | openai/gpt-5.2 | Read-only consultation, high-IQ debugging |
| librarian | opencode/glm-4.7-free | Multi-repo analysis, docs, GitHub search |
| explore | opencode/grok-code | Fast codebase exploration (contextual grep) |
| frontend-ui-ux-engineer | google/gemini-3-pro-preview | UI generation, visual design |
| document-writer | google/gemini-3-flash | Technical documentation |
| multimodal-looker | google/gemini-3-flash | PDF/image analysis |
| Prometheus (Planner) | anthropic/claude-opus-4-5 | Strategic planning, interview mode |
| Metis (Plan Consultant) | anthropic/claude-sonnet-4-5 | Pre-planning analysis |
| Momus (Plan Reviewer) | anthropic/claude-sonnet-4-5 | Plan validation |

## COMMANDS

```bash
bun run typecheck      # Type check
bun run build          # ESM + declarations + schema
bun run rebuild        # Clean + Build
bun run build:schema   # Schema only
bun test               # Run tests (83 test files)
```

## DEPLOYMENT

**GitHub Actions workflow_dispatch only**

1. Never modify package.json version locally
2. Commit & push changes
3. Trigger `publish` workflow: `gh workflow run publish -f bump=patch`

**Critical**: Never `bun publish` directly. Never bump version locally.

## CI PIPELINE

- **ci.yml**: Parallel test/typecheck → build → auto-commit schema on master → rolling `next` draft release
- **publish.yml**: Manual workflow_dispatch → version bump → changelog → 8-package OIDC npm publish → force-push master

## COMPLEXITY HOTSPOTS

| File | Lines | Description |
|------|-------|-------------|
| `src/agents/atlas.ts` | 1531 | Orchestrator agent, 7-section delegation, wisdom accumulation |
| `src/features/builtin-skills/skills.ts` | 1203 | Skill definitions (playwright, git-master, frontend-ui-ux) |
| `src/agents/prometheus-prompt.ts` | 1196 | Planning agent, interview mode, Momus loop |
| `src/features/background-agent/manager.ts` | 1165 | Task lifecycle, concurrency, notification batching |
| `src/hooks/sisyphus-orchestrator/index.ts` | 771 | Orchestrator hook implementation |
| `src/tools/delegate-task/tools.ts` | 761 | Category-based task delegation |
| `src/cli/config-manager.ts` | 730 | JSONC parsing, multi-level config |
| `src/agents/sisyphus.ts` | 640 | Main Sisyphus prompt |
| `src/features/builtin-commands/templates/refactor.ts` | 619 | Refactoring command template |
| `src/tools/lsp/client.ts` | 596 | LSP protocol, JSON-RPC |

## MCP ARCHITECTURE

Three-tier MCP system:
1. **Built-in**: `websearch` (Exa), `context7` (docs), `grep_app` (GitHub search)
2. **Claude Code compatible**: `.mcp.json` files with `${VAR}` expansion
3. **Skill-embedded**: YAML frontmatter in skills (e.g., playwright)

## CONFIG SYSTEM

- **Zod validation**: `src/config/schema.ts`
- **JSONC support**: Comments and trailing commas
- **Multi-level**: Project (`.opencode/`) → User (`~/.config/opencode/`)
- **CLI doctor**: Validates config and reports errors

## NOTES

- **Testing**: Bun native test (`bun test`), BDD-style, 83 test files
- **OpenCode**: Requires >= 1.0.150
- **Multi-lang docs**: README.md (EN), README.ko.md (KO), README.ja.md (JA), README.zh-cn.md (ZH-CN)
- **Config**: `~/.config/opencode/oh-my-opencode.json` (user) or `.opencode/oh-my-opencode.json` (project)
- **Trusted deps**: @ast-grep/cli, @ast-grep/napi, @code-yeongyu/comment-checker
- **Claude Code Compat**: Full compatibility layer for settings.json hooks, commands, skills, agents, MCPs
- **Flaky tests**: 2 known flaky tests (ralph-loop CI timeout, session-state parallel pollution)
