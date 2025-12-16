export const BACKGROUND_TASK_DESCRIPTION = `Launch a background agent task that runs asynchronously.

The task runs in a separate session while you continue with other work. The system will notify you when the task completes.

Use this for:
- Long-running research tasks
- Complex analysis that doesn't need immediate results
- Parallel workloads to maximize throughput

Arguments:
- description: Short task description (shown in status)
- prompt: Full detailed prompt for the agent (MUST be in English for optimal LLM performance)
- agent: Agent type to use (any agent allowed)

IMPORTANT: Always write prompts in English regardless of user's language. LLMs perform significantly better with English prompts.

Returns immediately with task ID and session info. Use \`background_output\` to check progress or retrieve results.`

export const BACKGROUND_OUTPUT_DESCRIPTION = `Get output from a background task.

Arguments:
- task_id: Required task ID to get output from
- block: If true, wait for task completion. If false (default), return current status immediately.
- timeout: Max wait time in ms when blocking (default: 60000, max: 600000)

The system automatically notifies when background tasks complete. You typically don't need block=true.`

export const BACKGROUND_CANCEL_DESCRIPTION = `Cancel running background task(s).

Only works for tasks with status "running". Aborts the background session and marks the task as cancelled.

Arguments:
- taskId: Task ID to cancel (optional if all=true)
- all: Set to true to cancel ALL running background tasks at once (default: false)

**Cleanup Before Answer**: When you have gathered sufficient information and are ready to provide your final answer to the user, use \`all=true\` to cancel ALL running background tasks first, then deliver your response. This conserves resources and ensures clean workflow completion.`
