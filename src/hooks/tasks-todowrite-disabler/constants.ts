export const HOOK_NAME = "tasks-todowrite-disabler"
export const BLOCKED_TOOLS = ["TodoWrite", "TodoRead"]
export const REPLACEMENT_MESSAGE = `TodoRead/TodoWrite are DISABLED because experimental.task_system is enabled.

**ACTION REQUIRED**: RE-REGISTER what you were about to write as Todo using Task tools NOW. Then ASSIGN yourself and START WORKING immediately.

**Use these tools instead:**
- TaskCreate: Create new task with auto-generated ID
- TaskUpdate: Update status, assign owner, add dependencies
- TaskList: List active tasks with dependency info
- TaskGet: Get full task details

**Workflow:**
1. TaskCreate({ subject: "your task description" })
2. TaskUpdate({ id: "T-xxx", status: "in_progress", owner: "your-thread-id" })
3. DO THE WORK
4. TaskUpdate({ id: "T-xxx", status: "completed" })

CRITICAL: 1 task = 1 delegate_task. Fire independent tasks concurrently.

DO NOT retry TodoWrite. Convert to TaskCreate NOW.`
