# oh-my-opencode — OpenCode Plugin

**Generated:** 2026-05-08 | **Commit:** cd31d2a1a | **Branch:** dev

## OVERVIEW

OpenCode plugin (npm: `oh-my-opencode`, dual-published as `oh-my-openagent` during the rename transition) extending OpenCode with 11 agents, 52–59 lifecycle hooks (base / +team-mode) across 57 dirs, 20–39 tools (gated by config flags including team-mode), 3-tier MCP system (built-in + .mcp.json + skill-embedded), Hashline LINE#ID edit tool, IntentGate keyword detector, Team Mode (parallel multi-agent coordination, OFF by default), and Claude Code compatibility. **1967 TypeScript files (1304 source + 663 test), 278k LOC, 120 barrel `index.ts` files.** Entry: `src/index.ts` → 7-step init.

## STRUCTURE

```
oh-my-opencode/
├── src/
│   ├── index.ts              # Plugin entry; default export `pluginModule` = `{ id, server }`
│   ├── plugin-config.ts      # JSONC multi-level config: user → project → defaults (Zod v4)
│   ├── plugin-interface.ts   # 10 OpenCode hook handlers
│   ├── create-managers.ts    # 4 managers (Tmux, Background, SkillMcp, ConfigHandler)
│   ├── create-tools.ts       # ToolRegistry composition
│   ├── create-hooks.ts       # 5-tier hook composition
│   ├── agents/               # 11 agents (Sisyphus, Hephaestus, Oracle, Librarian, Explore, Atlas, Prometheus, Metis, Momus, Multimodal-Looker, Sisyphus-Junior)
│   ├── hooks/                # ~50 lifecycle hooks across 57 dirs
│   ├── tools/                # 16 tool dirs; produces 20–39 tools (config-gated)
│   ├── features/             # 20 feature modules (incl. team-mode, background-agent, skill-mcp-manager, openclaw, etc.)
│   ├── shared/               # 258 utility files; logger → /tmp/oh-my-opencode.log
│   ├── config/               # Zod v4 schema system (32 schema files)
│   ├── cli/                  # CLI: install, run, doctor, mcp-oauth, refresh-model-capabilities, get-local-version
│   ├── mcp/                  # 3 built-in remote MCPs (websearch, context7, grep_app)
│   ├── plugin/               # 10 OpenCode hook handlers + 5-tier hook composition
│   ├── plugin-handlers/      # 6-phase config loading pipeline
│   ├── openclaw/             # Bidirectional external integration (Discord/Telegram/HTTP/shell + reply listener daemon)
│   └── testing/              # Test utilities
├── packages/                 # 11 platform-specific compiled binary packages (darwin/linux/windows, AVX2 + baseline)
├── bin/                      # Platform-detection JS shim (oh-my-opencode + oh-my-openagent)
├── script/                   # Build/publish automation (singular, not scripts/)
├── docs/                     # User-facing docs (guide/, reference/, examples/, legal/, manifesto.md, superpowers/)
├── assets/                   # oh-my-opencode.schema.json (auto-generated from Zod)
├── signatures/               # CLA signature registry (cla.json)
├── postinstall.mjs           # Verifies platform binary + OpenCode version
├── test-setup.ts             # Bun test preload (resets state between tests)
├── bun-test.d.ts             # Custom bun:test type augmentations
├── .sisyphus/                # AI agent workspace (run-continuation/, plans/, tasks/, notepads/)
└── .local-ignore/            # Dev-only test fixtures + PR worktrees
```

## INITIALIZATION FLOW

```
pluginModule.server(input, options)
  ├─→ installAgentSortShim()       # patches Array.prototype.{toSorted,sort} for canonical agent ordering
  ├─→ initConfigContext()          # opencode-vs-openagent layout flag
  ├─→ detectExternalSkillPlugin()  # warn on conflicts
  ├─→ injectServerAuthIntoClient() # auth headers into shared SDK client
  ├─→ loadPluginConfig()           # JSONC parse → user/project merge → Zod validate → migrate
  ├─→ initializeOpenClaw()         # if openclaw config present
  ├─→ checkTeamModeDependencies()  # if team_mode.enabled
  ├─→ createManagers()             # TmuxSessionManager, BackgroundManager, SkillMcpManager, ConfigHandler
  ├─→ createTools()                # SkillContext + AvailableCategories + ToolRegistry
  ├─→ createHooks()                # 5-tier: Session + ToolGuard + Transform + Continuation + Skill
  └─→ createPluginInterface()      # 10 OpenCode hook handlers → PluginInterface
```

