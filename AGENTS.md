# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-02 | **Commit:** 1c2caa09 | **Branch:** dev

## OVERVIEW

OpenCode plugin (npm: `oh-my-opencode`) that extends Claude Code (OpenCode fork) with multi-agent orchestration, 46 lifecycle hooks, 26 tools, skill/command/MCP systems, and Claude Code compatibility. 1243 TypeScript files, 155k LOC.

## STRUCTURE

```
oh-my-opencode/
├── src/
│   ├── index.ts              # Plugin entry: loadConfig → createManagers → createTools → createHooks → createPluginInterface
│   ├── plugin-config.ts      # JSONC multi-level config: user → project → defaults (Zod v4)
│   ├── agents/               # 11 agents (Sisyphus, Hephaestus, Oracle, Librarian, Explore, Atlas, Prometheus, Metis, Momus, Multimodal-Looker, Sisyphus-Junior)
│   ├── hooks/                # 46 hooks across 45 directories + 11 standalone files
│   ├── tools/                # 26 tools across 15 directories
│   ├── features/             # 19 feature modules (background-agent, skill-loader, tmux, MCP-OAuth, etc.)
│   ├── shared/               # 95+ utility files in 13 categories (includes taxonomy-client.ts)
│   ├── config/               # Zod v4 schema system (24 files)
│   ├── cli/                  # CLI: install, run, doctor, mcp-oauth (Commander.js)
│   ├── mcp/                  # 3 built-in remote MCPs (websearch, context7, grep_app)
│   ├── plugin/               # 8 OpenCode hook handlers + 46 hook composition
│   └── plugin-handlers/      # 6-phase config loading pipeline
├── packages/                 # Monorepo: cli-runner, 12 platform binaries
└── local-ignore/             # Dev-only test fixtures
```

## INITIALIZATION FLOW

```
OhMyOpenCodePlugin(ctx)
  1. injectServerAuthIntoClient(ctx.client)
  2. startTmuxCheck()
  3. loadPluginConfig(ctx.directory, ctx)      → OhMyOpenCodeConfig
  4. createFirstMessageVariantGate()
  5. createModelCacheState()
  6. createManagers(ctx, config, tmux, cache)  → TmuxSessionManager, BackgroundManager, SkillMcpManager, ConfigHandler
  7. createTools(ctx, config, managers)         → filteredTools, mergedSkills, availableSkills, availableCategories
  8. createHooks(ctx, config, backgroundMgr)   → 41 hooks (core + continuation + skill)
  9. createPluginInterface(...)                 → 7 OpenCode hook handlers
 10. Return plugin with experimental.session.compacting
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add agent | `src/agents/` | Create .ts with factory, add to `agentSources` in builtin-agents/ |
| Add hook | `src/hooks/` | Create dir, register in `src/plugin/hooks/create-*-hooks.ts` |
| Add tool | `src/tools/` | Dir with index/types/constants/tools.ts |
| Add MCP | `src/mcp/` | Create config, add to `createBuiltinMcps()` |
| Add skill | `src/features/builtin-skills/` | Create .ts in skills/ |
| Add command | `src/features/builtin-commands/` | Add template + register in commands.ts |
| Config schema | `src/config/schema/` | 21 schema component files, run `bun run build:schema` |
| Plugin config | `src/plugin-handlers/config-handler.ts` | JSONC loading, merging, migration |
| Background agents | `src/features/background-agent/` | manager.ts (1701 lines) |
| Orchestrator | `src/hooks/atlas/` | Main orchestration hook (1976 lines) |
| Delegation | `src/tools/delegate-task/` | Category routing (constants.ts 569 lines) |
| Task system | `src/features/claude-tasks/` | Task schema, storage, todo sync |
| Coeus planner | `src/agents/coeus/` | Recursive divide-and-conquer planner (14 files) |
| Plugin interface | `src/plugin/` | 21 files composing hooks, handlers, registries |

## TDD (Test-Driven Development)

**MANDATORY.** RED-GREEN-REFACTOR:
1. **RED**: Write test → `bun test` → FAIL
2. **GREEN**: Implement minimum → PASS
3. **REFACTOR**: Clean up → stay GREEN

**Rules:**
- NEVER write implementation before test
- NEVER delete failing tests — fix the code
- Test file: `*.test.ts` alongside source (176 test files)
- BDD comments: `//#given`, `//#when`, `//#then`

## CONVENTIONS

