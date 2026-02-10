# CONFIG KNOWLEDGE BASE

## OVERVIEW

Zod schema definitions for plugin configuration. 21 component files composing `OhMyOpenCodeConfigSchema` with multi-level inheritance and JSONC support.

## STRUCTURE
```
config/
├── schema/                    # 21 schema component files
│   ├── oh-my-opencode-config.ts # Root schema composition (57 lines)
│   ├── agent-names.ts         # BuiltinAgentNameSchema (11 agents), BuiltinSkillNameSchema
│   ├── agent-overrides.ts     # AgentOverrideConfigSchema (model, variant, temp, thinking...)
│   ├── categories.ts          # 8 categories: visual-engineering, ultrabrain, deep, artistry, quick, ...
│   ├── hooks.ts               # HookNameSchema (100+ hook names)
│   ├── commands.ts            # BuiltinCommandNameSchema
│   ├── experimental.ts        # ExperimentalConfigSchema
│   ├── dynamic-context-pruning.ts # DynamicContextPruningConfigSchema (55 lines)
│   ├── background-task.ts     # BackgroundTaskConfigSchema
│   ├── claude-code.ts         # ClaudeCodeConfigSchema
│   ├── comment-checker.ts     # CommentCheckerConfigSchema
│   ├── notification.ts        # NotificationConfigSchema
│   ├── ralph-loop.ts          # RalphLoopConfigSchema
│   ├── sisyphus.ts            # SisyphusConfigSchema
│   ├── sisyphus-agent.ts      # SisyphusAgentConfigSchema
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

`OhMyOpenCodeConfigSchema` composes: `$schema`, `new_task_system_enabled`, `default_run_agent`, `auto_update`, `disabled_{mcps,agents,skills,hooks,commands,tools}`, `agents` (14 agent keys), `categories` (8 built-in), `claude_code`, `sisyphus_agent`, `comment_checker`, `experimental`, `skills`, `ralph_loop`, `background_task`, `notification`, `babysitting`, `git_master`, `browser_automation_engine`, `websearch`, `tmux`, `sisyphus`

## CONFIGURATION HIERARCHY

Project (`.opencode/oh-my-opencode.json`) → User (`~/.config/opencode/oh-my-opencode.json`) → Defaults

## AGENT OVERRIDE FIELDS

`model`, `variant`, `category`, `skills`, `temperature`, `top_p`, `maxTokens`, `thinking`, `reasoningEffort`, `textVerbosity`, `prompt`, `prompt_append`, `tools`, `permission`, `providerOptions`, `disable`, `description`, `mode`, `color`

## AFTER SCHEMA CHANGES

Run `bun run build:schema` to regenerate `dist/oh-my-opencode.schema.json`
