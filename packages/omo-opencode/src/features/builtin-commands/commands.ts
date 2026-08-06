import type { CommandDefinition } from "../claude-code-command-loader"
import { isAgentRegistered } from "../claude-code-session-state"
import type { BuiltinCommandName, BuiltinCommands } from "./types"
import { GOAL_TEMPLATE } from "./templates/goal"
import { STOP_CONTINUATION_TEMPLATE } from "./templates/stop-continuation"
import { REFACTOR_TEMPLATE, REFACTOR_TEAM_MODE_ADDENDUM } from "./templates/refactor"
import { START_WORK_TEMPLATE } from "./templates/start-work"
import { HANDOFF_TEMPLATE } from "./templates/handoff"
import { REMOVE_AI_SLOPS_TEMPLATE, REMOVE_AI_SLOPS_TEAM_MODE_ADDENDUM } from "./templates/remove-ai-slops"
import { HYPERPLAN_TEMPLATE } from "./templates/hyperplan"

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
    goal: {
      description: "(builtin) Set, show, pause, resume, or clear the active thread goal",
      template: `<command-instruction>
${GOAL_TEMPLATE}
</command-instruction>

<user-task>
$ARGUMENTS
</user-task>`,
      argumentHint: "<objective> | pause | resume | clear",
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
      description: "(builtin) Start Atlas work session from Prometheus plan",
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
      argumentHint: "[plan-name] [--worktree <path>] [--make-pr] [--ship]",
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