- **Package manager**: Bun only (`bun run`, `bun build`, `bunx`)
- **Types**: bun-types (NEVER @types/node)
- **Build**: `bun build` (ESM) + `tsc --emitDeclarationOnly`
- **Exports**: Barrel pattern via index.ts
- **Naming**: kebab-case dirs, `createXXXHook`/`createXXXTool` factories
- **Testing**: BDD comments, 176 test files, 1130 TypeScript files
- **Temperature**: 0.1 for code agents, max 0.3
- **Modular architecture**: 200 LOC hard limit per file (prompt strings exempt)

## ANTI-PATTERNS

| Category | Forbidden |
|----------|-----------|
| Package Manager | npm, yarn — Bun exclusively |
| Types | @types/node — use bun-types |
| File Ops | mkdir/touch/rm/cp/mv in code — use bash tool |
| Publishing | Direct `bun publish` — GitHub Actions only |
| Versioning | Local version bump — CI manages |
| Type Safety | `as any`, `@ts-ignore`, `@ts-expect-error` |
| Error Handling | Empty catch blocks |
| Testing | Deleting failing tests, writing implementation before test |
| Agent Calls | Sequential — use `task` parallel |
| Hook Logic | Heavy PreToolUse — slows every call |
| Commits | Giant (3+ files), separate test from impl |
| Temperature | >0.3 for code agents |
| Trust | Agent self-reports — ALWAYS verify |
| Git | `git add -i`, `git rebase -i` (no interactive input) |
| Git | Skip hooks (--no-verify), force push without request |
| Bash | `sleep N` — use conditional waits |
| Bash | `cd dir && cmd` — use workdir parameter |
| Files | Catch-all utils.ts/helpers.ts — name by purpose |

## AGENT MODELS

| Agent | Model | Temp | Purpose |
|-------|-------|------|---------|
| Sisyphus | anthropic/claude-opus-4-6 | 0.1 | Primary orchestrator (fallback: kimi-k2.5 → glm-4.7 → gpt-5.3-codex → gemini-3-pro) |
| Hephaestus | openai/gpt-5.3-codex | 0.1 | Autonomous deep worker (NO fallback) |
| Atlas | anthropic/claude-sonnet-4-5 | 0.1 | Master orchestrator (fallback: kimi-k2.5 → gpt-5.2) |
| Prometheus | anthropic/claude-opus-4-6 | 0.1 | Strategic planning (fallback: kimi-k2.5 → gpt-5.2) |
| oracle | openai/gpt-5.2 | 0.1 | Consultation, debugging (fallback: claude-opus-4-6) |
| librarian | zai-coding-plan/glm-4.7 | 0.1 | Docs, GitHub search (fallback: glm-4.7-free) |
| explore | xai/grok-code-fast-1 | 0.1 | Fast codebase grep (fallback: claude-haiku-4-5 → gpt-5-mini → gpt-5-nano) |
| multimodal-looker | google/gemini-3-flash | 0.1 | PDF/image analysis |
| Metis | anthropic/claude-opus-4-6 | 0.3 | Pre-planning analysis (fallback: kimi-k2.5 → gpt-5.2) |
| Momus | openai/gpt-5.2 | 0.1 | Plan validation (fallback: claude-opus-4-6) |
| Coeus | anthropic/claude-opus-4-6 | 0.1 | Recursive divide-and-conquer planner (fallback: kimi-k2.5 → gpt-5.2 → gemini-3-pro) |
| Sub-Prometheus | anthropic/claude-sonnet-4-5 | 0.1 | Domain-specific sub-planner spawned by Coeus |
| Sisyphus-Junior | anthropic/claude-sonnet-4-5 | 0.1 | Category-spawned executor |

## BUILTIN COMMANDS

| Command | Agent | Purpose |
|---------|-------|---------|
| `/init-deep` | — | Auto-generate hierarchical AGENTS.md files throughout project |
| `/ralph-loop` | — | Self-referential dev loop until completion |
| `/ulw-loop` | — | Ultrawork loop with continuous execution |
| `/cancel-ralph` | — | Cancel active Ralph Loop |
| `/refactor` | — | Intelligent refactoring with LSP, AST-grep, TDD |
| `/start-work` | atlas | Start Sisyphus work session from Prometheus plan |
| `/stop-continuation` | — | Stop all continuation mechanisms (ralph loop, todo, boulder) |
| `/handoff` | — | Create detailed context summary for new session |
| `/coeus` | coeus | Deep research planning with knowledge verification |

## OPENCODE PLUGIN API

Plugin SDK from `@opencode-ai/plugin`. Plugin = `async (PluginInput) => Hooks`.

