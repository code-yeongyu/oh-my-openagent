export function buildTaskSystemGuide(useTaskSystem: boolean): string {
  if (useTaskSystem) {
    return `Create tasks before any non-trivial work (2+ steps, uncertain scope, multiple items).

Workflow:
1. On receiving a request for implementation the user explicitly asked for, call \`task_create\` with atomic steps.
2. Before each step, call \`task_update(status="in_progress")\`. One step in progress at a time.
3. After each step, call \`task_update(status="completed")\` immediately. Never batch completions.
4. If scope changes, update the task list before proceeding.

Your task creations are tracked by the harness; the system will nudge you if you go idle with open tasks.`
  }

  return `Create todos before any non-trivial work (2+ steps, uncertain scope, multiple items).

Workflow:
1. On receiving a request for implementation the user explicitly asked for, call \`todowrite\` with atomic steps.
2. Before each step, mark the item \`in_progress\`. One step in progress at a time.
3. After each step, mark it \`completed\` immediately. Never batch completions.
4. If scope changes, update the todo list before proceeding.

Your todo creations are tracked by the harness; the system will nudge you if you go idle with open items.`
}
