import type { CommandDefinition } from "../claude-code-command-loader"
import { isAgentRegistered } from "../claude-code-session-state"
import type { BuiltinCommandName, BuiltinCommands } from "./types"
import { INIT_DEEP_TEMPLATE } from "./templates/init-deep"
import { RALPH_LOOP_TEMPLATE, ULW_LOOP_TEMPLATE, CANCEL_RALPH_TEMPLATE } from "./templates/ralph-loop"
import { STOP_CONTINUATION_TEMPLATE } from "./templates/stop-continuation"
import { REFACTOR_TEMPLATE, REFACTOR_TEAM_MODE_ADDENDUM } from "./templates/refactor"
import { START_WORK_TEMPLATE } from "./templates/start-work"
import { HANDOFF_TEMPLATE } from "./templates/handoff"
import { REMOVE_AI_SLOPS_TEMPLATE, REMOVE_AI_SLOPS_TEAM_MODE_ADDENDUM } from "./templates/remove-ai-slops"
import { HYPERPLAN_TEMPLATE } from "./templates/hyperplan"
import { RELOAD_CONFIG_TEMPLATE } from "./templates/reload-config"
import { CONFIG_GET_TEMPLATE } from "./templates/config-get"
import { CONFIG_SET_TEMPLATE } from "./templates/config-set"
interface LoadBuiltinCommandsOptions {
  useRegisteredAgents?: boolean
  teamModeEnabled?: boolean
}

function resolveStartWorkAgent(options?: LoadBuiltinCommandsOptions): "atlas" | "sisyphus" {
  if (options?.useRegisteredAgents) {
    return isAgentRegistered("atlas") ? "atlas" : "sisyphus"
  }

  return "atlas"
}

function withTeamModeAddendum(baseTemplate: string, addendum: string, teamModeEnabled: boolean): string {
  return teamModeEnabled ? `${baseTemplate}\n${addendum}` : baseTemplate
}

