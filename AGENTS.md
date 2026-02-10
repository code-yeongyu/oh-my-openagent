# PROJECT KNOWLEDGE BASE

**Generated:** 2026-02-10T14:44:00+09:00
**Commit:** b538806d
**Branch:** dev

---

## CRITICAL: PULL REQUEST TARGET BRANCH (NEVER DELETE THIS SECTION)

> **THIS SECTION MUST NEVER BE REMOVED OR MODIFIED**

### Git Workflow

```
master (deployed/published)
   ↑
  dev (integration branch)
   ↑
feature branches (your work)
```

### Rules (MANDATORY)

| Rule | Description |
|------|-------------|
| **ALL PRs → `dev`** | Every pull request MUST target the `dev` branch |
| **NEVER PR → `master`** | PRs to `master` are **automatically rejected** by CI |
| **"Create a PR" = target `dev`** | When asked to create a new PR, it ALWAYS means targeting `dev` |
| **Merge commit ONLY** | Squash merge is **disabled** in this repo. Always use merge commit when merging PRs. |

### Why This Matters

- `master` = production/published npm package
- `dev` = integration branch where features are merged and tested
- Feature branches → `dev` → (after testing) → `master`
- Squash merge is disabled at the repository level — attempting it will fail

**If you create a PR targeting `master`, it WILL be rejected. No exceptions.**

---

## CRITICAL: OPENCODE SOURCE CODE REFERENCE (NEVER DELETE THIS SECTION)

> **THIS SECTION MUST NEVER BE REMOVED OR MODIFIED**

### This is an OpenCode Plugin

Oh-My-OpenCode is a **plugin for OpenCode**. You will frequently need to examine OpenCode's source code to:
- Understand plugin APIs and hooks
- Debug integration issues
- Implement features that interact with OpenCode internals
- Answer questions about how OpenCode works

### How to Access OpenCode Source Code

**When you need to examine OpenCode source:**

1. **Clone to system temp directory:**
   ```bash
   git clone https://github.com/sst/opencode /tmp/opencode-source
   ```

2. **Explore the codebase** from there (do NOT clone into the project directory)

3. **Clean up** when done (optional, temp dirs are ephemeral)

### Librarian Agent: YOUR PRIMARY TOOL for Plugin Work

**CRITICAL**: When working on plugin-related tasks or answering plugin questions:

| Scenario | Action |
|----------|--------|
| Implementing new hooks | Fire `librarian` to search OpenCode hook implementations |
| Adding new tools | Fire `librarian` to find OpenCode tool patterns |
| Understanding SDK behavior | Fire `librarian` to examine OpenCode SDK source |
| Debugging plugin issues | Fire `librarian` to find relevant OpenCode internals |
| Answering "how does OpenCode do X?" | Fire `librarian` FIRST |

**DO NOT guess or hallucinate about OpenCode internals.** Always verify by examining actual source code via `librarian` or direct clone.

---

## CRITICAL: ENGLISH-ONLY POLICY (NEVER DELETE THIS SECTION)

> **THIS SECTION MUST NEVER BE REMOVED OR MODIFIED**

### All Project Communications MUST Be in English

| Context | Language Requirement |
|---------|---------------------|
| **GitHub Issues** | English ONLY |
| **Pull Requests** | English ONLY (title, description, comments) |
| **Commit Messages** | English ONLY |
| **Code Comments** | English ONLY |
| **Documentation** | English ONLY |
| **AGENTS.md files** | English ONLY |

**If you're not comfortable writing in English, use translation tools. Broken English is fine. Non-English is not acceptable.**

---

## OVERVIEW

OpenCode plugin (v3.4.0): multi-model agent orchestration with 11 specialized agents (Claude Opus 4.6, GPT-5.3 Codex, Gemini 3 Flash, GLM-4.7, Grok). 41 lifecycle hooks across 7 event types, 25+ tools (LSP, AST-Grep, delegation, task management), full Claude Code compatibility layer. "oh-my-zsh" for OpenCode.

## STRUCTURE

