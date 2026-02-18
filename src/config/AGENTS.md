# src/config/ — Zod v4 Schema System

**Generated:** 2026-02-17

## OVERVIEW

22 schema files composing `OhMyOpenCodeConfigSchema`. Zod v4 validation with `safeParse()`. All fields optional — omitted fields use plugin defaults.

## SCHEMA TREE

```
config/schema/
├── oh-my-opencode-config.ts    # ROOT: OhMyOpenCodeConfigSchema (composes all below)
├── agent-names.ts              # BuiltinAgentNameSchema (11), OverridableAgentNameSchema (14)
├── agent-overrides.ts          # AgentOverrideConfigSchema (21 fields per agent)
├── categories.ts               # 8 built-in + custom categories
├── hooks.ts                    # HookNameSchema (46 hooks)
├── skills.ts                   # SkillsConfigSchema (sources, paths, recursive)
├── commands.ts                 # BuiltinCommandNameSchema
├── experimental.ts             # Feature flags (plugin_load_timeout_ms min 1000, hashline_edit)
├── sisyphus.ts                 # SisyphusConfigSchema (task system)
├── sisyphus-agent.ts           # SisyphusAgentConfigSchema
├── ralph-loop.ts               # RalphLoopConfigSchema
├── tmux.ts                     # TmuxConfigSchema + TmuxLayoutSchema
├── websearch.ts                # provider: "exa" | "tavily"
├── claude-code.ts              # CC compatibility settings
├── comment-checker.ts          # AI comment detection config
├── notification.ts             # OS notification settings
├── git-master.ts               # commit_footer: boolean | string
├── browser-automation.ts       # provider: playwright | agent-browser | playwright-cli
├── background-task.ts          # Concurrency limits per model/provider
├── babysitting.ts              # Unstable agent monitoring
├── dynamic-context-pruning.ts  # Context pruning settings
└── internal/permission.ts      # AgentPermissionSchema
```

## ROOT SCHEMA FIELDS (26)

`$schema`, `new_task_system_enabled`, `default_run_agent`, `disabled_mcps`, `disabled_agents`, `disabled_skills`, `disabled_hooks`, `disabled_commands`, `disabled_tools`, `agents`, `categories`, `claude_code`, `sisyphus_agent`, `comment_checker`, `experimental`, `auto_update`, `skills`, `ralph_loop`, `background_task`, `notification`, `babysitting`, `git_master`, `browser_automation_engine`, `websearch`, `tmux`, `sisyphus`, `_migrations`

## AGENT OVERRIDE FIELDS (21)

`model`, `variant`, `category`, `skills`, `temperature`, `top_p`, `prompt`, `prompt_append`, `tools`, `disable`, `description`, `mode`, `color`, `permission`, `maxTokens`, `thinking`, `reasoningEffort`, `textVerbosity`, `providerOptions`

## HOW TO ADD CONFIG

1. Create `src/config/schema/{name}.ts` with Zod schema
2. Add field to `oh-my-opencode-config.ts` root schema
3. Reference via `z.infer<typeof YourSchema>` for TypeScript types
4. Access in handlers via `pluginConfig.{name}`
