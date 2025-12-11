export const BACKGROUND_TASK_DESCRIPTION = `Launch a background agent task that runs asynchronously.

The task runs in a separate session while you continue with other work. The system will notify you when the task completes.

Use this for:
- Long-running research tasks
- Complex analysis that doesn't need immediate results
- Parallel workloads to maximize throughput

Arguments:
- description: Short task description (shown in status)
- prompt: Full detailed prompt for the agent
- agent: Agent type to use (any agent allowed)
- session_id: Optional parent session ID (auto-detected if omitted)

Returns immediately with task ID and session info. Use \`background_status\` to check progress.`

export const BACKGROUND_STATUS_DESCRIPTION = `Check the status of background tasks.

If taskId is provided, returns status for that specific task.
If taskId is omitted, returns status for all tasks in the current session.

Status includes:
- Task description
- Current status (pending/running/completed/error/cancelled)
- Duration
- Number of tool calls made
- Last tool used

Arguments:
- taskId: Optional task ID. If omitted, lists all tasks for current session.`

export const BACKGROUND_RESULT_DESCRIPTION = `Retrieve the result of a completed background task.

Only works for tasks with status "completed". For running tasks, use \`background_status\` to check progress.

Returns the full assistant output from the background session, including:
- Task description
- Duration
- Complete response content
- Session ID for reference

Arguments:
- taskId: Required task ID to retrieve result for.`

export const BACKGROUND_CANCEL_DESCRIPTION = `Cancel a running background task.

Only works for tasks with status "running". Aborts the background session and marks the task as cancelled.

Arguments:
- taskId: Required task ID to cancel.`
