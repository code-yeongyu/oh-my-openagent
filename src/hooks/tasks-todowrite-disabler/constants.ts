export const HOOK_NAME = "tasks-todowrite-disabler"
export const BLOCKED_TOOLS = ["TodoWrite", "TodoRead"]
export const REPLACEMENT_MESSAGE = `TodoRead/TodoWrite are disabled because experimental.task_system is enabled.
Use the new task tools instead:
- TaskCreate: Create new tasks with auto-generated IDs
- TaskUpdate: Update task status, add dependencies
- TaskList: List active tasks with dependency info
- TaskGet: Get full task details

IMPORTANT: 1 task = 1 delegate_task. Maximize parallel execution by running independent tasks concurrently.`
