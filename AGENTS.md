# PROJECT KNOWLEDGE BASE

**Generated:** 2026-01-26T14:50:00+09:00
**Commit:** 9d66b807
**Branch:** dev

---

## **IMPORTANT: PULL REQUEST TARGET BRANCH**

> **ALL PULL REQUESTS MUST TARGET THE `dev` BRANCH.**
>
> **DO NOT CREATE PULL REQUESTS TARGETING `master` BRANCH.**
>
> PRs to `master` will be automatically rejected by CI.

---

## OVERVIEW

OpenCode plugin: multi-model agent orchestration (Claude Opus 4.5, GPT-5.2, Gemini 3 Flash, Grok Code). 32 lifecycle hooks, 20+ tools (LSP, AST-Grep, delegation), 10 specialized agents, full Claude Code compatibility. "oh-my-zsh" for OpenCode.

## STRUCTURE

```
oh-my-opencode/
├── src/
│   ├── agents/        # 10 AI agents - see src/agents/AGENTS.md
│   ├── hooks/         # 32 lifecycle hooks - see src/hooks/AGENTS.md
│   ├── tools/         # 20+ tools - see src/tools/AGENTS.md
│   ├── features/      # Background agents, Claude Code compat - see src/features/AGENTS.md
│   ├── shared/        # 55 cross-cutting utilities - see src/shared/AGENTS.md
│   ├── cli/           # CLI installer, doctor - see src/cli/AGENTS.md
│   ├── mcp/           # Built-in MCPs - see src/mcp/AGENTS.md
│   ├── config/        # Zod schema, TypeScript types
│   └── index.ts       # Main plugin entry (672 lines)
├── script/            # build-schema.ts, build-binaries.ts
├── packages/          # 7 platform-specific binaries
└── dist/              # Build output (ESM + .d.ts)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add agent | `src/agents/` | Create .ts with factory, add to `agentSources` |
| Add hook | `src/hooks/` | Create dir with `createXXXHook()`, register in index.ts |
| Add tool | `src/tools/` | Dir with index/types/constants/tools.ts |
| Add MCP | `src/mcp/` | Create config, add to index.ts |
| Add skill | `src/features/builtin-skills/` | Create dir with SKILL.md |
| Add command | `src/features/builtin-commands/` | Add template + register in commands.ts |
| Config schema | `src/config/schema.ts` | Zod schema, run `bun run build:schema` |
| Background agents | `src/features/background-agent/` | manager.ts (1377 lines) |
| Orchestrator | `src/hooks/atlas/` | Main orchestration hook (752 lines) |

## TDD (Test-Driven Development)

**MANDATORY.** RED-GREEN-REFACTOR:
1. **RED**: Write test → `bun test` → FAIL
2. **GREEN**: Implement minimum → PASS
3. **REFACTOR**: Clean up → stay GREEN

**Rules:**
- NEVER write implementation before test
- NEVER delete failing tests - fix the code
- Test file: `*.test.ts` alongside source (100 test files)
- BDD comments: `//#given`, `//#when`, `//#then`

## CONVENTIONS

- **Package manager**: Bun only (`bun run`, `bun build`, `bunx`)
- **Types**: bun-types (NEVER @types/node)
- **Build**: `bun build` (ESM) + `tsc --emitDeclarationOnly`
- **Exports**: Barrel pattern via index.ts
- **Naming**: kebab-case dirs, `createXXXHook`/`createXXXTool` factories
- **Testing**: BDD comments, 100 test files
- **Temperature**: 0.1 for code agents, max 0.3

## ANTI-PATTERNS

| Category | Forbidden |
|----------|-----------|
| Package Manager | npm, yarn - Bun exclusively |
| Types | @types/node - use bun-types |
| File Ops | mkdir/touch/rm/cp/mv in code - use bash tool |
| Publishing | Direct `bun publish` - GitHub Actions only |
| Versioning | Local version bump - CI manages |
| Type Safety | `as any`, `@ts-ignore`, `@ts-expect-error` |
| Error Handling | Empty catch blocks |
| Testing | Deleting failing tests |
| Agent Calls | Sequential - use `delegate_task` parallel |
| Hook Logic | Heavy PreToolUse - slows every call |
| Commits | Giant (3+ files), separate test from impl |
| Temperature | >0.3 for code agents |
| Trust | Agent self-reports - ALWAYS verify |

## AGENT MODELS

| Agent | Model | Purpose |
|-------|-------|---------|
| Sisyphus | anthropic/claude-opus-4-5 | Primary orchestrator (fallback: kimi-k2.5 → glm-4.7 → gpt-5.2-codex → gemini-3-pro) |
| Atlas | anthropic/claude-sonnet-4-5 | Master orchestrator (fallback: kimi-k2.5 → gpt-5.2) |
| oracle | openai/gpt-5.2 | Consultation, debugging |
| librarian | zai-coding-plan/glm-4.7 | Docs, GitHub search (fallback: glm-4.7-free) |
| explore | anthropic/claude-haiku-4-5 | Fast codebase grep (fallback: gpt-5-mini → gpt-5-nano) |
| multimodal-looker | google/gemini-3-flash | PDF/image analysis |
| Prometheus | anthropic/claude-opus-4-5 | Strategic planning (fallback: kimi-k2.5 → gpt-5.2) |

## COMMANDS

```bash
bun run typecheck      # Type check
bun run build          # ESM + declarations + schema
bun run rebuild        # Clean + Build
bun test               # 100 test files
```

## DEPLOYMENT

**GitHub Actions workflow_dispatch ONLY**
1. Commit & push changes
2. Trigger: `gh workflow run publish -f bump=patch`
3. Never `bun publish` directly, never bump version locally

## COMPLEXITY HOTSPOTS

| File | Lines | Description |
|------|-------|-------------|
| `src/features/builtin-skills/skills.ts` | 1729 | Skill definitions |
| `src/features/background-agent/manager.ts` | 1377 | Task lifecycle, concurrency |
| `src/agents/prometheus-prompt.ts` | 1196 | Planning agent |
| `src/tools/delegate-task/tools.ts` | 1070 | Category-based delegation |
| `src/hooks/atlas/index.ts` | 752 | Orchestrator hook |
| `src/cli/config-manager.ts` | 664 | JSONC config parsing |
| `src/index.ts` | 672 | Main plugin entry |
| `src/features/builtin-commands/templates/refactor.ts` | 619 | Refactor command template |

## MCP ARCHITECTURE

Three-tier system:
1. **Built-in**: websearch (Exa), context7 (docs), grep_app (GitHub)
2. **Claude Code compat**: .mcp.json with `${VAR}` expansion
3. **Skill-embedded**: YAML frontmatter in skills

## CONFIG SYSTEM

- **Zod validation**: `src/config/schema.ts`
- **JSONC support**: Comments, trailing commas
- **Multi-level**: Project (`.opencode/`) → User (`~/.config/opencode/`)

## NOTES

- **OpenCode**: Requires >= 1.0.150
- **Flaky tests**: ralph-loop (CI timeout), session-state (parallel pollution)
- **Trusted deps**: @ast-grep/cli, @ast-grep/napi, @code-yeongyu/comment-checker
