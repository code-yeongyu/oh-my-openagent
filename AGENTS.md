# PROJECT KNOWLEDGE BASE

**Version:** 1.1.1 (package.json) · OpenCode plugin SDK `@opencode-ai/plugin` v1.3.15 · Bun-types 1.3.6

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

Matrixx is a **plugin for OpenCode**. You will frequently need to examine OpenCode's source code to:
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

Matrixx is a multi-agent orchestration **plugin for OpenCode**. It coordinates 14 built-in AI agents (including the **Sati** frontend specialist, **Sentinel** security auditor, and **Cipher** DSL expert) via ~41 lifecycle hooks and ~26 custom tools. 262 test files (~144k LOC) cover 1241 TypeScript source files.

| Aspect | Value |
|---|---|
| Package | `opencode-matrixx` (npm, v1.1.1) |
| Entry | `src/index.ts` → `MatrixxPlugin` |
| Binaries | `bin/matrixx.js` (platform wrappers in `bin/`) |
| Stack | Bun + TypeScript 5.7 + Zod v4 + Biome (linter only) |
| License | SUL-1.0 (Morpheus Use License) |

## STRUCTURE (high-signal only)

```
matrixx/
├── src/
│   ├── index.ts                    # Main plugin entry — MatrixxPlugin factory
│   ├── create-hooks.ts             # Core + Continuation + Skill hook tiers
│   ├── create-managers.ts          # Tmux / Background / SkillMcp / Config managers
│   ├── create-tools.ts             # Tool registry + skill context composition
│   ├── plugin-config.ts            # Config load + Zod validation
│   ├── plugin-state.ts             # Model context-limit cache
│   ├── agents/   → 14 agents (incl. Sati, Cipher, Sentinel) + AGENTS.md
│   ├── hooks/    → ~41 hooks in 3 tiers
│   ├── tools/    → 14 dirs (LSP, AST-grep, delegate-task, session, etc.)
│   ├── features/ → 17 dirs (skills loader, tasks, tmux, MCP, CC compat)
│   ├── shared/   → 80+ utilities
│   ├── mcp/      → 6 built-in MCPs (websearch, context7, grep_app, ...)
│   ├── cli/      → CLI installer, doctor, config-manager
│   ├── config/   → Zod schema
│   ├── plugin/   → Hook composition (create-core/continuation/skill-hooks)
│   └── plugin-handlers/ → Config-loading pipeline (6 phases)
├── bin/                            # Platform-detecting CLI wrappers
├── script/                         # build-schema, build-binaries, publish, generate-changelog
├── packages/                       # 7 platform + 4 baseline binary packages
├── .opencode/                      # Local OpenCode config (user commands, skills)
├── docs/                           # Long-form docs (configurations.md is ~50k)
└── dist/                           # Build output (ESM + .d.ts + schema)
```

Each subdir has its own `AGENTS.md` with deeper detail — **read them when working in that area**.

## QUICK COMMANDS

```bash
bun install                         # needs BUN_INSTALL_ALLOW_SCRIPTS="@ast-grep/napi"
bun run typecheck                   # tsc --noEmit
bun run lint                        # biome check src/
bun run lint:fix                    # biome check --write src/
bun test                            # all tests (some MUST be isolated, see below)
bun run build                       # ESM + dts + schema
bun run build:all                   # + build:binaries (cross-compile native pkgs)
bun run build:schema                # regenerate dist/matrixx.schema.json
bun run rebuild                     # clean + build
```

Local-dev install into OpenCode: `bun run build`, then in `~/.config/opencode/opencode.jsonc` add `"plugin": ["file:///abs/path/to/matrixx/dist/index.js"]`. Restart OpenCode.

## INSTALL & TEST GOTCHAS (READ THIS)

### `BUN_INSTALL_ALLOW_SCRIPTS="@ast-grep/napi"` is REQUIRED

`@ast-grep/napi` runs a postinstall script. Without this env var, install hangs or fails. This is what CI does — copy it.

```bash
BUN_INSTALL_ALLOW_SCRIPTS="@ast-grep/napi" bun install
```

### Tests that MUST be isolated (CI runs them in separate `bun test` invocations)

~30 test files use `mock.module()` which pollutes bun's module cache. Running them in parallel with other tests causes cross-file pollution. They are listed in `.github/workflows/ci.yml` and `.github/workflows/publish.yml`. The exact list drifts — when adding a new test that uses `mock.module()`, add it to **both** workflows in the "mock-heavy" list **and** the `--exclude` patterns in the catch-all `find … | xargs bun test` block.

`bunfig.toml` preloads `test-setup.ts` which calls `_resetForTesting()` from `src/features/claude-code-session-state/state` before each test — keeps state isolated.

## PLUGIN INITIALIZATION (10 steps, `src/index.ts`)