## 10 OPENCODE HOOK HANDLERS

| Handler | OpenCode Hook | Purpose |
|---------|---------------|---------|
| `config` | `config` | 6-phase pipeline: provider → plugin-components → agents → tools → MCPs → commands |
| `tool` | `tool` | 20–39 registered tools (config-gated: team-mode +12, task system +4, hashline +1, interactive_bash +1, look_at +1) |
| `chat.message` | `chat.message` | First-message variant, session setup, keyword detection (ultrawork/search/analyze/team) |
| `chat.params` | `chat.params` | Anthropic effort, think mode, runtime fallback override |
| `chat.headers` | `chat.headers` | Copilot `x-initiator` header injection |
| `event` | `event` | Session lifecycle (created/deleted/idle/error), openclaw dispatch, runtime fallback |
| `tool.execute.before` | `tool.execute.before` | Pre-tool guards (write-existing-guard, label-truncator, rules-injector, prometheus-md-only, …) |
| `tool.execute.after` | `tool.execute.after` | Post-tool hooks (output truncator, comment-checker, hashline read-enhancer, json-error-recovery, …) |
| `experimental.chat.messages.transform` | `experimental.chat.messages.transform` | Context injection, thinking-block validation, tool-pair validation, keyword detection |
| `experimental.session.compacting` | `experimental.session.compacting` | Context + todo preservation across compaction |

## TOOL CATALOG (config-gated)

**Always on (20):** `lsp_goto_definition`, `lsp_find_references`, `lsp_symbols`, `lsp_diagnostics`, `lsp_prepare_rename`, `lsp_rename`, `grep`, `glob`, `ast_grep_search`, `ast_grep_replace`, `session_list`, `session_read`, `session_search`, `session_info`, `background_output`, `background_cancel`, `call_omo_agent`, `task` (delegate), `skill`, `skill_mcp`.

**Conditional:** `look_at` (+1, multimodal-looker not disabled), `interactive_bash` (+1, tmux enabled), `task_create`/`task_get`/`task_list`/`task_update` (+4, `experimental.task_system`), `edit` (+1, `hashline_edit`), `team_create`/`team_delete`/`team_shutdown_request`/`team_approve_shutdown`/`team_reject_shutdown`/`team_send_message`/`team_task_create`/`team_task_list`/`team_task_update`/`team_task_get`/`team_status`/`team_list` (+12, `team_mode.enabled`).

## TEAM MODE

OFF by default. Parallel multi-agent coordination, modeled after Claude Code Agent Teams. Enable via `team_mode.enabled` in `.opencode/oh-my-opencode.jsonc` or user config; restart OpenCode after change.

