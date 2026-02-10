import { SYSTEM_DIRECTIVE_PREFIX } from "../../shared/system-directive"
import type { RalphLoopState } from "./types"

const CONTINUATION_PROMPT = `${SYSTEM_DIRECTIVE_PREFIX} - RALPH LOOP {{ITERATION}}/{{MAX}}]

Your previous attempt did not output the completion promise. Continue working on the task.

IMPORTANT:
- Review your progress so far
- Continue from where you left off
- When FULLY complete, output: <promise>{{PROMISE}}</promise>
- Do not stop until the task is truly done

Original task:
{{PROMPT}}`

export function buildContinuationPrompt(state: RalphLoopState): string {
	const continuationPrompt = CONTINUATION_PROMPT.replace(
		"{{ITERATION}}",
		String(state.iteration),
	)
		.replace("{{MAX}}", String(state.max_iterations))
		.replace("{{PROMISE}}", state.completion_promise)
		.replace("{{PROMPT}}", state.prompt)

	return state.ultrawork ? `ultrawork ${continuationPrompt}` : continuationPrompt
}
