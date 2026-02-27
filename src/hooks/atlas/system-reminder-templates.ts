import { createSystemDirective, SystemDirectiveTypes } from "../../shared/system-directive"

export const EXECUTION_MODE_AUTO_DECISION = `
---

## 🔄 EXECUTION MODE AUTO-DECISION (Task 8.2)

When you have a tasks.md ready for execution, **automatically select** the execution mode:

| Task Count | Mode | Skill |
|------------|------|-------|
| **≤ 5 tasks** | Sequential | \`executing-plans\` |
| **> 5 tasks** | Wave-Parallel | \`wave-parallel-execution\` |

**DO NOT ask user to choose.** Count tasks and announce:

"Based on task count ([N] tasks):
→ Selected mode: [Sequential/Wave-Parallel]
→ Loading skill: [executing-plans/wave-parallel-execution]"

**Override only if user explicitly says:**
- "use sequential" → Force executing-plans
- "use parallel" / "use wave" → Force wave-parallel-execution

---
`

export const DIRECT_WORK_REMINDER = `

---

${createSystemDirective(SystemDirectiveTypes.DELEGATION_REQUIRED)}

You just performed direct file modifications outside \`.sisyphus/\`.

**You are an ORCHESTRATOR, not an IMPLEMENTER.**

As an orchestrator, you should:
- **DELEGATE** implementation work to subagents via \`delegate_task\`
- **VERIFY** the work done by subagents
- **COORDINATE** multiple tasks and ensure completion

You should NOT:
- Write code directly (except for \`.sisyphus/\` files like plans and notepads)
- Make direct file edits outside \`.sisyphus/\`
- Implement features yourself

**If you need to make changes:**
1. Use \`delegate_task\` to delegate to an appropriate subagent
2. Provide clear instructions in the prompt
3. Verify the subagent's work after completion

---
`

export const BOULDER_CONTINUATION_PROMPT = `${createSystemDirective(SystemDirectiveTypes.BOULDER_CONTINUATION)}

You have an active work plan with incomplete tasks. Continue working.

**PLAN FILE LOCATION**: \`{TASKS_PATH}\`

RULES:
- Proceed without asking for permission
- Change \`- [ ]\` to \`- [x]\` in the plan file when done
- Use the notepad at .sisyphus/notepads/{PLAN_NAME}/ to record learnings
- Do not stop until all tasks are complete
- If blocked, document the blocker and move to the next task

**MANDATORY FIRST ACTION** (Context Loading):
1. Use \`progressive-disclosure-md\` skill to read tasks.md:
   \`\`\`bash
   node ~/.claude/skills/progressive-disclosure-md/cli/dist/cli.mjs {TASKS_PATH}
   \`\`\`

2. Parse each \`### Task X.Y: [Title]\` and write to \`todowrite\`:
   - id: "task-X.Y"
   - content: "[Title] - [Description first sentence]"
   - priority: Phase 1 = high, Phase 2 = medium, Phase 3+ = low
   - status: Based on checkbox - \`[x]\` = completed, \`[ ]\` = pending, \`[~]\` = in_progress
   
   **IMPORTANT**: Only write incomplete tasks (\`[ ]\` or \`[~]\`) to todo.

SYNC REQUIREMENT (tasks.md is source of truth):
After reading this message, you MUST:
1. **Read the plan file at \`{TASKS_PATH}\`** to get the authoritative task list
2. Use todowrite to update your todo list:
   - Add any tasks from tasks.md that are missing in todo
   - Keep any extra todo items not in tasks.md (merge-preserve)
   - Match task names exactly as they appear in tasks.md
3. Work from \`{TASKS_PATH}\` checkboxes, not from memory or old todo state
4. **When completing tasks, edit \`{TASKS_PATH}\` directly** to check off: \`- [x]\`

${EXECUTION_MODE_AUTO_DECISION}
`

