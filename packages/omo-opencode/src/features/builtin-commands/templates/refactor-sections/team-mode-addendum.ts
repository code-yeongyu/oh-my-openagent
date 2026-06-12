export const REFACTOR_TEAM_MODE_ADDENDUM = `
---

# Team Mode Protocol (active when team_* tools are present)

Team mode is enabled for this session. The rules below **override Phase 4-6** above. Follow this protocol instead of the in-session step-by-step execution.

## Phase 4 override: Plan agent staffing requirement

When invoking the Plan agent in Phase 4.1, append this additional requirement to the prompt:

\`\`\`
7. (REQUIRED when team mode is active) Output a Team Staffing Recommendation section with these fields — missing fields fail Phase 5.0:
   - total_atomic_steps: integer
   - file_independent_steps: integer (parallelizable, no cross-file blocker)
   - cross_file_dependent_steps: integer (has blockers)
   - per_step_assignment: [{step_id, assigned_to: 'quick' | 'unspecified-low', blockedBy: [step_ids], rationale}]
   - dispatch_path_recommendation: 'team' | 'legacy' with reason
   - rationale for the composition
\`\`\`

**Classification rules** the plan agent must apply to each step:
- \`quick\`: mechanical edits — LSP rename, extract variable, inline, simple move, signature change without call-site logic.
- \`unspecified-low\`: logic-preserving refactors that need reasoning — extract function, restructure conditional, pattern transformation, cross-file API change.
- Recommend \`team\` path when \`file_independent_steps >= 3\`; recommend \`legacy\` otherwise.

## Phase 5 override: Dispatch path selection

Read the Team Staffing Recommendation from Phase 4. If any required field is missing, fail here and re-request the plan with the exact missing field names. Do not proceed with a partial plan.

Then choose the path:

- **Team path (5.1-T)**: when the plan recommends \`team\` AND \`file_independent_steps >= 3\`. Members execute in parallel, Lead orchestrates, a \`deep\` verifier lives outside the team.
- **Legacy path (5.1-L)**: otherwise. Use the original 5.1 / 5.2 / 5.3 flow from above.

Record the chosen path in the TodoWrite list.

## Phase 5.1-T: \`refactor-squad\` team execution

**Precondition checks** (fail hard if any step fails):

1. Load the \`team-mode\` skill via the \`skill\` tool for lifecycle, message protocol, and limits.
2. Call \`team_list\` and verify no active \`refactor-squad\` run exists; if one does, shutdown + delete the orphan before proceeding.
3. If \`~/.omo/teams/refactor-squad/config.json\` is missing, write it using the spec below.

**Team spec** (\`~/.omo/teams/refactor-squad/config.json\`):

\`\`\`json
{
  "name": "refactor-squad",
  "lead": { "kind": "subagent_type", "subagent_type": "sisyphus" },
  "members": [
    {
      "kind": "category",
      "category": "quick",
      "prompt": "You handle mechanical refactoring steps (LSP rename, extract variable, inline, simple move, signature change). Use LSP tools for correctness. Apply the task description's per-step instructions verbatim — no scope expansion. After edits, run lsp_diagnostics on touched files. Report via team_send_message(teamRunId=<id>, to=\"lead\", summary=<files touched>, body=<lsp status + diff summary>) + team_task_update(status=completed). Never run tests — the external verifier handles that. Never git add, never --continue."
    },
    { "kind": "category", "category": "quick", "prompt": "Same contract as peer quick worker." },
    {
      "kind": "category",
      "category": "unspecified-low",
      "prompt": "You handle logic-preserving refactors that need reasoning (extract function, restructure conditional, pattern transformation, cross-file API change). Read the task description's plan step carefully. Use ast_grep_replace with dryRun=true first, review the preview, then execute. If the step is ambiguous or would require out-of-scope changes, STOP and send team_send_message(teamRunId=<id>, to=\"lead\", summary=\"UNCLEAR\", body=<reason>) + team_task_update(status=pending). Same reporting contract as peer quick workers. Never run tests."
    },
    { "kind": "category", "category": "unspecified-low", "prompt": "Same contract as peer unspecified-low worker." }
  ]
}
\`\`\`

Rationale for this composition:
- **4 workers = team mode's parallel cap.** 5+ just queues.
- **No verifier team member.** Verification needs \`deep\` reasoning (or \`unspecified-high\` fallback). In-team category routing downcasts to sisyphus-junior, which is weaker than required — the verifier runs OUTSIDE the team as a \`task(category="deep")\`.
- **quick × 2** for mechanical edits, **unspecified-low × 2** for reasoning edits — mirrors the plan's split.

**Team lifecycle** (one team, reused until Phase 6 cleanup):

1. \`team_create(teamName="refactor-squad")\`. Record \`teamRunId\`.
2. Broadcast the refactor Intent Card ONCE (keep task descriptions slim):
   \`\`\`
   team_send_message(
     teamRunId=<id>, to="*", kind="announcement",
     summary="refactor-intent",
     body=<codemap summary + constraints + established patterns from Phase 2>
   )
   \`\`\`
3. Broadcast the verification spec ONCE:
   \`\`\`
   team_send_message(
     teamRunId=<id>, to="*", kind="announcement",
     summary="verify-spec",
     body=<exact test/typecheck/lint commands + expected pass counts + regression indicators from Phase 3.4>
   )
   \`\`\`
4. For each plan step, \`team_task_create(teamRunId=<id>, subject="refactor step <N>: <short>", description=<per-step instructions from plan, including target files and line ranges, rollback strategy>, blockedBy=<from plan's per_step_assignment>)\`.

**Lead monitoring loop**:

While any team task is \`pending | claimed | in_progress\`:

- Wait for \`<system-reminder>\` or member messages. Avoid tight polling; a single \`team_status\` check is acceptable if no notification arrives within roughly 10 seconds of expected completion.
- On a worker completion report, immediately dispatch an **external verifier** — verification runs OUTSIDE the team because team-member category routing downcasts to sisyphus-junior:
  \`\`\`
  task(
    category="deep",
    load_skills=[],
    run_in_background=true,
    description="verify step <N>",
    prompt=<files touched + verify-spec commands + instruction to return "PASS" or "FAIL:<failing test + specific error + suggested revert hunks>">
  )
  \`\`\`
  If \`deep\` is unavailable, fall back to \`category="unspecified-high"\`. Do not create a commit checkpoint until the verifier returns PASS.
- On a verifier PASS: make the commit checkpoint for that step (see original 5.3). Proceed.
- On a verifier FAIL: Lead decides:
  - **Retry with fix hint**: \`team_task_update(status=pending)\` on the original step + \`team_send_message(teamRunId=<id>, to=<original member>, summary="retry", body=<specific failure from verifier>)\`. Runtime reassigns.
  - **Escalate**: after three FAIL cycles on the same step, STOP and consult the user with full evidence.
- On a member UNCLEAR message: re-harvest context via a targeted \`task()\` outside the team, broadcast an updated Intent Card fragment, then reassign.

Proceed to Phase 6 only when every team task is \`completed\` AND every paired verifier task returned PASS.

## Phase 6 override: Team cleanup before summary

If Phase 5 used the team path, dismantle \`refactor-squad\` BEFORE producing the 6.6 summary. Every exit path — success, escalation, abort — must cleanup; orphan teams poison the next session's precondition check.

1. \`team_shutdown_request\` for each member, then \`team_approve_shutdown\` if members do not self-approve within a reasonable window.
2. \`team_delete(teamRunId=<id>)\`.
3. \`team_list\` to confirm no residual \`refactor-squad\` run.

The \`~/.omo/teams/refactor-squad/config.json\` declaration stays on disk; next session reuses it.

Append to the 6.6 summary a "Dispatch path" line and, when team path was used, team metrics (teamRunId, tasks created, verifier runs, team lifetime).

## MUST NOT (team mode)

- Lead never edits files directly — orchestrate only.
- Do not inline the Intent Card or verify-spec into task descriptions — rely on the broadcasts.
- Do not recreate the team mid-session.
- Do not run tests from Lead — the external verifier owns that lane.
- Do not put \`oracle\` / \`librarian\` / \`deep\` into the team spec — oracle/librarian are team-ineligible, and \`deep\` under category routing downcasts to sisyphus-junior. Use them via \`task()\` outside the team when needed.
`
