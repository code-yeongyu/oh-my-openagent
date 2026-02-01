import { SYSTEM_DIRECTIVE_PREFIX } from "../../shared/system-directive"
import { RALPH_LOOP_TEMPLATE } from "../../features/builtin-commands/templates/ralph-loop"
import type { RalphLoopState } from "./types"
import { DEFAULT_STRATEGY } from "./constants"

const CONTINUE_STRATEGY_PROMPT = `Your previous attempt did not output the completion promise. Continue working on the task.

IMPORTANT:
- Review your progress so far
- Continue from where you left off
- When FULLY complete, output: <promise>{{PROMISE}}</promise>
- Do not stop until the task is truly done

Original task:
{{PROMPT}}`

function getResetStrategyPrompt(prompt: string): string {
	return `<command-instruction>
${RALPH_LOOP_TEMPLATE}
</command-instruction>

<user-task>
${prompt}
</user-task>`
}

function getIterationPrompt(
	iteration: number,
	max: number,
	strategy: "reset" | "continue",
	prompt: string,
): string {
	if (strategy === "continue") {
		const prefix = `${SYSTEM_DIRECTIVE_PREFIX} - RALPH LOOP ${iteration}/${max}]`
		return `${prefix}\n\n${CONTINUE_STRATEGY_PROMPT}`
			.replace("{{PROMPT}}", prompt)
	}
	const prefix = `[RALPH LOOP - Iteration ${iteration}/${max}]`
	return `${prefix}\n\n${getResetStrategyPrompt(prompt)}`
}

export function buildContinuationPrompt(state: RalphLoopState): string {
	const strategy = state.strategy ?? DEFAULT_STRATEGY
	let iterationPrompt = getIterationPrompt(
		state.iteration,
		state.max_iterations,
		strategy,
		state.prompt,
	)

	if (strategy === "continue") {
		iterationPrompt = iterationPrompt.replace("{{PROMISE}}", state.completion_promise)
	}

	return state.ultrawork ? `ultrawork ${iterationPrompt}` : iterationPrompt
}