```
MatrixxPlugin(ctx)
  1. injectServerAuthIntoClient(ctx.client)       // inject auth into OpenCode SDK client
  2. startTmuxCheck()                              // detect tmux availability
  3. loadPluginConfig(ctx.directory, ctx)         // → MatrixxConfig (Zod-validated)
  4. createFirstMessageVariantGate()              // first-message variant override
  5. createModelCacheState()                       // model context-limit cache
  6. createManagers(...)                           // 4 managers
  7. createTools(...)                              // filteredTools, mergedSkills, ...
  8. createHooks(...)                              // core + continuation + skill
  9. createPluginInterface(...)                    // 8 OpenCode hook handlers
 10. Return plugin with experimental.session.compacting
```

**CRITICAL**: Do NOT export functions from `src/index.ts`. OpenCode treats ALL exports as plugin instances and calls them. Only re-export types (see the file footer for the canonical list).

## WHERE TO ADD NEW X

| Task | Location | Notes |
|------|----------|-------|
| New agent | `src/agents/<name>.ts` | Add to `agentSources` in `src/agents/builtin-agents.ts`; update `BuiltinAgentNameSchema` in `src/config/schema/agent-names.ts` |
| New hook | `src/hooks/<name>/` | Add to `HookNameSchema` in `src/config/schema/hooks.ts`; register in `src/plugin/hooks/create-{core,continuation,skill}-hooks.ts` |
| New tool | `src/tools/<name>/` (index, types, constants, tools, utils) | Register in `src/plugin/tool-registry.ts` |
| New MCP | `src/mcp/` | Add to `createBuiltinMcps()` |
| New built-in skill | `src/features/builtin-skills/skills/` | Export from `skills/index.ts`; add to `createBuiltinSkills()` |
| New command | `src/features/builtin-commands/` | Add template + register in `commands.ts` |
| Schema field | `src/config/schema/` | Run `bun run build:schema` to regenerate `dist/matrixx.schema.json` AND `assets/matrixx.schema.json` |
| New skill (user-facing) | `.opencode/skills/<name>/SKILL.md` | Loaded by OpenCode for the current dev session — not the plugin |

## OPENCODE PLUGIN API (`@opencode-ai/plugin` v1.3.15)

`Plugin = async (PluginInput) => Hooks`. Hooks returned by `createPluginInterface`:

| Handler | Can Block | Purpose |
|---|---|---|
| `tool` | — | All registered tools |
| `chat.message` | yes | Intercept user message (first-message variant, session setup) |
| `chat.params` | no | Modify LLM params (Anthropic effort, temp, topP) |
| `tool.execute.before` | yes | Pre-tool interception (13 hooks) |
| `tool.execute.after` | no | Post-tool processing (18 hooks) |
| `event` | no | Session lifecycle |
| `config` | — | Register agents / MCPs / commands |
| `experimental.chat.messages.transform` | no | Context injection, keyword detection |
| `experimental.session.compacting` | no | Session compaction (todo preservation) |

## HOOK REGISTRATION (3 tiers, via `src/create-hooks.ts`)

- **Core** (`src/plugin/hooks/create-core-hooks.ts`) — session, tool-guard, transform
- **Continuation** (`create-continuation-hooks.ts`) — todo-continuation, compaction, architect
- **Skill** (`create-skill-hooks.ts`) — category-skill-reminder, auto-slash-command

All hooks use the safe-creation pattern:
```ts
const hook = isHookEnabled("hook-name")
  ? safeCreateHook("hook-name", () => createHookFactory(ctx), { enabled: safeHookEnabled })
  : null
```

## TDD (RED-GREEN-REFACTOR)

MANDATORY. Write the test first → `bun test` → fail → implement → pass → refactor.

- Test file: `*.test.ts` alongside source
- BDD comments: `//#given`, `//#when`, `//#then`
- NEVER delete failing tests — fix the code
- See `tdd-enforcer` skill (built-in) for full conventions

## CONVENTIONS

- **Package manager**: Bun only. `npm`/`yarn` are forbidden.
- **Types**: `bun-types` (pinned to 1.3.6). NEVER `@types/node`.
- **Linter**: Biome 2.5 — linter enabled, formatter disabled. `bun run lint` to check, `bun run lint:fix` to apply. Config: `biome.json` (applies to `src/**/*.ts`).
- **Build**: `bun build` (ESM, target bun) + `tsc --emitDeclarationOnly` + schema gen
- **Exports**: Barrel pattern via `index.ts`. Type-only re-exports where possible.
- **Naming**: kebab-case dirs (`ast-grep/`, `keyword-detector/`); `createXXXHook` / `createXXXTool` factories
- **File size**: 200 LOC hard limit per file (prompt strings exempt)
- **Temperature**: 0.1 for code agents, max 0.3
- **Agent calls**: sequential → use `task(..., run_in_background=true)` parallel
- **Git**: no `git add -i`, no `git rebase -i`, no `--no-verify`, no force push without request

## ANTI-PATTERNS

