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

const NO_WORK_REJECTION_PROMPT = `${SYSTEM_DIRECTIVE_PREFIX} - RALPH LOOP {{ITERATION}}/{{MAX}} - WORK REQUIRED]

⚠️ Your completion promise was REJECTED because no tool calls were detected.

You output <promise>{{PROMISE}}</promise> without performing any actual work (no file reads, edits, bash commands, or other tool calls).

The Ralph Loop requires you to ACTUALLY WORK on the task before declaring completion. You MUST:
1. Use tools to investigate, implement, or verify the task
2. Make meaningful progress (read files, edit code, run commands, etc.)
3. Only THEN output the completion promise when the task is truly done

Continue working on the original task:
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

export function buildNoWorkRejectionPrompt(state: RalphLoopState): string {
	const rejectionPrompt = NO_WORK_REJECTION_PROMPT.replace(
		"{{ITERATION}}",
		String(state.iteration),
	)
		.replace("{{MAX}}", String(state.max_iterations))
		.replace("{{PROMISE}}", state.completion_promise)
		.replace("{{PROMPT}}", state.prompt)

	return state.ultrawork ? `ultrawork ${rejectionPrompt}` : rejectionPrompt
}
