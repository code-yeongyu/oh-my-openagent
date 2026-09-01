export const REMOVE_AI_SLOPS_TEMPLATE = `# Remove AI Slops Command

## Codex Harness Tool Compatibility

This command includes examples for the OpenCode harness. In Codex, do not call OpenCode-only tools such as \`call_omo_agent(...)\`, \`task(...)\`, \`background_output(...)\`, or \`team_*(...)\` literally. Translate those examples to Codex native tools:

| OpenCode example | Codex tool to use |
| --- | --- |
| \`call_omo_agent(subagent_type="explore", ...)\` | \`multi_agent_v1.spawn_agent({"message":"TASK: act as an explorer. ...","agent_type":"explorer","fork_context":false})\` |
| \`call_omo_agent(subagent_type="librarian", ...)\` | \`multi_agent_v1.spawn_agent({"message":"TASK: act as a librarian. ...","agent_type":"librarian","fork_context":false})\` |
| \`task(subagent_type="plan", ...)\` | \`multi_agent_v1.spawn_agent({"message":"TASK: act as a planning agent. ...","agent_type":"plan","fork_context":false})\` |
| \`task(subagent_type="oracle", ...)\` | \`multi_agent_v1.spawn_agent({"message":"TASK: act as a rigorous reviewer. ...","agent_type":"lazycodex-gate-reviewer","fork_context":false})\` |
| \`task(category="...", ...)\` | \`multi_agent_v1.spawn_agent({"message":"TASK: act as an implementation or QA worker. ...","fork_context":false})\` |
| \`background_output(task_id="...")\` | \`multi_agent_v1.wait_agent(...)\` for mailbox signals |
| \`team_*(...)\` | Use Codex native subagents via \`multi_agent_v1.spawn_agent\` and \`multi_agent_v1.wait_agent\`; use \`multi_agent_v1.send_input\` and \`multi_agent_v1.close_agent\` only when exposed in the active tools list |

Codex exposes ONE of two subagent tool surfaces per session; check your own tool list and route accordingly. If \`multi_agent_v1.*\` tools exist, use the table above as written. If instead a flat \`spawn_agent\` with a required \`task_name\` exists (\`multi_agent_v2\`), rewrite every \`multi_agent_v1.*\` example: \`multi_agent_v1.spawn_agent({...,"fork_context":false})\` becomes \`spawn_agent({"task_name":"<lowercase_digits_underscores>","message":...,"agent_type":...,"fork_turns":"none"})\` (\`"all"\` only when full parent history is truly required); \`send_input\` becomes \`send_message\`; do not call \`close_agent\`/\`resume_agent\` (finished agents end on their own; \`followup_task\` re-tasks one, \`interrupt_agent\` stops one); \`wait_agent\` takes only \`timeout_ms\` and returns on any child mailbox activity. \`agent_type\` works the same on both surfaces. If a code block below conflicts with this section, this section wins.

When translating \`load_skills=[...]\`, include the requested skill names in the spawned agent's \`message\`. If a code block below conflicts with this section, this section wins.

## What this command does
Analyzes all files changed in the current branch (compared to parent commit), removes AI-generated code smells in parallel, then critically reviews the changes to ensure safety and behavior preservation. Fixes any issues found during review.

## Step 0: Task Planning

Use TodoWrite to create the task list:
1. Get changed files from branch
2. Run $omo:remove-ai-slops on each file in parallel
3. Critically review all changes
4. Fix any issues found

## Role Definition
You are a senior code quality engineer specialized in identifying and removing AI-generated code patterns while preserving original functionality. You have deep expertise in code review, refactoring safety, and behavioral preservation.

## Process

### Phase 1: Identify Changed Files
Detect the repository base branch dynamically, then get all changed files in the current branch:
\`\`\`bash
BASE_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")
git diff $(git merge-base "$BASE_BRANCH" HEAD)..HEAD --name-only
\`\`\`

If \`git symbolic-ref refs/remotes/origin/HEAD\` is unavailable, detect the base branch at runtime using the repo's configured remote default branch. Only fall back to \`main\` as a last resort.

### Phase 2: Parallel AI Slop Removal
For each changed file, spawn an agent in parallel using the Task tool with the $omo:remove-ai-slops skill:

\`\`\`
task(category="quick", load_skills=["remove-ai-slops"], run_in_background=true, description="Remove AI slops from {filename}", prompt="Remove AI slops from: {file_path}")
\`\`\`

**CRITICAL**: Launch ALL agents in a SINGLE message with multiple Task tool calls for maximum parallelism.

Before running $omo:remove-ai-slops on each file, save a file-specific rollback artifact that captures only the delta introduced by the slop-removal pass. Use a safe pattern such as generating a per-file patch and reverse-applying it if review fails.

Do NOT use \`git checkout -- {file_path}\` or any rollback that discards pre-existing branch changes in the file.

### Phase 3: Critical Review
After all $omo:remove-ai-slops agents complete, perform a critical review with the following checklist:

**Safety Verification**:
- [ ] No functional logic was accidentally removed
- [ ] All error handling is preserved
- [ ] Type hints remain correct and complete
- [ ] Import statements are still valid
- [ ] No breaking changes to public APIs

**Behavior Preservation**:
- [ ] Return values unchanged
- [ ] Side effects unchanged
- [ ] Exception behavior unchanged
- [ ] Edge case handling preserved

**Code Quality**:
- [ ] Removed changes are genuinely AI slop (not intentional patterns)
- [ ] Remaining code follows project conventions
- [ ] No orphaned code or dead references

### Phase 4: Fix Issues
If any issues are found during critical review:
1. Identify the specific problem
2. Explain why it's a problem
3. Revert only the $omo:remove-ai-slops delta using the saved per-file patch or an equivalent reverse-apply workflow
4. If remaining ai-slops are found after reverting, remove them by editing the file yourself - with parallel tool calls, per-file
5. Verify the fix doesn't introduce new issues

## Output Format

### Summary Report
\`\`\`
## AI Slop Removal Summary

### Files Processed
- file1.py: X changes
- file2.py: Y changes

### Critical Review Results
- Safety: PASS/FAIL
- Behavior: PASS/FAIL
- Quality: PASS/FAIL

### Issues Found & Fixed
1. [Issue description] -> [Fix applied]

### Final Status
[CLEAN / ISSUES FIXED / REQUIRES ATTENTION]
\`\`\`

## Quality Assurance
- NEVER remove code that serves a functional purpose
- ALWAYS verify changes compile/parse correctly
- ALWAYS preserve test coverage
- If uncertain about a change, err on the side of keeping the original code`

