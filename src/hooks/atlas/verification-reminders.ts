import { VERIFICATION_REMINDER } from "./system-reminder-templates"

function buildVerificationReminder(sessionId: string): string {
  return `${VERIFICATION_REMINDER}

---

**If ANY verification fails, use this immediately:**
\`\`\`
task(session_id="${sessionId}", prompt="fix: [describe the specific failure]")
\`\`\``
}

export function buildOrchestratorReminder(
  planName: string,
  progress: { total: number; completed: number },
  sessionId: string
): string {
  const remaining = progress.total - progress.completed
  return `
---

**BOULDER STATE:** Plan: \`${planName}\` | ${progress.completed}/${progress.total} done | ${remaining} remaining

---

${buildVerificationReminder(sessionId)}

**STEP 5: CHECK BOULDER STATE DIRECTLY (EVERY TIME — NO EXCEPTIONS)**

Do NOT rely on cached progress. Read the plan file NOW:
\`\`\`
Read(".sisyphus/tasks/${planName}.yaml")
\`\`\`
Count exactly: how many \`- [ ]\` remain? How many \`- [x]\` completed?
This is YOUR ground truth. Use it to decide what comes next.

**STEP 6: MARK COMPLETION IN PLAN FILE (IMMEDIATELY)**

RIGHT NOW - Do not delay. Verification passed → Mark IMMEDIATELY.

Update the plan file \`.sisyphus/tasks/${planName}.yaml\`:
- Change \`- [ ]\` to \`- [x]\` for the completed task
- Use \`Edit\` tool to modify the checkbox

**DO THIS BEFORE ANYTHING ELSE. Unmarked = Untracked = Lost progress.**

**STEP 7: COMMIT ATOMIC UNIT**

- Stage ONLY the verified changes
- Commit with clear message describing what was done

**STEP 8: PROCEED TO NEXT TASK**

- Read the plan file AGAIN to identify the next \`- [ ]\` task
- Start immediately - DO NOT STOP

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**${remaining} tasks remain. Keep bouldering.**`
}

export function buildStandaloneVerificationReminder(sessionId: string): string {
  return `
---

${buildVerificationReminder(sessionId)}

**STEP 5: CHECK YOUR PROGRESS DIRECTLY (EVERY TIME — NO EXCEPTIONS)**

Do NOT rely on memory or cached state. Run \`todoread\` NOW to see exact current state.
Count pending vs completed tasks. This is your ground truth for what comes next.

**STEP 6: UPDATE TODO STATUS (IMMEDIATELY)**

RIGHT NOW - Do not delay. Verification passed → Mark IMMEDIATELY.

1. Run \`todoread\` to see your todo list
2. Mark the completed task as \`completed\` using \`todowrite\`

**DO THIS BEFORE ANYTHING ELSE. Unmarked = Untracked = Lost progress.**

**STEP 7: EXECUTE QA TASKS (IF ANY)**

If QA tasks exist in your todo list:
- Execute them BEFORE proceeding
- Mark each QA task complete after successful verification

**STEP 8: PROCEED TO NEXT PENDING TASK**

- Run \`todoread\` AGAIN to identify the next \`pending\` task
- Start immediately - DO NOT STOP

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**NO TODO = NO TRACKING = INCOMPLETE WORK. Use todowrite aggressively.**`
}
