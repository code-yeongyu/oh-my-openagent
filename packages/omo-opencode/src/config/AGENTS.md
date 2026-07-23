# src/config/ - Zod v4 Schema System

**Generated:** 2026-07-17 (7d664b96b)

## OVERVIEW

36 non-test schema files composing `OhMyOpenCodeConfigSchema` (plus `schema/internal/permission.ts` for shared internal helpers). Zod v4 validation with `safeParse()`. All fields optional; omitted fields use defaults from the schema. Auto-emitted to `assets/oh-my-opencode.schema.json` via `bun run build:schema`.

## SCHEMA TREE

```
config/schema/
├── oh-my-opencode-config.ts    # ROOT: composes all sub-schemas
├── agent-names.ts              # BuiltinAgentNameSchema enum (11 names: sisyphus, hephaestus, prometheus, oracle, librarian, explore, multimodal-looker, metis, momus, atlas, sisyphus-junior)
├── agent-overrides.ts          # AgentOverrideConfigSchema (23 fields per agent, including spawn limits)
├── agent-definitions.ts        # custom agent definition schema
├── categories.ts               # 8 built-in + custom categories
├── hooks.ts                    # HookNameSchema (56 enum values; `team-tool-gating` is the only team-* one in schema; others are wired by direct config gates)
├── skills.ts                   # SkillsConfigSchema (sources, paths, recursive)
├── commands.ts                 # BuiltinCommandNameSchema (goal, refactor, start-work, stop-continuation, remove-ai-slops, hyperplan)
├── experimental.ts             # Feature flags incl plugin_load_timeout_ms (min 1000), task_system, max_tools
├── sisyphus.ts                 # SisyphusConfigSchema (task system)
├── sisyphus-agent.ts           # SisyphusAgentConfigSchema
├── goal.ts                     # GoalConfigSchema (enabled, auto_start, default_max_iterations) - replaces ralph_loop
├── ralph-loop.ts               # RalphLoopConfigSchema (DEPRECATED: parsed loose at root, migrated to goal in validate.ts)
├── tmux.ts                     # TmuxConfigSchema + TmuxLayoutSchema
├── websearch.ts                # provider: "exa" | "tavily"
├── claude-code.ts              # CC compatibility settings (plugins, plugins_override)
├── comment-checker.ts          # AI comment detection config
├── notification.ts             # OS notification settings
├── git-master.ts               # commit_footer: boolean | string
├── git-env-prefix.ts           # Git environment prefix config
├── browser-automation.ts       # provider: playwright | agent-browser | dev-browser | playwright-cli; playwright_mcp_args (user-config only)
├── background-task.ts          # Concurrency limits per model/provider, syncPollTimeoutMs
├── fallback-models.ts          # FallbackModelsConfigSchema
├── runtime-fallback.ts         # RuntimeFallbackConfigSchema (reactive provider fallback)
├── babysitting.ts              # Unstable agent monitoring
├── dynamic-context-pruning.ts  # Context pruning settings
├── start-work.ts               # StartWorkConfigSchema (auto_commit)
├── openclaw.ts                 # OpenClaw integration settings
├── model-capabilities.ts       # Model capabilities config
├── keyword-detector.ts         # disabled_keywords (ultrawork|search|analyze|team)
├── default-mode.ts             # DefaultModeConfigSchema (auto-inject ultrawork / auto-create goal on session start)
├── i18n.ts                     # I18nConfigSchema (locale override; falls back to LANG env var)
├── codegraph.ts                # CodegraphConfigSchema (auto_init, auto_provision, enabled, telemetry, watch_debounce_ms)
├── monitor.ts                  # MonitorConfigSchema (live_mode_enabled, allowed_commands, batch/ring limits, flush_interval_ms)
├── tui.ts                      # TuiConfigSchema + TuiSidebarConfigSchema (sidebar.enabled)
└── team-mode.ts                # TeamModeConfigSchema (enabled, max_parallel_members, max_members, tmux_visualization)
```

## ROOT SCHEMA FIELDS