```
oh-my-opencode/
├── src/
│   ├── agents/              # 11 AI agents - see src/agents/AGENTS.md
│   ├── hooks/               # 41 lifecycle hooks - see src/hooks/AGENTS.md
│   ├── tools/               # 25+ tools - see src/tools/AGENTS.md
│   ├── features/            # Background agents, skills, CC compat - see src/features/AGENTS.md
│   ├── shared/              # 84 cross-cutting utilities - see src/shared/AGENTS.md
│   ├── cli/                 # CLI installer, doctor - see src/cli/AGENTS.md
│   ├── mcp/                 # Built-in MCPs - see src/mcp/AGENTS.md
│   ├── config/              # Zod schema - see src/config/AGENTS.md
│   ├── plugin-handlers/     # Config loading - see src/plugin-handlers/AGENTS.md
│   ├── plugin/              # Plugin interface composition (21 files)
│   ├── index.ts             # Main plugin entry (88 lines)
│   ├── create-hooks.ts      # Hook creation coordination (62 lines)
│   ├── create-managers.ts   # Manager initialization (80 lines)
│   ├── create-tools.ts      # Tool registry composition (54 lines)
│   ├── plugin-interface.ts  # Plugin interface assembly (66 lines)
│   ├── plugin-config.ts     # Config loading orchestration
│   └── plugin-state.ts      # Model cache state
├── script/                  # build-schema.ts, build-binaries.ts, publish.ts, generate-changelog.ts
├── packages/                # 7 platform-specific binary packages
└── dist/                    # Build output (ESM + .d.ts)
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
  9. createPluginInterface(...)                 → tool, chat.params, chat.message, event, tool.execute.before/after
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
| Background agents | `src/features/background-agent/` | manager.ts (1646 lines) |
| Orchestrator | `src/hooks/atlas/` | Main orchestration hook (1976 lines) |
| Delegation | `src/tools/delegate-task/` | Category routing (constants.ts 569 lines) |
| Task system | `src/features/claude-tasks/` | Task schema, storage, todo sync |
| Plugin interface | `src/plugin/` | 21 files composing hooks, handlers, registries |

## TDD (Test-Driven Development)

**MANDATORY.** RED-GREEN-REFACTOR:
1. **RED**: Write test → `bun test` → FAIL
2. **GREEN**: Implement minimum → PASS
3. **REFACTOR**: Clean up → stay GREEN

**Rules:**
- NEVER write implementation before test
- NEVER delete failing tests - fix the code
- Test file: `*.test.ts` alongside source (176 test files)
- BDD comments: `//#given`, `//#when`, `//#then`

## CONVENTIONS

- **Package manager**: Bun only (`bun run`, `bun build`, `bunx`)
- **Types**: bun-types (NEVER @types/node)
- **Build**: `bun build` (ESM) + `tsc --emitDeclarationOnly`
- **Exports**: Barrel pattern via index.ts
- **Naming**: kebab-case dirs, `createXXXHook`/`createXXXTool` factories
- **Testing**: BDD comments, 176 test files, 117k+ lines TypeScript
- **Temperature**: 0.1 for code agents, max 0.3
- **Modular architecture**: 200 LOC hard limit per file (prompt strings exempt)

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
| Testing | Deleting failing tests, writing implementation before test |
| Agent Calls | Sequential - use `task` parallel |
| Hook Logic | Heavy PreToolUse - slows every call |
| Commits | Giant (3+ files), separate test from impl |
| Temperature | >0.3 for code agents |
| Trust | Agent self-reports - ALWAYS verify |
| Git | `git add -i`, `git rebase -i` (no interactive input) |
| Git | Skip hooks (--no-verify), force push without request |
| Bash | `sleep N` - use conditional waits |
| Bash | `cd dir && cmd` - use workdir parameter |
| Files | Catch-all utils.ts/helpers.ts - name by purpose |

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
| Sisyphus-Junior | anthropic/claude-sonnet-4-5 | 0.1 | Category-spawned executor |

## OPENCODE PLUGIN API

Plugin SDK from `@opencode-ai/plugin` (v1.1.19). Plugin = `async (PluginInput) => Hooks`.

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

**GitHub Actions workflow_dispatch ONLY**
1. Commit & push changes
2. Trigger: `gh workflow run publish -f bump=patch`
3. Never `bun publish` directly, never bump version locally

## COMPLEXITY HOTSPOTS

| File | Lines | Description |
|------|-------|-------------|
| `src/features/background-agent/manager.ts` | 1646 | Task lifecycle, concurrency |
| `src/hooks/anthropic-context-window-limit-recovery/` | 2232 | Multi-strategy context recovery |
| `src/hooks/claude-code-hooks/` | 2110 | Claude Code settings.json compat |
| `src/hooks/todo-continuation-enforcer/` | 2061 | Core boulder mechanism |
| `src/hooks/atlas/` | 1976 | Session orchestration |
| `src/hooks/ralph-loop/` | 1687 | Self-referential dev loop |
| `src/hooks/keyword-detector/` | 1665 | Mode detection (ultrawork/search) |
| `src/hooks/rules-injector/` | 1604 | Conditional rules injection |
| `src/hooks/think-mode/` | 1365 | Model/variant switching |
| `src/hooks/session-recovery/` | 1279 | Auto error recovery |
| `src/features/builtin-skills/skills/git-master.ts` | 1111 | Git master skill |
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
- **1069 TypeScript files**, 176 test files, 117k+ lines
- **Flaky tests**: ralph-loop (CI timeout), session-state (parallel pollution)
- **Trusted deps**: @ast-grep/cli, @ast-grep/napi, @code-yeongyu/comment-checker
- **No linter/formatter**: No ESLint, Prettier, or Biome configured
- **License**: SUL-1.0 (Sisyphus Use License)