| Hook | Purpose |
|------|---------|
| `tool` | Register custom tools (Record<string, ToolDefinition>) |
| `chat.message` | Intercept user messages (can modify parts) |
| `chat.params` | Modify LLM parameters (temperature, topP, options) |
| `tool.execute.before` | Pre-tool interception (can modify args) |
| `tool.execute.after` | Post-tool processing (can modify output) |
| `event` | Session lifecycle events (session.created, session.stop, etc.) |
| `config` | Config modification (register agents, MCPs, commands) |
| `experimental.chat.messages.transform` | Transform message history |
| `experimental.session.compacting` | Session compaction customization |

## DEPENDENCIES

| Package | Purpose |
|---------|---------|
| `@opencode-ai/plugin` + `sdk` | OpenCode integration SDK |
| `@ast-grep/cli` + `napi` | AST pattern matching (search/replace) |
| `@code-yeongyu/comment-checker` | AI comment detection/prevention |
| `@modelcontextprotocol/sdk` | MCP client for remote HTTP servers |
| `@clack/prompts` | Interactive CLI TUI |
| `commander` | CLI argument parsing |
| `zod` (v4) | Schema validation for config |
| `jsonc-parser` | JSONC config with comments |
| `picocolors` | Terminal colors |
| `picomatch` | Glob pattern matching |
| `vscode-jsonrpc` | LSP communication |
| `js-yaml` | YAML parsing (tasks, skills) |
| `detect-libc` | Platform binary selection |

## COMMANDS

```bash
bun run typecheck      # Type check
bun run build          # ESM + declarations + schema
bun run rebuild        # Clean + Build
bun test               # 176 test files
bun run build:schema   # Regenerate JSON schema
```

## DEPLOYMENT

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| ci.yml | push/PR | Tests (split: mock-heavy isolated + batch), typecheck, build, schema auto-commit |
| publish.yml | manual | Version bump, npm publish, platform binaries, GitHub release, merge to dev |
| publish-platform.yml | called | 12 platform binaries via bun compile (darwin/linux/windows) |
| sisyphus-agent.yml | @mention | AI agent handles issues/PRs |

## COMPLEXITY HOTSPOTS

| File | Lines | Description |
|------|-------|-------------|
| `src/features/background-agent/manager.ts` | 1701 | Task lifecycle, concurrency |
| `src/hooks/anthropic-context-window-limit-recovery/` | 2232 | Multi-strategy context recovery |
| `src/hooks/claude-code-hooks/` | 2110 | Claude Code settings.json compat |
| `src/hooks/todo-continuation-enforcer/` | 2061 | Core boulder mechanism |
| `src/hooks/atlas/` | 1976 | Session orchestration |
| `src/hooks/ralph-loop/` | 1687 | Self-referential dev loop |
| `src/hooks/keyword-detector/` | 1665 | Mode detection (ultrawork/search) |
| `src/hooks/rules-injector/` | 1604 | Conditional rules injection |
| `src/hooks/think-mode/` | 1365 | Model/variant switching |
| `src/hooks/session-recovery/` | 1279 | Auto error recovery |
| `src/features/builtin-skills/skills/git-master.ts` | 1112 | Git master skill |
| `src/tools/delegate-task/constants.ts` | 569 | Category routing configs |

## MCP ARCHITECTURE

Three-tier system:
1. **Built-in** (src/mcp/): websearch (Exa/Tavily), context7 (docs), grep_app (GitHub)
2. **Claude Code compat** (features/claude-code-mcp-loader/): .mcp.json with `${VAR}` expansion
3. **Skill-embedded** (features/opencode-skill-loader/): YAML frontmatter in SKILL.md

## CONFIG SYSTEM

- **Zod validation**: 21 schema component files in `src/config/schema/`
- **JSONC support**: Comments, trailing commas
- **Multi-level**: Project (`.opencode/`) → User (`~/.config/opencode/`) → Defaults
- **Migration**: Legacy config auto-migration in `src/shared/migration/`

## NOTES

- **OpenCode**: Requires >= 1.0.150
- **1130 TypeScript files**, 176 test files, 127k+ lines
- **Flaky tests**: ralph-loop (CI timeout), session-state (parallel pollution)
- **Trusted deps**: @ast-grep/cli, @ast-grep/napi, @code-yeongyu/comment-checker
- **No linter/formatter**: No ESLint, Prettier, or Biome configured
- **License**: SUL-1.0 (Sisyphus Use License)
