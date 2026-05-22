import type { CommandDefinition } from "../claude-code-command-loader"
import type { BuiltinCommandName, BuiltinCommands } from "./types"
import { INIT_DEEP_TEMPLATE } from "./templates/init-deep"
import { MATRIX_LOOP_TEMPLATE, CANCEL_LOOP_TEMPLATE } from "./templates/matrix-loop"
import { STOP_CONTINUATION_TEMPLATE } from "./templates/stop-continuation"
import { REFACTOR_TEMPLATE } from "./templates/refactor"
import { START_WORK_TEMPLATE } from "./templates/start-work"
import { HANDOFF_TEMPLATE } from "./templates/handoff"
import { PICKUP_TEMPLATE } from "./templates/pickup"
import { REMOVE_DEADCODE_TEMPLATE } from "./templates/remove-deadcode"
import { PROFILE_TEMPLATE } from "./templates/profile"

const BUILTIN_COMMAND_DEFINITIONS: Record<BuiltinCommandName, Omit<CommandDefinition, "name">> = {
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
   "matrix-loop": {
     description: "(builtin) Start self-referential development loop until completion",
     template: `<command-instruction>
${MATRIX_LOOP_TEMPLATE}
</command-instruction>

<user-task>
$ARGUMENTS
</user-task>`,
     argumentHint: '"task description" [--completion-promise=TEXT] [--max-iterations=N]',
   },
   "ulw-loop": {
     description: "(builtin) Start ultrawork loop - continues until completion with ultrawork mode",
     template: `<command-instruction>
${MATRIX_LOOP_TEMPLATE}
</command-instruction>

<user-task>
$ARGUMENTS
</user-task>`,
     argumentHint: '"task description" [--completion-promise=TEXT] [--max-iterations=N]',
   },
  "cancel-loop": {
    description: "(builtin) Cancel active Matrix Loop",
    template: `<command-instruction>
${CANCEL_LOOP_TEMPLATE}
</command-instruction>`,
  },
  refactor: {
    description:
      "(builtin) Intelligent refactoring command with LSP, AST-grep, architecture analysis, codemap, and TDD verification.",
    template: `<command-instruction>
${REFACTOR_TEMPLATE}
</command-instruction>`,
    argumentHint: "<refactoring-target> [--scope=<file|module|project>] [--strategy=<safe|aggressive>]",
  },
  "start-work": {
    description: "(builtin) Start Morpheus work session from Oracle plan",
    agent: "architect",
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
    description: "(builtin) Stop all continuation mechanisms (matrix loop, todo continuation, mission) for this session",
    template: `<command-instruction>
${STOP_CONTINUATION_TEMPLATE}
</command-instruction>`,
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
  pickup: {
    description: "(builtin) Load handoff context from a previous session",
    template: `<command-instruction>
${PICKUP_TEMPLATE}
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`,
    argumentHint: "[task to continue with]",
  },
  "remove-deadcode": {
    description: "(builtin) Find and remove dead code (zero-reference symbols) using LSP analysis",
    template: `<command-instruction>
${REMOVE_DEADCODE_TEMPLATE}
</command-instruction>`,
    argumentHint: "[target-path] [--scope=<file|module|project>] [--dry-run]",
  },
  profile: {
    description: "(builtin) View or change the active Matrixx profile (free/budget/economy/balanced/performance/go)",
    template: `<command-instruction>
${PROFILE_TEMPLATE}
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`,
    argumentHint: "[list|show|set <name> [--global|--project]]",
  },
}

export function loadBuiltinCommands(
  disabledCommands?: BuiltinCommandName[]
): BuiltinCommands {
  const disabled = new Set(disabledCommands ?? [])
  const commands: BuiltinCommands = {}

  for (const [name, definition] of Object.entries(BUILTIN_COMMAND_DEFINITIONS)) {
    if (!disabled.has(name as BuiltinCommandName)) {
      const { argumentHint: _argumentHint, ...openCodeCompatible } = definition
      commands[name] = { ...openCodeCompatible, name } as CommandDefinition
    }
  }

  return commands
}
