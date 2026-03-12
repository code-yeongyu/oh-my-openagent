export function createStartWorkTemplate(options?: { worktreeEnabled?: boolean }): string {
  const worktreeEnabled = options?.worktreeEnabled ?? true

  const argumentsSection = worktreeEnabled
    ? `- \`/start-work [plan-name] [--worktree <path>]\`
  - \`plan-name\` (optional): name or partial match of the plan to start
  - \`--worktree <path>\` (optional): absolute path to an existing git worktree to work in
    - If specified and valid: hook pre-sets worktree_path in boulder.json
    - If specified but invalid: you must run \`git worktree add <path> <branch>\` first
    - If omitted: you MUST choose or create a worktree (see Worktree Setup below)`
    : `- \`/start-work [plan-name]\`
  - \`plan-name\` (optional): name or partial match of the plan to start`

  const worktreeSetupSection = worktreeEnabled
    ? `
4. **Worktree Setup** (when \`worktree_path\` not already set in boulder.json):
   1. \`git worktree list --porcelain\` — see available worktrees
   2. Create: \`git worktree add <absolute-path> <branch-or-HEAD>\`
   3. Update boulder.json to add \`"worktree_path": "<absolute-path>"\`
   4. All work happens inside that worktree directory
`
    : ``

  const boulderJsonWorktreeLine = worktreeEnabled
    ? `      "worktree_path": "/absolute/path/to/git/worktree"\n`
    : ``

  const resumingWorktreeLine = worktreeEnabled
    ? `Worktree: {worktree_path}\n`
    : ``

  const startingWorktreeLine = worktreeEnabled
    ? `Worktree: {worktree_path}\n`
    : ``

  const worktreeCritical = worktreeEnabled
    ? `- Always set worktree_path in boulder.json before executing any tasks\n`
    : ``

  return `You are starting a Sisyphus work session.

## ARGUMENTS

${argumentsSection}

## WHAT TO DO

1. **Find available plans**: Search for Prometheus-generated plan files at \`.sisyphus/plans/\`

2. **Check for active boulder state**: Read \`.sisyphus/boulder.json\` if it exists

3. **Decision logic**:
   - If \`.sisyphus/boulder.json\` exists AND plan is NOT complete (has unchecked boxes):
     - **APPEND** current session to session_ids
     - Continue work on existing plan
   - If no active plan OR plan is complete:
     - List available plan files
     - If ONE plan: auto-select it
     - If MULTIPLE plans: show list with timestamps, ask user to select
${worktreeSetupSection}
${worktreeEnabled ? "5" : "4"}. **Create/Update boulder.json**:
   \`\`\`json
   {
     "active_plan": "/absolute/path/to/plan.md",
     "started_at": "ISO_TIMESTAMP",
     "session_ids": ["session_id_1", "session_id_2"],
     "plan_name": "plan-name"${worktreeEnabled ? `,\n     "worktree_path": "/absolute/path/to/git/worktree"` : ""}
   }
   \`\`\`

${worktreeEnabled ? "6" : "5"}. **Read the plan file** and start executing tasks according to atlas workflow

## OUTPUT FORMAT

When listing plans for selection:
\`\`\`
Available Work Plans

Current Time: {ISO timestamp}
Session ID: {current session id}

1. [plan-name-1.md] - Modified: {date} - Progress: 3/10 tasks
2. [plan-name-2.md] - Modified: {date} - Progress: 0/5 tasks

Which plan would you like to work on? (Enter number or plan name)
\`\`\`

When resuming existing work:
\`\`\`
Resuming Work Session

Active Plan: {plan-name}
Progress: {completed}/{total} tasks
Sessions: {count} (appending current session)
${resumingWorktreeLine}
Reading plan and continuing from last incomplete task...
\`\`\`

When auto-selecting single plan:
\`\`\`
Starting Work Session

Plan: {plan-name}
Session ID: {session_id}
Started: {timestamp}
${startingWorktreeLine}
Reading plan and beginning execution...
\`\`\`

## CRITICAL

- The session_id is injected by the hook - use it directly
- Always update boulder.json BEFORE starting work
${worktreeCritical}- Read the FULL plan file before delegating any tasks
- Follow atlas delegation protocols (7-section format)`
}

export const START_WORK_TEMPLATE = createStartWorkTemplate()
