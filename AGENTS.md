# oh-my-opencode — O P E N C O D E Plugin

**Generated:** 2026-03-06 | **Commit:** 7fe44024 | **Branch:** dev

## OVERVIEW

OpenCode plugin (npm: `oh-my-opencode`) that extends Claude Code (OpenCode fork) with multi-agent orchestration, 46 lifecycle hooks, 26 tools, skill/command/MCP systems, and Claude Code compatibility. 1268 TypeScript files, 160k LOC.

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

## 8 OPENCODE HOOK HANDLERS

| Handler | Purpose |
|---------|---------|
| `config` | 6-phase: provider → plugin-components → agents → tools → MCPs → commands |
| `tool` | 26 registered tools |
| `chat.message` | First-message variant, session setup, keyword detection |
| `chat.params` | Anthropic effort level adjustment |
| `chat.headers` | Copilot x-initiator header injection |
| `event` | Session lifecycle (created, deleted, idle, error) |
| `tool.execute.before` | Pre-tool hooks (file guard, label truncator, rules injector) |
| `tool.execute.after` | Post-tool hooks (output truncation, metadata store) |
| `experimental.chat.messages.transform` | Context injection, thinking block validation |


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

- `agents`, `categories`, `claude_code`: deep merged recursively
- `disabled_*` arrays: Set union (concatenated + deduplicated)
- All other fields: override replaces base value
- Zod `safeParse()` fills defaults for omitted fields
- `migrateConfigFile()` transforms legacy keys automatically

Fields: agents (14 overridable, 21 fields each), categories (8 built-in + custom), disabled_* arrays (agents, hooks, mcps, skills, commands, tools), 19 feature-specific configs.

## THREE-TIER MCP SYSTEM

| Tier | Source | Mechanism |
|------|--------|-----------|
| Built-in | `src/mcp/` | 3 remote HTTP: websearch (Exa/Tavily), context7, grep_app |
| Claude Code | `.mcp.json` | `${VAR}` env expansion via claude-code-mcp-loader |
| Skill-embedded | SKILL.md YAML | Managed by SkillMcpManager (stdio + HTTP) |

## CONVENTIONS

- **Runtime**: Bun only — never use npm/yarn
- **TypeScript**: strict mode, ESNext, bundler moduleResolution, `bun-types` (never `@types/node`)
- **Test pattern**: Bun test (`bun:test`), co-located `*.test.ts`, given/when/then style (nested describe with `#given`/`#when`/`#then` prefixes)
- **CI test split**: mock-heavy tests run in isolation (separate `bun test` processes), rest in batch
- **Factory pattern**: `createXXX()` for all tools, hooks, agents
- **Hook tiers**: Session (23) → Tool-Guard (10) → Transform (4) → Continuation (7) → Skill (2)
- **Agent modes**: `primary` (respects UI model) vs `subagent` (own fallback chain) vs `all`
- **Model resolution**: 4-step: override → category-default → provider-fallback → system-default
- **Config format**: JSONC with comments, Zod v4 validation, snake_case keys
- **File naming**: kebab-case for all files/directories
- **Module structure**: index.ts barrel exports, no catch-all files (utils.ts, helpers.ts banned), 200 LOC soft limit
- **Imports**: relative within module, barrel imports across modules (`import { log } from "./shared"`)
- **No path aliases**: no `@/` — relative imports only

## ANTI-PATTERNS

- Never use `as any`, `@ts-ignore`, `@ts-expect-error`
- Never suppress lint/type errors
- Never add emojis to code/comments unless user explicitly asks
- Never commit unless explicitly requested
- Never run `bun publish` directly — use GitHub Actions
- Never modify `package.json` version locally
- Test: given/when/then — never use Arrange-Act-Assert comments
- Comments: avoid AI-generated comment patterns (enforced by comment-checker hook)
- Never create catch-all files (`utils.ts`, `helpers.ts`, `service.ts`)
- Empty catch blocks `catch(e) {}` — always handle errors
- Never use em dashes (—), en dashes (–), or AI filler phrases in generated content
- index.ts is entry point ONLY — never dump business logic there

## COMMANDS

```bash
bun test                    # Bun test suite
bun run build              # Build plugin (ESM + declarations + schema)
bun run build:all          # Build + platform binaries
bun run rebuild            # Clean + Build
bun run typecheck           # tsc --noEmit
bun run build:schema       # Regenerate JSON schema
bunx oh-my-opencode install # Interactive setup
bunx oh-my-opencode doctor  # Health diagnostics
bunx oh-my-opencode run     # Non-interactive session
```

## DEPLOYMENT

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| ci.yml | push/PR to master/dev | Tests (split: mock-heavy isolated + batch), typecheck, build, schema auto-commit |
| publish.yml | manual dispatch | Version bump, npm publish, platform binaries, GitHub release, merge to master |
| publish-platform.yml | called by publish | 12 platform binaries via bun compile (darwin/linux/windows) |
| sisyphus-agent.yml | @mention / dispatch | AI agent handles issues/PRs |
| cla.yml | issue_comment/PR | CLA assistant for contributors |
| lint-workflows.yml | push to .github/ | actionlint + shellcheck on workflow files |

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

- Logger writes to `/tmp/oh-my-opencode.log` — check there for debugging
- Background tasks: 5 concurrent per model/provider (configurable)
- Plugin load timeout: 10s for Claude Code plugins
- Model fallback priority: Claude > OpenAI > Gemini > Copilot > OpenCode Zen > Z.ai > Kimi
- Config migration runs automatically on legacy keys (agent names, hook names, model versions)
- Build: bun build (ESM) + tsc --emitDeclarationOnly, externals: @ast-grep/napi
- Test setup: `test-setup.ts` preloaded via bunfig.toml, mock-heavy tests run in isolation in CI
- 98 barrel export files (index.ts) establish module boundaries
- Architecture rules enforced via `.sisyphus/rules/modular-code-enforcement.md`
- **No linter/formatter**: No ESLint, Prettier, or Biome configured
- **License**: SUL-1.0 (Sisyphus Use License)