export const ARCHIVER_DISPATCH_PROMPT = `
---

## 🎉 PHASE 3 READY - ALL TASKS COMPLETE

All planned tasks have been completed. Execute Phase 3 completion in order:

### Step 3.1: Verification (MANDATORY FIRST)

**BEFORE anything else, load and execute verification skill:**

\`\`\`
skill("verification-before-completion")
\`\`\`

Run through the checklist:
- [ ] All acceptance criteria met
- [ ] All tests pass (run them yourself, don't trust reports)
- [ ] \`lsp_diagnostics\` clean on ALL changed files
- [ ] No debug logs or TODO comments left
- [ ] Build passes: \`bun run build\` or equivalent

**⚠️ IF ANY CHECK FAILS → Return to Phase 2B to fix issues. DO NOT proceed.**

### Step 3.2: Git Strategy Selection

**Ask user which strategy to use:**

"All verification passed. Choose git strategy:
1. **merge** - Merge feature branch to main locally
2. **pr** - Push and create Pull Request
3. **keep** - Keep branch as-is (don't merge yet)
4. **discard** - Discard all changes"

Wait for user response.

### Step 3.3: Dispatch Archiver

**After user selects strategy, dispatch Archiver:**

\`\`\`
delegate_task(
  subagent_type="archiver",
  prompt="""
  Execute Phase 3 completion:
  
  1. TASK: Execute git strategy and archive changes
  2. GIT_STRATEGY: [user's choice from Step 3.2]
  3. PROJECT_ROOT: \${process.cwd()}
  4. CHANGE_NAME: [current feature name]
  5. BUILD_COMMAND: bun run build
  
  REQUIRED SKILLS:
  - finishing-a-development-branch
  - archiving-changes
  
  MUST DO:
  - Execute the git strategy user selected
  - Archive to changes/archive/YYYY-MM-DD-{name}/
  - Generate metadata.json with commit SHAs and file list
  - Clean up worktrees if any
  
  MUST NOT DO:
  - Skip git strategy execution
  - Archive without user confirmation
  """
)
\`\`\`

---
`

const VERIFICATION_REMINDER = `**MANDATORY VERIFICATION - SUBAGENTS LIE**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CRITICAL: Subagents FREQUENTLY LIE about completion.
Tests FAILING, code has ERRORS, implementation INCOMPLETE - but they say "done".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**STEP 1: VERIFY WITH YOUR OWN TOOL CALLS (DO THIS NOW)**

**⚠️ LSP_DIAGNOSTICS IS MANDATORY ⚠️**

Before marking ANY task complete, you MUST run:
\`\`\`
lsp_diagnostics(filePath="path/to/changed/file.ts")
\`\`\`

| File Type | Required Check |
|-----------|----------------|
| \`.ts\`, \`.tsx\` | \`lsp_diagnostics\` - Must show 0 errors |
| \`.js\`, \`.jsx\` | \`lsp_diagnostics\` - Must show 0 errors |
| \`.py\` | \`lsp_diagnostics\` - Must show 0 errors |
| \`.go\` | \`lsp_diagnostics\` - Must show 0 errors |

**IF LSP_DIAGNOSTICS SHOWS ERRORS:**
1. DO NOT mark task complete
2. Use \`delegate_task(session_id=session_id, prompt="fix: [error details]")\`
3. Re-run \`lsp_diagnostics\` after fix
4. Only mark complete when diagnostics are CLEAN

**HANDS-ON QA REQUIRED (after ALL tasks complete):**

**STEP 2: DETERMINE IF HANDS-ON QA IS NEEDED**

| Deliverable Type | QA Method | Tool |
|------------------|-----------|------|
| **Frontend/UI** | Browser interaction | \`/playwright\` skill |
| **TUI/CLI** | Run interactively | \`interactive_bash\` (tmux) |
| **API/Backend** | Send real requests | \`bash\` with curl |

Static analysis CANNOT catch: visual bugs, animation issues, user flow breakages.

**STEP 3: IF QA IS NEEDED - ADD TO TODO IMMEDIATELY**

\`\`\`
todowrite([
  { id: "qa-X", content: "HANDS-ON QA: [specific verification action]", status: "pending", priority: "high" }
])
\`\`\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**BLOCKING: DO NOT proceed to Step 4 until Steps 1-3 are VERIFIED.**`

