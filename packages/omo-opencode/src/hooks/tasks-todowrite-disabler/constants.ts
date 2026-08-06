export const HOOK_NAME = "tasks-todowrite-disabler"
// TodoWrite is intentionally NOT blocked — it is the only path that keeps
// the live todo panel UI in sync during execution. Blocking it froze the
// panel on stale state under experimental.task_system (#3764). TodoRead is
// still routed through Task tools because TaskList/TaskGet are the
// canonical readers when the task system is on.
export const BLOCKED_TOOLS = ["TodoRead"]
export const REPLACEMENT_MESSAGE = `TodoRead is DISABLED because experimental.task_system is enabled.

**ACTION REQUIRED**: Use Task tools to inspect work state. TodoWrite is still allowed so the live todo panel keeps updating, but reads belong to the task system.

**Use these tools instead of TodoRead:**
- TaskList: List active tasks with dependency info
- TaskGet: Get full task details
- TaskCreate: Create new task with auto-generated ID
- TaskUpdate: Update status, assign owner, add dependencies

**Workflow:**
1. TaskCreate({ subject: "your task description" })
2. TaskUpdate({ id: "T-xxx", status: "in_progress", owner: "your-thread-id" })
3. DO THE WORK
4. TaskUpdate({ id: "T-xxx", status: "completed" })

CRITICAL: 1 task = 1 task. Fire independent tasks concurrently.

**STOP! DO NOT START WORKING DIRECTLY - NO MATTER HOW SMALL THE TASK!**
Even if the task seems trivial (1 line fix, simple edit, quick change), you MUST:
1. FIRST register it with TaskCreate
2. THEN mark it in_progress
3. ONLY THEN do the actual work
4. FINALLY mark it completed

**WHY?** Task tracking = visibility = accountability. Skipping registration = invisible work = chaos.

DO NOT retry TodoRead. Use TaskList or TaskGet NOW.`
