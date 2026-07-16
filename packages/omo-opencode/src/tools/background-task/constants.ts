export const BACKGROUND_TASK_DESCRIPTION = `Run agent task in background. Returns a background task ID (\`bg_...\`) immediately and notifies on completion.

Do NOT poll for results. The system delivers a <system-reminder> when the task finishes.

Prompts MUST be in English.`

export const BACKGROUND_OUTPUT_DESCRIPTION = `Get output from background task. Use full_session=true to fetch session messages with filters. System notifies on completion, so block=true rarely needed. - Timeout values are in milliseconds (ms), NOT seconds.

IMPORTANT: ONLY call this tool AFTER receiving a <system-reminder> notification for the task. Do NOT call immediately after launching a background task - wait for the notification first.`

export const BACKGROUND_CANCEL_DESCRIPTION = `Cancel running background task(s). Use all=true to cancel ALL before final answer.`

export const WAIT_FOR_BACKGROUND_TASKS_DESCRIPTION = `Block until all background tasks for your session finish, the wait times out, or the call is aborted, then return their final or current statuses. Call this BEFORE ending your turn while background tasks are running so the session is not terminated with work still in flight.`
