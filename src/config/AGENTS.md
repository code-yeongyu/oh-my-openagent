# CONFIG KNOWLEDGE BASE

## OVERVIEW

Zod schema definitions for plugin configuration. Schema component files composing `MatrixxConfigSchema` with multi-level inheritance and JSONC support.

## STRUCTURE
```
config/
├── schema/                    # schema component files
│   ├── matrixx-config.ts         # Root schema composition (57 lines)
│   ├── agent-names.ts         # BuiltinAgentNameSchema (13 agents), BuiltinSkillNameSchema
│   ├── agent-overrides.ts     # AgentOverrideConfigSchema (model, variant, temp, thinking...)
│   ├── categories.ts          # 8 categories: construct, source, deep-jack, matrix-bend, bullet-time, ...
│   ├── hooks.ts               # HookNameSchema (100+ hook names)
│   ├── commands.ts            # BuiltinCommandNameSchema
│   ├── experimental.ts        # ExperimentalConfigSchema
│   ├── background-task.ts     # BackgroundTaskConfigSchema
│   ├── claude-code.ts         # ClaudeCodeConfigSchema
│   ├── comment-checker.ts     # CommentCheckerConfigSchema
│   ├── notification.ts        # NotificationConfigSchema
│   ├── matrix-loop.ts          # MatrixLoopConfigSchema
│   ├── morpheus.ts            # MorpheusConfigSchema
│   ├── morpheus-agent.ts      # MorpheusAgentConfigSchema
│   ├── skills.ts              # SkillsConfigSchema (45 lines)
│   ├── tmux.ts                # TmuxConfigSchema, TmuxLayoutSchema
│   ├── websearch.ts           # WebsearchConfigSchema
│   ├── browser-automation.ts  # BrowserAutomationConfigSchema
│   ├── git-master.ts          # GitMasterConfigSchema
│   └── babysitting.ts         # BabysittingConfigSchema
├── schema.ts                  # Barrel export (24 lines)
├── schema.test.ts             # Validation tests (735 lines)
├── types.ts                   # TypeScript types from schemas
└── index.ts                   # Barrel export (33 lines)
```

## ROOT SCHEMA

`MatrixxConfigSchema` composes: `$schema`, `new_task_system_enabled`, `default_run_agent`, `auto_update`, `disabled_{mcps,agents,skills,hooks,commands,tools}`, `agents` (14 agent keys), `categories` (8 built-in), `claude_code`, `morpheus_agent`, `comment_checker`, `experimental`, `skills`, `matrix_loop`, `background_task`, `notification`, `babysitting`, `git_master`, `browser_automation_engine`, `websearch`, `tmux`, `morpheus`

## CONFIGURATION HIERARCHY

Project (`.opencode/matrixx.json`) → User (`~/.config/opencode/matrixx.json`) → Defaults

## AGENT OVERRIDE FIELDS

`model`, `variant`, `category`, `skills`, `temperature`, `top_p`, `maxTokens`, `thinking`, `reasoningEffort`, `textVerbosity`, `prompt`, `prompt_append`, `tools`, `permission`, `providerOptions`, `disable`, `description`, `mode`, `color`

## AFTER SCHEMA CHANGES

Run `bun run build:schema` to regenerate `dist/matrixx.schema.json`
