---
name: review-work
description: "Post-implementation review orchestrator. Uses one comprehensive reviewer by default to verify goals, QA evidence, code quality, relevant security concerns, and project context. Adds a specialist only for a stated concrete risk or unresolved question. MUST USE before a PR handoff or when the user explicitly asks to review completed work. Triggers: 'review work', 'review my work', 'review changes', 'QA my work', 'verify implementation', 'check my work', 'validate changes', 'post-implementation review'."
---

# Review Work

Use one comprehensive reviewer by default. The reviewer evaluates the implementation against the goal and constraints, checks the available QA evidence, examines code quality, considers security concerns relevant to the changed surface, and verifies relevant project context.

Do not split these concerns into parallel review lanes unless a concrete risk or unresolved question requires specialist capability. Before adding a specialist, state the specific reason and the question it must answer. A generic desire for more confidence is not sufficient.

## Harness Routing

In OpenCode, launch the comprehensive reviewer with `task(...)`. In Codex, use the available native subagent surface (`multi_agent_v1.spawn_agent` or `spawn_agent`) and select `lazycodex-gate-reviewer` when available.

The reviewer is a leaf agent. It must not spawn reviewers or restart the workflow. Give it a self-contained assignment with the goal, constraints, changed files, diff, current file contents, required checks, and existing evidence.

## Gather Context

Collect only what the review needs:

- **GOAL**: the user's requested outcome.
- **CONSTRAINTS**: explicit scope, safety, compatibility, and workflow requirements.
- **BACKGROUND**: only context that affects acceptance.
- **REVISION**: the exact commit or worktree state being reviewed.
- **CHANGED_FILES** and **DIFF**: against the appropriate base.
- **FILE_CONTENTS**: current content of changed files and directly relevant neighbors.
- **REQUIRED_CHECKS**: project tests, builds, lint, diagnostics, and acceptance checks that must still run independently of review.
- **QA_EVIDENCE**: commands, outputs, and real-surface artifacts tied to the current revision.
- **UNRESOLVED_FINDINGS**: open findings from an earlier pass, if any.

Review PRs and branches from a dedicated review worktree. The review session's request cwd must be that worktree before running path-scoped tools such as LSP diagnostics; a parent session rooted in the default checkout cannot diagnose files in a sibling worktree. Do not check out, edit, or test the review branch in the default checkout.

Evidence is reusable only when it is tied to the current revision and the reviewed area has not changed since collection. Re-run stale or affected checks. Do not rerun valid unrelated evidence merely because a correction occurred elsewhere.

## Launch One Reviewer

OpenCode pattern:

```text
task(
  category="unspecified-high",
  run_in_background=true,
  load_skills=[relevant project and verification skills],
  description="Review implementation comprehensively",
  prompt="""
TASK: Review the current implementation once, comprehensively.

EXPECTED OUTCOME: Return PASS, REVISE, or FAIL with evidence-backed findings. Cover goal and constraint compliance, required QA evidence, code quality, security concerns relevant to the changed surface, and relevant project context.

REQUIRED TOOLS: Read/search tools, project-required verification commands, and the real product surface when needed.

MUST DO:
- Verify the exact revision and changed files.
- Respect and report every required project test and acceptance check.
- Distinguish blocking findings from nonblocking observations.
- Cite precise file paths and evidence for every blocker.
- Reuse valid evidence tied to the current revision.
- Stop after the verdict. Do not spawn another reviewer.

MUST NOT DO:
- Create parallel review lanes.
- Modify files.
- Re-run unaffected valid checks.
- Treat missing evidence as a pass.
- Recursively review the review process.

CONTEXT:
{GOAL, CONSTRAINTS, BACKGROUND, REVISION, CHANGED_FILES, DIFF,
 FILE_CONTENTS, REQUIRED_CHECKS, QA_EVIDENCE, UNRESOLVED_FINDINGS}
"""
)
```

Codex pattern:

```text
TASK: Review the current implementation once, comprehensively.
DELIVERABLE: PASS, REVISE, or FAIL with evidence-backed blockers and concise nonblocking observations.
SCOPE: Goal and constraints, QA evidence, code quality, relevant security concerns, and relevant project context for the supplied revision and diff.
VERIFY: Execute required checks that lack valid current-revision evidence. Do not modify files or spawn another reviewer.
```

## Add A Specialist Only When Needed

Add at most one specialist when the comprehensive reviewer or the primary agent identifies a concrete risk that requires distinct expertise, such as an unverified authorization boundary, a browser-only visual regression, or an unresolved database migration safety question.

Before launch, record:

- **Reason**: the concrete risk or unresolved question.
- **Scope**: the smallest affected area.
- **Stop condition**: the exact answer or evidence required.

Do not add a specialist for routine code quality, generic security coverage, context mining, or QA already covered by the comprehensive reviewer and required project checks.

## Corrections And Re-Review

Use the existing bounded correction-loop policy. After fixes:

1. Review only changed areas and unresolved findings.
2. Re-run only affected checks; reuse valid evidence from the same current revision.
3. Reuse the reviewer session when its context remains accurate and the harness supports continuation.
4. If replacement is necessary, provide a concise handoff containing the revision, fixed findings, unresolved findings, and current evidence.
5. Do not restart the entire review pipeline after every correction.

Cap correction review at two materially different attempts for the same finding. If an identical finding repeats or the same verification failure is unchanged, diagnose and report the blocker instead of launching another reviewer batch. Do not recursively review the review process.

## Verdict

- **PASS**: all required acceptance checks have valid current-revision evidence and no blocking findings remain.
- **REVISE**: one or more actionable blockers remain and are within scope to correct.
- **FAIL**: the goal or a hard constraint is not met, required evidence cannot be obtained, or the bounded correction loop is exhausted.

Return findings first, ordered by severity, with exact file references and evidence. Keep nonblocking observations concise. Required project tests and acceptance checks remain mandatory regardless of the reviewer verdict.