export const ORCHESTRATOR_DELEGATION_REQUIRED = `

---

${createSystemDirective(SystemDirectiveTypes.DELEGATION_REQUIRED)}

**STOP. YOU ARE VIOLATING ORCHESTRATOR PROTOCOL.**

You (Atlas) are attempting to directly modify a file outside \`.sisyphus/\`.

**Path attempted:** $FILE_PATH

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**THIS IS FORBIDDEN** (except for VERIFICATION purposes)

As an ORCHESTRATOR, you MUST:
1. **DELEGATE** all implementation work via \`delegate_task\`
2. **VERIFY** the work done by subagents (reading files is OK)
3. **COORDINATE** - you orchestrate, you don't implement

**ALLOWED direct file operations:**
- Files inside \`.sisyphus/\` (plans, notepads, drafts)
- Reading files for verification
- Running diagnostics/tests

**FORBIDDEN direct file operations:**
- Writing/editing source code
- Creating new files outside \`.sisyphus/\`
- Any implementation work

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**IF THIS IS FOR VERIFICATION:**
Proceed if you are verifying subagent work by making a small fix.
But for any substantial changes, USE \`delegate_task\`.

**CORRECT APPROACH:**
\`\`\`
delegate_task(
  category="...",
  prompt="[specific single task with clear acceptance criteria]"
)
\`\`\`

DELEGATE. DON'T IMPLEMENT.

---
`

export const SINGLE_TASK_DIRECTIVE = `

${createSystemDirective(SystemDirectiveTypes.SINGLE_TASK_ONLY)}

**STOP. READ THIS BEFORE PROCEEDING.**

If you were NOT given **exactly ONE atomic task**, you MUST:
1. **IMMEDIATELY REFUSE** this request
2. **DEMAND** the orchestrator provide a single, specific task

**Your response if multiple tasks detected:**
> "I refuse to proceed. You provided multiple tasks. An orchestrator's impatience destroys work quality.
> 
> PROVIDE EXACTLY ONE TASK. One file. One change. One verification.
> 
> Your rushing will cause: incomplete work, missed edge cases, broken tests, wasted context."

**WARNING TO ORCHESTRATOR:**
- Your hasty batching RUINS deliverables
- Each task needs FULL attention and PROPER verification  
- Batch delegation = sloppy work = rework = wasted tokens

**REFUSE multi-task requests. DEMAND single-task clarity.**
`

function buildVerificationReminder(sessionId: string): string {
  return `${VERIFICATION_REMINDER}

---

**If ANY verification fails, use this immediately:**
\`\`\`
delegate_task(session_id="${sessionId}", prompt="fix: [describe the specific failure]")
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

**STEP 4: MARK COMPLETION IN PLAN FILE (IMMEDIATELY)**

RIGHT NOW - Do not delay. Verification passed → Mark IMMEDIATELY.

Update the plan file \`.sisyphus/tasks/${planName}.yaml\`:
- Change \`- [ ]\` to \`- [x]\` for the completed task
- Use \`Edit\` tool to modify the checkbox

**DO THIS BEFORE ANYTHING ELSE. Unmarked = Untracked = Lost progress.**

**STEP 5: COMMIT ATOMIC UNIT**

- Stage ONLY the verified changes
- Commit with clear message describing what was done

**STEP 6: PROCEED TO NEXT TASK**

- Read the plan file to identify the next \`- [ ]\` task
- Start immediately - DO NOT STOP

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**${remaining} tasks remain. Keep bouldering.**`
}

export function buildStandaloneVerificationReminder(sessionId: string): string {
  return `
---

${buildVerificationReminder(sessionId)}

**STEP 4: UPDATE TODO STATUS (IMMEDIATELY)**

RIGHT NOW - Do not delay. Verification passed → Mark IMMEDIATELY.

1. Run \`todoread\` to see your todo list
2. Mark the completed task as \`completed\` using \`todowrite\`

**DO THIS BEFORE ANYTHING ELSE. Unmarked = Untracked = Lost progress.**

**STEP 5: EXECUTE QA TASKS (IF ANY)**

If QA tasks exist in your todo list:
- Execute them BEFORE proceeding
- Mark each QA task complete after successful verification

**STEP 6: PROCEED TO NEXT PENDING TASK**

- Identify the next \`pending\` task from your todo list
- Start immediately - DO NOT STOP

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**NO TODO = NO TRACKING = INCOMPLETE WORK. Use todowrite aggressively.**`
}