| Category | Forbidden |
|---|---|
| Type safety | `as any`, `@ts-ignore`, `@ts-expect-error` |
| Error handling | Empty catch blocks |
| Testing | Deleting failing tests, writing impl before test |
| Hooks | Heavy `PreToolUse` logic — runs on EVERY tool call |
| File ops in code | `mkdir`/`touch`/`rm`/`cp`/`mv` — use bash tool |
| Catch-all files | `utils.ts`/`helpers.ts` — name by purpose |
| Bash | `sleep N` — use conditional waits; `cd dir && cmd` — use `workdir` |
| Publishing | Direct `bun publish` — CI only. Never bump version locally. |

## AGENT MODELS (built-in, 14 agents via `BuiltinAgentNameSchema`)

The `agentSources` registry in `src/agents/builtin-agents.ts` lists 12 (including Sati, the frontend specialist); `oracle` is built dynamically in `src/plugin-handlers/agent-config-handler.ts`. `mouse` is built via `createMouseAgentWithOverrides` and `OpenCode-Builder` is added when `morpheus_agent.default_builder_enabled`. Fallback chains defined per-agent in `src/agents/<name>.ts`.

For full model/temp/fallback details see the per-agent file or `src/agents/AGENTS.md`.

## DEPLOYMENT (GitHub Actions only)

1. Commit & push to a feature branch
2. Open PR → `dev` (CI: typecheck + lint + test + build)
3. After merge to `dev`, `draft-release` job creates `next` draft release
4. Release: `gh workflow run publish -f bump=patch` (or `minor`/`major`); can override with `version` input. `skip_platform=true` skips native binary builds.
5. `master` is auto-updated by the publish workflow; CI auto-commits schema changes to `assets/matrixx.schema.json` on push to `master`

**Never** `bun publish` directly. **Never** bump `package.json` version locally.

## CONFIG SYSTEM

- Zod schema in `src/config/schema/`
- Project (`matrixx.json`/`.jsonc`) → User (`~/.config/opencode/matrixx.json`) → Defaults
- JSONC: comments + trailing commas via `jsonc-parser` (use `src/shared/jsonc-parser.ts`, not raw `JSON.parse`)
- Legacy config auto-migrated by `src/shared/migration/` (agent names, hook names, model versions)
- Profiles: `free | budget | economy | balanced | performance | go | xiaomi-ultimate | go-ultimate | go-trio`

## MCP ARCHITECTURE (3 tiers)

1. **Built-in** (`src/mcp/`): websearch (Exa/Tavily), context7, grep_app, document-reader
2. **Claude Code compat** (`features/claude-code-mcp-loader/`): `.mcp.json` with `${VAR}` expansion
3. **Skill-embedded** (`features/opencode-skill-loader/`): YAML frontmatter in `SKILL.md`

## KNOWN HOTSPOTS (largest files)

| File | Notes |
|---|---|
| `src/features/background-agent/manager.ts` | Task lifecycle, concurrency |
| `src/hooks/anthropic-context-window-limit-recovery/` | Multi-strategy context recovery |
| `src/hooks/todo-continuation-enforcer/` | Core mission mechanism |
| `src/hooks/architect/` | Main orchestration hook |
| `src/hooks/matrix-loop/` | Self-referential dev loop |
| `src/hooks/keyword-detector/` | Mode detection (ultrawork/search) |
| `src/hooks/rules-injector/` | Conditional rules injection |
| `src/hooks/think-mode/` | Model/variant switching |
| `src/hooks/session-recovery/` | Auto error recovery |
| `src/features/builtin-skills/skills/git-master.ts` | Git master skill |
| `src/tools/delegate-task/constants.ts` | Category routing configs |

## NOTES

- **OpenCode SDK**: `>= 1.0.150`
- **Trusted deps**: `@ast-grep/cli`, `@ast-grep/napi`, `@code-yeongyu/comment-checker` (in `package.json::trustedDependencies`)
- **Optional platform packages**: 7 main + 4 `*-baseline` variants (glibc x86_64 baseline builds)
- **Logger**: `src/shared/logger.ts` writes to `/tmp/matrixx.log` (62 importers)
- **Local dev state**: `.matrixx/` (handoff, notepads, drafts), `sisyphus-prompt.md`, `UNIQUE_BRANCH_MARKER.md` — dev-only, gitignored
- **Flaky tests**: `matrix-loop` (CI timeout), `session-state` (parallel pollution)
- **User-installed skills (project)**: `github-issue-triage`, `github-pr-triage` — use when triaging issues/PRs
- **Sati frontend skills**: `frontend-ui-ux`, `dev-browser`, `playwright`, `software-dev`, `quality-gate` (bundled with the Sati subagent)
- **Per-area AGENTS.md**: `src/`, `src/agents/`, `src/hooks/`, `src/tools/`, `src/features/`, `src/shared/`, `src/config/`, `src/plugin-handlers/`, `src/mcp/`, `src/cli/`
