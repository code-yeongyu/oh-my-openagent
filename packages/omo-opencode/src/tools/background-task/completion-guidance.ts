const WAIT_TOOL_GUIDANCE = "Before ending your turn, you MUST call `wait-for-background-tasks` so the session is not terminated while tasks are still running. It blocks until all tasks finish, the wait times out, or the call is aborted, then returns their final or current statuses. Then call `background_output(task_id=\"<id>\")` for each completed task to retrieve its result."

const REMINDER_GUIDANCE = "Do NOT call background_output now. Wait for <system-reminder> notification first. The system will deliver the result when the task completes; you do not need to poll for it."

export function getBackgroundCompletionGuidance(backgroundWaitAvailable: boolean): string {
  return backgroundWaitAvailable ? WAIT_TOOL_GUIDANCE : REMINDER_GUIDANCE
}