Full schema in [`src/config/schema/team-mode.ts`](file:///Users/yeongyu/local-workspaces/omo/src/config/schema/team-mode.ts) (11 fields):

```jsonc
{
  "team_mode": {
    "enabled": true,
    "tmux_visualization": false,
    "max_parallel_members": 4,            // 1..8
    "max_members": 8,                     // 1..8 hard cap
    "max_messages_per_run": 10000,
    "max_wall_clock_minutes": 120,
    "max_member_turns": 500,
    "base_dir": null,                     // override default ~/.omo/teams or <project>/.omo/teams
    "message_payload_max_bytes": 32768,   // ≥1024
    "recipient_unread_max_bytes": 262144, // ≥1024
    "mailbox_poll_interval_ms": 3000      // ≥500
  }
}
```

Teams live as directories under `~/.omo/teams/{name}/config.json` (user) or `<project>/.omo/teams/{name}/config.json` (project; project beats user on collisions). Members declared as `kind: "subagent_type"` (direct agent) or `kind: "category"` (routed through `sisyphus-junior`).

**Member eligibility** (from [`AGENT_ELIGIBILITY_REGISTRY`](file:///Users/yeongyu/local-workspaces/omo/src/features/team-mode/types.ts)):
- `eligible`: sisyphus, atlas, sisyphus-junior
- `conditional`: hephaestus (lacks `teammate: "allow"` permission by default — apply D-36 in `tool-config-handler.ts` or use `subagent_type: "sisyphus"` instead)
- `hard-reject`: oracle, librarian, explore, multimodal-looker, metis, momus, prometheus (rejected at parse — use `task`/delegate-task)

**Storage layout** (`~/.omo/teams/{name}/`): `config.json` (spec), `state.json` (runtime), `mailbox/` (messages), `tasklist.jsonl` (tasks), `worktrees/` (per-member git worktrees).

**Implementation:** [`src/features/team-mode/`](file:///Users/yeongyu/local-workspaces/omo/src/features/team-mode/AGENTS.md). User docs: [`docs/guide/team-mode.md`](file:///Users/yeongyu/local-workspaces/omo/docs/guide/team-mode.md).

## MULTI-LEVEL CONFIG

```
Walked configs (closer wins): <pwd up to $HOME>/.opencode/oh-my-openagent.json[c]   (legacy: oh-my-opencode.json[c])
                            ↓ merged onto
User config:               ~/.config/opencode/oh-my-openagent.json[c]   (Windows: %APPDATA%\opencode\)
                            ↓ falls back to
Defaults                   (Zod safeParse fills omitted fields)
```

- `agents`, `categories`, `claude_code`: deep merged recursively (prototype-pollution safe)
- `disabled_*` arrays: Set union (concatenated + deduplicated)
- All other fields: override replaces base value
- `mcp_env_allowlist`: **user-only** for security; walked configs cannot extend it
- `migrateConfigFile()` rewrites legacy keys (idempotent via `_migrations` tracking + timestamped backups)

Schema autocomplete: `"$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json"`

## THREE-TIER MCP SYSTEM

| Tier | Source | Loader | Mechanism |
|------|--------|--------|-----------|
| 1. Built-in | `src/mcp/` | `createBuiltinMcps()` | 3 remote HTTP: websearch (Exa/Tavily), context7, grep_app |
| 2. Claude Code | `.mcp.json` (project + user) | `claude-code-mcp-loader` | `${VAR}` env expansion (allowlist via `mcp_env_allowlist`) |
| 3. Skill-embedded | SKILL.md YAML frontmatter | `SkillMcpManager` (per-session) | stdio + HTTP, OAuth 2.0 + PKCE + DCR step-up |

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add new agent | `src/agents/` + `src/agents/builtin-agents/` | `createXXXAgent` factory + `mode: "primary" \| "subagent" \| "all"` |
| Add new hook | `src/hooks/{name}/` + register in `src/plugin/hooks/create-*-hooks.ts` | Pick the right tier (Session/ToolGuard/Transform/Continuation/Skill) |
| Add new tool | `src/tools/{name}/` + register in `src/plugin/tool-registry.ts` | Factory `createXXXTool` (most) or direct `ToolDefinition` (LSP, interactive_bash) |
| Add new feature module | `src/features/{name}/` | Standalone module wired into `plugin/` layer |
| Add new MCP (tier 1) | `src/mcp/` + register in `createBuiltinMcps()` | Remote HTTP only |
| Add new built-in skill | `src/features/builtin-skills/skills/{name}.ts` + register in `skills.ts` | Implement `BuiltinSkill` interface |
| Add new command | `src/features/builtin-commands/` | Templates in `templates/` |
| Add new CLI subcommand | `src/cli/cli-program.ts` | Commander.js subcommand |
| Add new doctor check | `src/cli/doctor/checks/` | Register in `checks/index.ts` |
| Modify config schema | `src/config/schema/` + add to `OhMyOpenCodeConfigSchema` | Zod v4; auto-included in `assets/oh-my-opencode.schema.json` after `bun run build:schema` |
| Add new category | `src/tools/delegate-task/constants.ts` | `DEFAULT_CATEGORIES` + `CATEGORY_MODEL_REQUIREMENTS` |
| Add new team-mode tool | `src/features/team-mode/tools/` + register in `src/plugin/tool-registry.ts` `teamModeToolsRecord` | Gated on `team_mode.enabled` |
| Reactive provider error recovery | `src/hooks/runtime-fallback/` | Distinct from `model-fallback` (proactive, chat.params) |
| External notifications | `src/openclaw/` | Bidirectional: outbound (event → HTTP/shell), inbound (Discord/Telegram daemon → tmux send-keys) |
| Skill-embedded MCP | `src/features/skill-mcp-manager/` | Tier-3 MCPs (per-session, stdio + HTTP) |

## ARCHITECTURE INVARIANTS

- **Canonical agent order:** Sisyphus → Hephaestus → Prometheus → Atlas. Enforced by `installAgentSortShim()` (patches `Array.prototype.toSorted`/`.sort` narrowly when the array contains ≥2 canonical core agents). See [`src/plugin-handlers/AGENTS.md`](file:///Users/yeongyu/local-workspaces/omo/src/plugin-handlers/AGENTS.md) for the full history of why this exists.
- **Hashline edit + read pairing:** Every `Read` tool output is tagged with `LINE#ID` content hashes; `hashline_edit` validates the hash before applying. Stale hash → reject.
- **5-tier hook composition:** Session (24) + ToolGuard (14) + Transform (5) + Continuation (7) + Skill (2) = 52 base. With `team_mode.enabled`: +1 ToolGuard (`team-tool-gating`), +2 Transform (`team-mode-status-injector`, `team-mailbox-injector`), +4 direct event handlers in `src/plugin/event.ts` (`team-session-events/*`) = 59 total. Composed by `createCoreHooks()` + `createContinuationHooks()` + `createSkillHooks()`.
- **Per-session MCP isolation:** Tier-3 MCP clients keyed by `${sessionID}:${skillName}:${serverName}` so the same skill in two sessions does not share state.
- **Two fallback systems:** `model-fallback` (proactive, chat.params) vs `runtime-fallback` (reactive, session.error). They operate independently — no direct integration.
- **OpenClaw bidirectional:** Outbound dispatchers fire on session events; inbound daemon polls Discord/Telegram and `send-keys` replies into the tracked tmux pane.

## CONVENTIONS

- **Runtime:** Bun only (1.3.11 in CI). Never npm/yarn/pnpm.
- **TypeScript:** strict mode, ESNext, bundler moduleResolution, `bun-types` (never `@types/node`).
- **Tests:** Bun test (`bun:test`), co-located `*.test.ts`, given/when/then style — nested `describe` with `#given`/`#when`/`#then` prefixes, or inline `// given` / `// when` / `// then` comments. Never Arrange-Act-Assert comments.
- **CI test split:** `script/run-ci-tests.ts` auto-detects `mock.module()` and isolates those tests in separate processes.
- **Test setup:** `test-setup.ts` preloaded via `bunfig.toml` resets session/cache state between tests.
- **Factory pattern:** `createXXX()` for all tools, hooks, agents.
- **File naming:** kebab-case for files and directories.
- **Module structure:** `index.ts` barrel exports, **no catch-all files** (`utils.ts`, `helpers.ts`, `service.ts` banned), 200 LOC soft limit per file.
- **Imports:** relative within a module, barrel imports across modules (`import { log } from "./shared"`). **No path aliases** — never `@/`.
- **Config format:** JSONC with comments + trailing commas, Zod v4 validation, snake_case keys.
- **Dual package:** `oh-my-opencode` + `oh-my-openagent` published simultaneously during the rename transition.
- **Comments:** AI slop comment patterns blocked by `comment-checker` hook (binary: `@code-yeongyu/comment-checker`). Use `// @allow` to bypass single line, `// comment-checker-disable-file` at file top to bypass file. Sparingly.

## ANTI-PATTERNS (BLOCKING)

- Never `as any`, `@ts-ignore`, `@ts-expect-error`.
- Never suppress lint/type errors.
- Never add emojis to code/comments unless user explicitly asks.
- Never commit unless explicitly requested.
- Never run `bun publish` directly — use the GitHub Actions workflow.
- Never modify `package.json` `version` locally — handled by publish workflow.
- Never write to existing files without reading them first (`write-existing-file-guard`).
- Never use `background_cancel(all=true)` — cancel by `taskId` individually.
- Never delete a failing test to make a build green. Fix the code.
- Never em dashes / en dashes / AI filler ("simply", "obviously", "clearly", "moreover", "furthermore") in generated content.
- Never create catch-all files (`utils.ts`, `helpers.ts`, `service.ts`).
- Never empty catch blocks `catch(e) {}`.
- Never test with Arrange-Act-Assert comments — use given/when/then.
- Never dump business logic into `index.ts` — barrel exports only.
- Prometheus may ONLY edit `.md` files (enforced by `prometheus-md-only` hook); FORBIDDEN paths: `src/`, `package.json`, config files.

## COMMANDS

```bash
bun test                          # Bun test suite (auto-split mock-heavy tests via script/run-ci-tests.ts)
bun run build                     # Build plugin (ESM bundle + .d.ts + cli bundle + schema generation)
bun run build:all                 # Build + 11 platform binaries
bun run build:schema              # Regenerate assets/oh-my-opencode.schema.json
bun run build:model-capabilities  # Refresh shared/model-capabilities cache from models.dev
bun run typecheck                 # tsc --noEmit
bun run clean                     # rm -rf dist
bunx oh-my-opencode install       # Interactive setup wizard
bunx oh-my-opencode doctor        # Health diagnostics (4 categories: System / Config / Tools / Models)
bunx oh-my-opencode run <message> # Non-interactive session (auto-completes when todos done + no bg tasks)
bunx oh-my-opencode mcp-oauth login <server-url>  # Tier-3 MCP OAuth (PKCE + DCR)
```

## CI/CD

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | push/PR to master/dev | Tests (split: mock-heavy isolated + batch), typecheck, build, schema auto-commit |
| `publish.yml` | manual dispatch | Version bump, dual npm publish (`oh-my-opencode` + `oh-my-openagent`), platform binaries, GitHub release |
| `publish-platform.yml` | called by publish.yml | 11 platform binaries via `bun compile` (darwin/linux/windows) |
| `sisyphus-agent.yml` | @mention or manual dispatch | AI agent handles issues/PRs |
| `refresh-model-capabilities.yml` | weekly cron / dispatch | Refresh model capabilities from models.dev API |
| `cla.yml` | issue_comment / PR | CLA assistant for contributors |
| `lint-workflows.yml` | push to .github/ | actionlint + shellcheck on workflow files |

## NOTES

- **Logger:** writes to `/tmp/oh-my-opencode.log` — check there for debugging.
- **Background tasks:** 5 concurrent per `${providerID}/${modelID}` key by default (configurable via `background_task.modelConcurrency` / `providerConcurrency`); FIFO queue when slots full.
- **Plugin load timeout:** 10s for Claude Code plugin discovery.
- **Model fallback:** per-agent chains in `src/shared/model-requirements.ts`. **There is no single global priority.**
- **Two fallback systems:** `model-fallback` (proactive, chat.params, hardcoded chains) vs `runtime-fallback` (reactive, session.error, configurable per-category/agent).
- **Config migration:** idempotent via `_migrations` tracking, atomic writes with timestamped backups.
- **Build:** `bun build` (ESM) + `tsc --emitDeclarationOnly`, externals: `@ast-grep/napi`, `zod`.
- **CI test isolation:** `script/run-ci-tests.ts` auto-isolates files using `mock.module()` (plus `src/openclaw/__tests__/reply-listener-discord.test.ts`) — they run in separate processes.
- **120 barrel `index.ts` files** establish module boundaries.
- **Architecture rules** enforced via `.sisyphus/rules/modular-code-enforcement.md` (when present in workspace).
- **Windows builds:** run on `windows-latest` (not cross-compiled) to avoid Bun segfaults.
- **Platform binaries:** detect AVX2 + libc family at runtime, fallback to baseline if needed.
- **IntentGate (`keyword-detector`):** classifies user intent (`ultrawork`/`ulw`, `search`, `analyze`, `team`) and injects mode-specific prompts.
- **Hashline edit:** every `Read` output tagged with `LINE#ID` content hashes (chars from `ZPMQVRWSNKTXJBYH`); edits reject on hash mismatch.
- **Docs:** see [`docs/guide/`](file:///Users/yeongyu/local-workspaces/omo/docs/guide/) for user-facing guides (overview, installation, orchestration, agent-model-matching, team-mode), [`docs/reference/`](file:///Users/yeongyu/local-workspaces/omo/docs/reference/) for CLI/configuration/features reference.
