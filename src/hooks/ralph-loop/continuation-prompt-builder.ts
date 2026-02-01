import { SYSTEM_DIRECTIVE_PREFIX } from "../../shared/system-directive"
import type { RalphLoopState } from "./types"
import { DEFAULT_STRATEGY } from "./constants"

const CONTINUATION_PROMPT_BASE = `Your previous attempt did not output the completion promise. Continue working on the task.

IMPORTANT:
- Review your progress so far
- Continue from where you left off
- When FULLY complete, output: <promise>{{PROMISE}}</promise>
- Do not stop until the task is truly done

Original task:
{{PROMPT}}`

function getContinuationPrompt(iteration: number, max: number, strategy: "reset" | "continue"): string {
	const prefix =
		strategy === "continue"
			? `${SYSTEM_DIRECTIVE_PREFIX} - RALPH LOOP ${iteration}/${max}]`
			: `[RALPH LOOP - Iteration ${iteration}/${max}]`
	return `${prefix}\n\n${CONTINUATION_PROMPT_BASE}`
}

export function buildContinuationPrompt(state: RalphLoopState): string {
	const strategy = state.strategy ?? DEFAULT_STRATEGY
	const continuationPrompt = getContinuationPrompt(
		state.iteration,
		state.max_iterations,
		strategy,
	)
		.replace("{{PROMISE}}", state.completion_promise)
		.replace("{{PROMPT}}", state.prompt)

	return state.ultrawork ? `ultrawork ${continuationPrompt}` : continuationPrompt
}
