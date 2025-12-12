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

Returns immediately with task ID and session info. Use \`background_output\` to check progress or retrieve results.`

export const BACKGROUND_OUTPUT_DESCRIPTION = `Get output from a background task.

Arguments:
- task_id: Required task ID to get output from
- block: If true (default), wait for task completion. If false, return current status immediately.
- timeout: Max wait time in ms when blocking (default: 60000, max: 600000)

Returns:
- When blocking: Waits for completion, then returns full result
- When not blocking: Returns current status and progress

Use this to:
- Check task progress (block=false)
- Wait for and retrieve task result (block=true)
- Set custom timeout for long tasks`

export const BACKGROUND_CANCEL_DESCRIPTION = `Cancel a running background task.

Only works for tasks with status "running". Aborts the background session and marks the task as cancelled.

Arguments:
- taskId: Required task ID to cancel.`
