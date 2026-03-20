export const STOP_CONTINUATION_TEMPLATE = `Stop all continuation mechanisms for the current session.

This command will:
1. Stop the todo-continuation-enforcer from automatically continuing incomplete tasks
2. Cancel any active Ralph Loop
3. Clear the boulder state for the current project

After running this command:
- The session will not auto-continue when idle
- You can manually continue work when ready
- The stop state is per-session and clears when the session ends

Use this when you need to pause automated continuation and take manual control.`