function createBuiltinCommandDefinitions(
  options?: LoadBuiltinCommandsOptions,
): Record<BuiltinCommandName, Omit<CommandDefinition, "name">> {
  const teamModeEnabled = options?.teamModeEnabled ?? false
  const refactorContent = withTeamModeAddendum(REFACTOR_TEMPLATE, REFACTOR_TEAM_MODE_ADDENDUM, teamModeEnabled)
  const removeAiSlopsContent = withTeamModeAddendum(
    REMOVE_AI_SLOPS_TEMPLATE,
    REMOVE_AI_SLOPS_TEAM_MODE_ADDENDUM,
    teamModeEnabled,
  )

  return {
    "init-deep": {
      description: "(builtin) Initialize hierarchical AGENTS.md knowledge base",
      template: `<command-instruction>
${INIT_DEEP_TEMPLATE}
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`,
      argumentHint: "[--create-new] [--max-depth=N]",
    },
     "ralph-loop": {
       description: "(builtin) Start self-referential development loop until completion",
       template: `<command-instruction>
${RALPH_LOOP_TEMPLATE}
</command-instruction>

<user-task>
$ARGUMENTS
</user-task>`,
       argumentHint: '"task description" [--completion-promise=TEXT] [--max-iterations=N] [--strategy=reset|continue]',
     },
     "ulw-loop": {
        description: "(builtin) Start ultrawork loop - continues until completion with ultrawork mode",
        template: `<command-instruction>
${ULW_LOOP_TEMPLATE}
</command-instruction>

<user-task>
$ARGUMENTS
</user-task>`,
        argumentHint: '"task description" [--completion-promise=TEXT] [--strategy=reset|continue]',
      },
    "cancel-ralph": {
      description: "(builtin) Cancel active Ralph Loop",
      template: `<command-instruction>
${CANCEL_RALPH_TEMPLATE}
</command-instruction>`,
    },
    refactor: {
      description:
        "(builtin) Intelligent refactoring command with LSP, AST-grep, architecture analysis, codemap, and TDD verification.",
      template: `<command-instruction>
${refactorContent}
</command-instruction>`,
      argumentHint: "<refactoring-target> [--scope=<file|module|project>] [--strategy=<safe|aggressive>]",
    },
    "start-work": {
      description: "(builtin) Start Sisyphus work session from Prometheus plan",
      agent: resolveStartWorkAgent(options),
      template: `<command-instruction>
${START_WORK_TEMPLATE}
</command-instruction>

<session-context>
Session ID: $SESSION_ID
Timestamp: $TIMESTAMP
</session-context>

<user-request>
$ARGUMENTS
</user-request>`,
      argumentHint: "[plan-name]",
    },
    "stop-continuation": {
      description: "(builtin) Stop all continuation mechanisms (ralph loop, todo continuation, boulder) for this session",
      template: `<command-instruction>
${STOP_CONTINUATION_TEMPLATE}
</command-instruction>`,
    },
    "remove-ai-slops": {
      description: "(builtin) Remove AI-generated code smells from branch changes and critically review the results",
      template: `<command-instruction>
${removeAiSlopsContent}
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`,
    },
    handoff: {
      description: "(builtin) Create a detailed context summary for continuing work in a new session",
      template: `<command-instruction>
${HANDOFF_TEMPLATE}
</command-instruction>

<session-context>
Session ID: $SESSION_ID
Timestamp: $TIMESTAMP
</session-context>

<user-request>
$ARGUMENTS
</user-request>`,
      argumentHint: "[goal]",
    },
    hyperplan: {
      description: "(builtin) Adversarial multi-agent planning via team-mode (5 hostile category members cross-critique, lead synthesizes)",
      template: `<command-instruction>
${HYPERPLAN_TEMPLATE}
</command-instruction>`,
      argumentHint: "[planning-request]",
    },
    "config-get": {
      description: "(builtin) Get a configuration value from the plugin config",
      template: `<command-instruction>
${CONFIG_GET_TEMPLATE}
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`,
      argumentHint: "<dot.separated.path>",
    },
    "config-set": {
      description: "(builtin) Set a configuration value in the plugin config at runtime",
      template: `<command-instruction>
${CONFIG_SET_TEMPLATE}
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`,
      argumentHint: "<dot.separated.path> <value>",
    },
    "create-skill": {
      description: "(builtin) Create a new AI agent skill following the Agent Skills spec. Usage: /create-skill <name> [description]",
      template: `<command-instruction>
Create a new skill at .agents/skills/{name}/SKILL.md with the standard Agent Skills template.

The skill name must use kebab-case and should describe the domain or task.

Steps:
1. Validate the skill name (kebab-case, no spaces)
2. Create .agents/skills/{name}/ directory
3. Generate SKILL.md from the standard template
4. Register in .atl/skill-registry.md
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`,
      argumentHint: "<skill-name> [description]",
    },
    "update-skill-registry": {
      description: "(builtin) Scan all skill directories and rebuild .atl/skill-registry.md with compact rules",
      template: `<command-instruction>
Scan all skill directories and rebuild the skill registry at .atl/skill-registry.md.

Scan directories:
- .agents/skills/
- .opencode/skills/
- ~/.config/opencode/skills/
- ~/.claude/skills/

For each skill found:
- Extract name from frontmatter
- Extract trigger words from description
- Generate compact rules (5-15 lines) from Critical Patterns section
- Write to .atl/skill-registry.md
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`,
      argumentHint: "",
    },
  }
}

export function loadBuiltinCommands(
  disabledCommands?: BuiltinCommandName[],
  options?: LoadBuiltinCommandsOptions,
): BuiltinCommands {
  const builtinCommandDefinitions = createBuiltinCommandDefinitions(options)
  const disabled = new Set(disabledCommands ?? [])
  const commands: BuiltinCommands = {}

  for (const [name, definition] of Object.entries(builtinCommandDefinitions)) {
    if (!disabled.has(name as BuiltinCommandName)) {
      const { argumentHint: _argumentHint, ...openCodeCompatible } = definition
      commands[name] = { ...openCodeCompatible, name } as CommandDefinition
    }
  }

  return commands
}
