export const START_WORK_TEMPLATE = `You are starting a Sisyphus work session.

## WHAT TO DO

1. **Find available plans**: Search for plan files in the \`changes/\` directory:
   - Complex plans: \`changes/*/tasks.md\`
   - Quick plans: \`changes/quick-plans/*.md\`

2. **Check for active boulder state**: Read \`.sisyphus/boulder.json\` if it exists

3. **Decision logic**:
   - If \`.sisyphus/boulder.json\` exists AND plan is NOT complete (has unchecked boxes):
     - **APPEND** current session to session_ids
     - Continue work on existing plan
   - If no active plan OR plan is complete:
     - List available plan files from \`changes/\` directory
     - If ONE plan: auto-select it
     - If MULTIPLE plans: show list with timestamps, ask user to select

4. **Create/Update boulder.json**:
   \`\`\`json
   {
     "active_plan": "/absolute/path/to/changes/{name}/tasks.md",
     "started_at": "ISO_TIMESTAMP",
     "session_ids": ["session_id_1", "session_id_2"],
     "plan_name": "plan-name"
   }
   \`\`\`

5. **Read the plan file** and start executing tasks according to atlas workflow

## OUTPUT FORMAT

When listing plans for selection:
\`\`\`
Available Work Plans

Current Time: {ISO timestamp}
Session ID: {current session id}

Complex Plans (changes/*/tasks.md):
1. [feature-name] - Modified: {date} - Progress: 3/10 tasks

Quick Plans (changes/quick-plans/*.md):
2. [quick-fix-name.md] - Modified: {date} - Progress: 0/5 tasks

Which plan would you like to work on? (Enter number or plan name)
\`\`\`

When resuming existing work:
\`\`\`
Resuming Work Session

Active Plan: {plan-name}
Progress: {completed}/{total} tasks
Sessions: {count} (appending current session)

Reading plan and continuing from last incomplete task...
\`\`\`

When auto-selecting single plan:
\`\`\`
Starting Work Session

Plan: {plan-name}
Session ID: {session_id}
Started: {timestamp}

Reading plan and beginning execution...
\`\`\`

## CRITICAL

- The session_id is injected by the hook - use it directly
- Always update boulder.json BEFORE starting work
- Read the FULL plan file before delegating any tasks
- Follow atlas delegation protocols (7-section format)
- **ONLY search in \`changes/\` directory** - do NOT search \`.sisyphus/plans/\``
