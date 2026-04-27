import { createSystemDirective, SystemDirectiveTypes } from "../../shared/system-directive"

export const HOOK_NAME = "todo-continuation-enforcer"

export const DEFAULT_SKIP_AGENTS = ["prometheus", "compaction", "plan"]

export const CONTINUATION_PROMPT = `${createSystemDirective(SystemDirectiveTypes.TODO_CONTINUATION)}

Incomplete tasks remain in your todo list. Continue working on the next pending task.

- Proceed without asking for permission
- Mark each task complete when finished
- Do not stop until all tasks are done
- If you believe all work is already complete, the system is questioning your completion claim. Critically re-examine each todo item from a skeptical perspective, verify the work was actually done correctly, and update the todo list accordingly.`

export const CLARIFICATION_ESCALATION_PROMPT = `${createSystemDirective(SystemDirectiveTypes.TODO_CONTINUATION)}

You have now asked for clarification or more instructions for the SECOND consecutive time.

CRITICAL: You MUST take action on your own this time. Do NOT ask for instructions again.

- If you lack information: make a reasonable assumption, document it, and proceed
- If you are blocked: skip the current task, mark it as blocked, and move to the next
- If genuinely stuck: mark ALL remaining tasks as cancelled with a clear reason
- Under NO circumstances should you ask for more instructions

Do NOT use the question tool. Do NOT ask for clarification in text. TAKE ACTION.`

export const CLARIFICATION_BLOCKED_PROMPT = `${createSystemDirective(SystemDirectiveTypes.TODO_CONTINUATION)}

You have asked for clarification or more instructions for the THIRD consecutive time. This approach is not working.

YOU ARE NOW REQUIRED TO:

1. Mark ALL remaining incomplete tasks as "cancelled"
2. Document what information you were missing for each task
3. Write a summary of what blocked you to .sisyphus/blocked-summary.md
4. Do NOT ask for more instructions - the system will not inject any further prompts

This is a HARD STOP. No more continuation prompts will be sent for this session.`

export const COUNTDOWN_SECONDS = 2
export const TOAST_DURATION_MS = 900
export const COUNTDOWN_GRACE_PERIOD_MS = 500

export const ABORT_WINDOW_MS = 3000
export const COMPACTION_GUARD_MS = 60_000
export const CONTINUATION_COOLDOWN_MS = 5_000
export const MAX_STAGNATION_COUNT = 3
export const MAX_CONSECUTIVE_FAILURES = 5
export const MAX_CLARIFICATION_CONSECUTIVE = 3
export const CLARIFICATION_COOLDOWN_MS = 10_000
export const FAILURE_RESET_WINDOW_MS = 5 * 60 * 1000
export const IN_FLIGHT_TIMEOUT_MS = 30_000
