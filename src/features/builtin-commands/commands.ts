import type { CommandDefinition } from "../claude-code-command-loader"
import type { BuiltinCommandName, BuiltinCommands } from "./types"
import { INIT_DEEP_TEMPLATE } from "./templates/init-deep"
import { RALPH_LOOP_TEMPLATE, CANCEL_RALPH_TEMPLATE } from "./templates/ralph-loop"
import { REFACTOR_TEMPLATE } from "./templates/refactor"
import { START_WORK_TEMPLATE } from "./templates/start-work"
import { STATUS_TEMPLATE } from "./templates/status"
import { REVERT_TEMPLATE } from "./templates/revert"
import { EVOLVE_TEMPLATE } from "./templates/evolve"
import { INSTINCT_IMPORT_TEMPLATE } from "./templates/instinct-import"
import { INSTINCT_EXPORT_TEMPLATE } from "./templates/instinct-export"
import { INSTINCT_STATUS_TEMPLATE } from "./templates/instinct-status"
import { BUILD_FIX_TEMPLATE } from "./templates/build-fix"
import { LEARN_TEMPLATE } from "./templates/learn"

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
   "ralph-loop": {
     description: "(builtin) Start self-referential development loop until completion",
     template: `<command-instruction>
${RALPH_LOOP_TEMPLATE}
</command-instruction>

<user-task>
$ARGUMENTS
</user-task>`,
     argumentHint: '"task description" [--completion-promise=TEXT] [--max-iterations=N]',
   },
   "ulw-loop": {
     description: "(builtin) Start ultrawork loop - continues until completion with ultrawork mode",
     template: `<command-instruction>
${RALPH_LOOP_TEMPLATE}
</command-instruction>

<user-task>
$ARGUMENTS
</user-task>`,
     argumentHint: '"task description" [--completion-promise=TEXT] [--max-iterations=N]',
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
${REFACTOR_TEMPLATE}
</command-instruction>`,
    argumentHint: "<refactoring-target> [--scope=<file|module|project>] [--strategy=<safe|aggressive>]",
  },
  "start-work": {
    description: "(builtin) Start Sisyphus work session from Prometheus plan",
    agent: "atlas",
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
  status: {
    description: "(builtin) Display current change execution status",
    template: `<command-instruction>
${STATUS_TEMPLATE}
</command-instruction>`,
  },
  revert: {
    description: "(builtin) Revert to a previous checkpoint",
    template: `<command-instruction>
${REVERT_TEMPLATE}
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`,
    argumentHint: "[task <id>] [phase <n>] [change]",
  },
  "instinct-import": {
    description: "(builtin) Import instincts from external sources",
    template: `<command-instruction>
${INSTINCT_IMPORT_TEMPLATE}
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`,
    argumentHint: "<source> [--filter <pattern>]",
  },
  "instinct-export": {
    description: "(builtin) Export instincts for sharing or backup",
    template: `<command-instruction>
${INSTINCT_EXPORT_TEMPLATE}
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`,
    argumentHint: "[--filter <pattern>] [--output <path>]",
  },
  evolve: {
    description: "(builtin) Analyze and cluster related instincts into evolved structures",
    template: `<command-instruction>
${EVOLVE_TEMPLATE}
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`,
    argumentHint: "[--execute] [--dry-run] [--domain <name>] [--threshold <n>] [--type <command|skill|agent>]",
  },
  "instinct-status": {
    description: "(builtin) Display status report of all instincts",
    template: `<command-instruction>
${INSTINCT_STATUS_TEMPLATE}
</command-instruction>`,
    argumentHint: "[--sort usage|confidence] [--domain <name>]",
  },
  "build-fix": {
    description: "(builtin) Incrementally fix TypeScript build errors",
    template: `<command-instruction>
${BUILD_FIX_TEMPLATE}
</command-instruction>`,
    argumentHint: "[--max-iterations N] [--file <path>]",
  },
  learn: {
    description: "(builtin) Extract patterns from current session and create reusable skills",
    template: `<command-instruction>
${LEARN_TEMPLATE}
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`,
    argumentHint: '[--pattern "TDD"] [--threshold 0.8]',
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
