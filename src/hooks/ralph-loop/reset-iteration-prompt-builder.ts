import type { RalphLoopState } from "./types"
import { RALPH_LOOP_TEMPLATE } from "../../features/builtin-commands/templates/ralph-loop"

function quoteCommandValue(value: string): string {
  const escapedValue = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')

  return `"${escapedValue}"`
}

function buildLoopCommandArguments(state: RalphLoopState): string {
  const flags = [
    `--completion-promise=${quoteCommandValue(state.completion_promise)}`,
    `--max-iterations=${state.max_iterations}`,
    `--strategy=${state.strategy ?? "continue"}`,
  ]

  return `${state.prompt}
${flags.join(" ")}`
}

export function buildResetIterationPrompt(state: RalphLoopState): string {
  const commandBody = `[RALPH LOOP - Iteration ${state.iteration}/${state.max_iterations}]

<command-instruction>
${RALPH_LOOP_TEMPLATE}
</command-instruction>

<user-task>
${buildLoopCommandArguments(state)}
</user-task>`

  return state.ultrawork ? `ultrawork ${commandBody}` : commandBody
}