`$schema`, `new_task_system_enabled`, `default_run_agent`, `agent_order`, `agent_definitions`, `disabled_mcps`, `disabled_agents`, `disabled_skills`, `disabled_hooks`, `disabled_commands`, `disabled_tools`, `disabled_providers`, `mcp_env_allowlist`, `hashline_edit`, `telemetry`, `model_fallback`, `agents`, `categories`, `claude_code`, `sisyphus_agent`, `comment_checker`, `experimental`, `auto_update`, `skills`, **`goal`** (new; replaces `ralph_loop`), `ralph_loop` (deprecated; migrated to `goal` in `validate.ts`), `runtime_fallback`, `background_task`, `notification`, `model_capabilities`, `openclaw`, `i18n`, `monitor`, `codegraph`, **`team_mode`**, `keyword_detector`, `babysitting`, `git_master`, `browser_automation_engine`, `websearch`, `tmux`, `tui`, `sisyphus`, `start_work`, `default_mode`, `_migrations`.

## RALPH_LOOP -> GOAL MIGRATION

`goal` replaces the deprecated `ralph_loop` subsystem. `validate.ts` `migrateRalphLoopConfig()` maps legacy `ralph_loop.{enabled, default_max_iterations}` to `goal.{enabled, auto_start, default_max_iterations}` (`auto_start` defaults `false`, `default_max_iterations` defaults `100`); explicit `goal` config wins over migrated values. The root `ralph_loop` key is parsed loose (`z.record`) only for migration and logs a deprecation warning; `RalphLoopConfigSchema` still ships but is no longer composed into the root. `default_mode.ralph_loop` became `default_mode.goal` (auto-create a goal from the first main-session message). The `ralph-loop` hook and the `ralph-loop` / `ulw-loop` / `cancel-ralph` commands were removed; the `goal` hook and `goal` command replace them.

## TEAM_MODE SCHEMA (11 fields)

```jsonc
{
  "team_mode": {
    "enabled": false,                       // gate for 12 team_* tools and conditional hooks
    "tmux_visualization": false,            // render tmux pane layout for the team
    "max_parallel_members": 4,              // 1..8 concurrent active members
    "max_members": 8,                       // 1..8 hard cap on team size
    "max_messages_per_run": 10000,          // ≥1
    "max_wall_clock_minutes": 120,          // ≥1
    "max_member_turns": 500,                // ≥1
    "base_dir": null,                       // override of ~/.omo/teams or <project>/.omo/teams
    "message_payload_max_bytes": 32768,     // ≥1024
    "recipient_unread_max_bytes": 262144,   // ≥1024
    "mailbox_poll_interval_ms": 3000        // ≥500
  }
}
```

When `enabled: true`:
- 12 `team_*` tools register (`tool-registry.ts` `teamModeToolsRecord`)
- 3 team-mode hooks register conditionally: `team-mode-status-injector` + `team-mailbox-injector` (Transform tier) and `team-tool-gating` (Tool Guard tier)
- 4 team-session-event handlers register in `src/plugin/event.ts`: `team-idle-wake-hint`, `team-lead-orphan-handler`, `team-member-error-handler`, `team-member-status-handler`
- `team-mode` built-in skill loads
- Doctor check `cli/doctor/checks/team-mode.ts` runs

## AGENT OVERRIDE FIELDS (per-agent)

`model`, `variant`, `category`, `skills`, `temperature`, `top_p`, `prompt`, `prompt_append`, `tools`, `disable`, `description`, `mode`, `color`, `permission`, `maxTokens`, `thinking`, `reasoningEffort`, `textVerbosity`, `providerOptions`, `fallback_models`, `ultrawork`, `maxDepth`, `allowedSubagents`.

## HOW TO ADD A CONFIG FIELD

1. Create `src/config/schema/{name}.ts` with Zod schema
2. Add field to `oh-my-opencode-config.ts` root schema
3. Reference via `z.infer<typeof YourSchema>` for the TypeScript type
4. Access in handlers via `pluginConfig.{field_name}` (snake_case JSON, snake_case TS field)
5. Run `bun run build:schema` to regenerate `assets/oh-my-opencode.schema.json`
