import { SYSTEM_DIRECTIVE_PREFIX } from "../../shared/system-directive"
import type { RalphLoopState } from "./types"

function getMaxIterationsLabel(state: RalphLoopState): string {
	return typeof state.max_iterations === "number" ? String(state.max_iterations) : "unbounded"
}

const CONTINUATION_PROMPT = `${SYSTEM_DIRECTIVE_PREFIX} - RALPH LOOP {{ITERATION}}/{{MAX}}]

Your previous attempt did not output the completion promise. Continue working on the task.

IMPORTANT:
- Review your progress so far
- Continue from where you left off
- When FULLY complete, output: <promise>{{PROMISE}}</promise>
- Do not stop until the task is truly done

Original task:
{{PROMPT}}`

const ULTRAWORK_VERIFICATION_PROMPT = `${SYSTEM_DIRECTIVE_PREFIX} - ULTRAWORK LOOP VERIFICATION {{ITERATION}}/{{MAX}}]

You already emitted <promise>{{INITIAL_PROMISE}}</promise>. This does NOT finish the loop yet.

REQUIRED NOW:
- Call Oracle using task(subagent_type="oracle", load_skills=[], run_in_background=false, ...)
- The Oracle call MUST go through the task tool with run_in_background=false. Do NOT use background_task / call_omo_agent / any background variant — the verification gate inspects the synchronous Oracle session and cannot recover the promise from a background subagent.
- Ask Oracle to verify whether the original task is actually complete
- Include the original task in the Oracle request
- Explicitly tell Oracle to review skeptically and critically, and to look for reasons the task may still be incomplete or wrong
- The system will inspect the Oracle session directly for the verification result
- If Oracle does not verify, continue fixing the task and do not consider it complete

AUTONOMOUS GATE — interactive prompts are forbidden during verification:
- Do NOT call ask_user_question / question / AskUserQuestion. The user is not present; an interactive prompt deadlocks the loop because OpenCode's input area is captured by the menu and the queued continuation cannot be delivered.
- If you previously launched Oracle as a background_task by mistake, retrieve the result with background_output and proceed silently — do not ask the user how to handle it. Then re-run Oracle synchronously via task(subagent_type="oracle", run_in_background=false, ...) so the gate can record the verification.

Original task:
{{PROMPT}}`

const ULTRAWORK_VERIFICATION_FAILED_PROMPT = `${SYSTEM_DIRECTIVE_PREFIX} - ULTRAWORK LOOP VERIFICATION FAILED {{ITERATION}}/{{MAX}}]

Oracle did not emit <promise>VERIFIED</promise>. Verification failed.

REQUIRED NOW:
- Verification failed. Fix the task until Oracle's review is satisfied
- Oracle does not lie. Treat the verification result as ground truth
- Do not claim completion early or argue with the failed verification
- After fixing the remaining issues, request Oracle review again using task(subagent_type="oracle", load_skills=[], run_in_background=false, ...)
- The re-review MUST be a synchronous task call — do NOT route Oracle through background_task / call_omo_agent / any background variant. The gate cannot read a background subagent's promise and will treat that as another failed verification.
- Include the original task in the Oracle request and tell Oracle to review skeptically and critically
- Only when the work is ready for review again, output: <promise>{{PROMISE}}</promise>

AUTONOMOUS GATE — interactive prompts are forbidden during verification:
- Do NOT call ask_user_question / question / AskUserQuestion. The user is not present; the menu captures the input area and the queued loop continuation will deadlock behind it.
- If a prior turn launched Oracle as a background_task, retrieve the result with background_output and continue without prompting the user.

Original task:
{{PROMPT}}`

export function buildContinuationPrompt(state: RalphLoopState): string {
	const template = state.verification_pending
		? ULTRAWORK_VERIFICATION_PROMPT
		: CONTINUATION_PROMPT
	const continuationPrompt = template.replace(
		"{{ITERATION}}",
		String(state.iteration),
	)
		.replace("{{MAX}}", getMaxIterationsLabel(state))
		.replace("{{INITIAL_PROMISE}}", state.initial_completion_promise ?? state.completion_promise)
		.replace("{{PROMISE}}", state.completion_promise)
		.replace("{{PROMPT}}", state.prompt)

	return state.ultrawork ? `ultrawork ${continuationPrompt}` : continuationPrompt
}

export function buildVerificationFailurePrompt(state: RalphLoopState): string {
	const continuationPrompt = ULTRAWORK_VERIFICATION_FAILED_PROMPT.replace(
		"{{ITERATION}}",
		String(state.iteration),
	)
		.replace("{{MAX}}", getMaxIterationsLabel(state))
		.replace("{{PROMISE}}", state.completion_promise)
		.replace("{{PROMPT}}", state.prompt)

	return state.ultrawork ? `ultrawork ${continuationPrompt}` : continuationPrompt
}