export const REMOVE_AI_SLOPS_TEAM_MODE_ADDENDUM = `
---

# Team Mode Protocol (active when team_* tools are present)

Team mode is enabled for this session. The rules below **override Phase 2-4** of the legacy flow above. Follow this protocol instead of the per-file fire-and-forget \`task()\` dispatch.

## Phase 2 (team): \`slop-squad\` setup

**Precondition checks** (fail hard if any step fails):

1. Load the \`team-mode\` skill via the \`skill\` tool for lifecycle, message protocol, broadcast rules, 32KB message cap, and 4 parallel worker cap.
2. Call \`team_list\` and verify no active run named \`slop-squad\` exists. If one does, it is an orphan from a crashed prior session — \`team_shutdown_request\` + \`team_approve_shutdown\` + \`team_delete\` it before proceeding. Do not rename the team or run concurrent sessions under the same name.
3. If \`~/.omo/teams/slop-squad/config.json\` is missing, write it using the spec below.

**Team spec** (\`~/.omo/teams/slop-squad/config.json\`):

\`\`\`json
{
  "name": "slop-squad",
  "lead": { "kind": "subagent_type", "subagent_type": "sisyphus" },
  "members": [
    {
      "kind": "category",
      "category": "quick",
      "prompt": "You run $omo:remove-ai-slops on ONE file per task. Load $omo:remove-ai-slops via the skill tool. Read the task description for the file path. Apply the skill's detection criteria verbatim. After edits: run lsp_diagnostics on the file. Report via team_send_message(teamRunId=<id>, to=\"lead\", summary=<change count>, body=<full $omo:remove-ai-slops report>) + team_task_update(status=completed). On ambiguity: send team_send_message(teamRunId=<id>, to=\"lead\", summary=\"UNCLEAR\", body=<reason>) + team_task_update(status=pending). Never git add, never run tests, never touch other files."
    },
    { "kind": "category", "category": "quick", "prompt": "Same contract as peer quick worker." },
    { "kind": "category", "category": "quick", "prompt": "Same contract as peer quick worker." },
    {
      "kind": "category",
      "category": "unspecified-low",
      "prompt": "You are the FIX worker. You claim rework tasks that the lead creates after the external reviewer flags issues. Read the reviewer's per-hunk rollback instructions in the task description, apply the reverse patch, then run $omo:remove-ai-slops ONLY on the non-rolled-back remainder. Same reporting contract as quick peers. Handle UNCLEAR escalations the same way."
    }
  ]
}
\`\`\`

Rationale for this composition:
- **4 workers = team mode's parallel cap.** A fifth member just queues.
- **Reviewer is NOT a team member** — review demands stronger reasoning than category routing provides (team category members are downcast to sisyphus-junior). The reviewer runs OUTSIDE the team as a \`deep\` task; see Phase 3.
- **quick × 3** absorbs the mass of per-file slop removal. **unspecified-low × 1** is the rework lane for fixes triggered by reviewer findings.

**Team lifecycle** (create once, reuse until Phase 5 cleanup):

1. \`team_create(teamName="slop-squad")\`. Record \`teamRunId\` — every subsequent team call needs it.
2. Broadcast the detection criteria ONCE so each task description stays minimal:
   \`\`\`
   team_send_message(
     teamRunId=<id>, to="*", kind="announcement",
     summary="slop-criteria",
     body=<the 9 slop categories + KEEP rules; reference the $omo:remove-ai-slops skill content>
   )
   \`\`\`
3. Before spawning tasks, save a per-file rollback artifact that captures only the delta the slop-removal pass will introduce. Do NOT use \`git checkout -- <file>\` — that would discard pre-existing branch changes.
4. For each changed file, \`team_task_create(teamRunId=<id>, subject="slop: <file>", description=<file path + rollback artifact path + reporting format>, blockedBy=[])\`.

## Phase 3 (team): Incremental reviewer dispatch

While any team task is \`pending | claimed | in_progress\`:

- Wait for \`<system-reminder>\` or member messages. Do NOT tight-poll \`team_status\`; the runtime notifies on state changes. A single \`team_status\` check is acceptable if no notification arrives within roughly 10 seconds of expected completion.
- On each worker completion report:
  - Log the report to the pending final summary (no blocking).
  - Immediately dispatch an **external reviewer** — review runs OUTSIDE the team because team-member category routing downcasts to sisyphus-junior:
    \`\`\`
    task(
      category="deep",
      load_skills=[],
      run_in_background=true,
      description="slop review: <file>",
      prompt=<file path + full worker report + Safety/Behavior/Quality checklist + instruction to output "PASS" or "FAIL:<per-hunk rollback instructions>">
    )
    \`\`\`
    If \`deep\` is unavailable in this session, fall back to \`category="unspecified-high"\`.
- On a reviewer task returning FAIL:
  - Create a rework team task: \`team_task_create(subject="rework: <file>", description=<reverse-patch hunks from reviewer + "then run $omo:remove-ai-slops on remaining non-rolled-back issues only">)\`. The \`unspecified-low\` fix member claims it.
  - Create a new reviewer task paired to the rework completion (same incremental pattern).
- Loop until every file has a PASS from the reviewer AND no team task is outstanding.

## Phase 4 (team): Fix issues

Fixes happen incrementally during Phase 3's loop via rework tasks — this phase is already handled when the loop exits. Any remaining manual fix that neither worker nor fix member could resolve is handled by Lead here, editing files directly.

## Phase 5 (team): Team cleanup

Before producing the summary report, dismantle the team on EVERY exit path — success, escalation, abort — otherwise the next session's Phase 2 precondition check catches the orphan.

1. \`team_shutdown_request\` for each member, then \`team_approve_shutdown\` if members do not self-approve within a reasonable window.
2. \`team_delete(teamRunId=<id>)\`.
3. \`team_list\` to confirm no residual \`slop-squad\` run.

The \`~/.omo/teams/slop-squad/config.json\` declaration file stays on disk; it is reused next session.

## MUST NOT (team mode)

- Lead never edits files directly — orchestrate only. If editing is needed, it goes into a team task.
- Do not inline the full slop-criteria into every task description; rely on the Phase 2 broadcast.
- Do not call \`team_create\` again mid-session. One team per resolution.
- Do not put \`oracle\` / \`librarian\` into the team spec — they are team-ineligible; call them via \`task()\` outside the team when needed.
`
