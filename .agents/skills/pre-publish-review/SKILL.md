---
name: pre-publish-review
description: "Nuclear-grade 16-agent pre-publish release gate. Runs /get-unpublished-changes to detect all changes since last npm release, spawns up to 10 ultrabrain agents for deep per-change analysis, invokes /review-work (5 agents) for holistic review, and 1 oracle for overall release synthesis. Use before EVERY npm publish. Triggers: 'pre-publish review', 'review before publish', 'release review', 'pre-release review', 'ready to publish?', 'can I publish?', 'pre-publish', 'safe to publish', 'publishing review', 'pre-publish check'."
---

# Pre-Publish Review — 16-Agent Release Gate

Three-layer review before publishing to npm. Every layer covers a different angle — together they catch what no single reviewer could.

| Layer | Agents | Type | What They Check |
|-------|--------|------|-----------------|
| Per-Change Deep Dive | up to 10 | ultrabrain | Each logical change group individually — correctness, edge cases, pattern adherence |
| Holistic Review | 5 | review-work | Goal compliance, QA execution, code quality, security, context mining across full changeset |
| Release Synthesis | 1 | oracle | Overall release readiness, version bump, breaking changes, deployment risk |

---

## Phase 0: Detect Unpublished Changes

Run `/get-unpublished-changes` FIRST. This is the single source of truth for what changed.

```
skill(name="get-unpublished-changes")
```

This command automatically:
- Detects published npm version vs local version
- Lists all commits since last release
- Reads actual diffs (not just commit messages) to describe REAL changes
- Groups changes by type (feat/fix/refactor/docs) with scope
- Identifies breaking changes
- Recommends version bump (patch/minor/major)

**Save the full output** — it feeds directly into Phase 1 grouping and all agent prompts.

Then capture raw data needed by agent prompts:

```bash
# Extract versions (already in /get-unpublished-changes output)
PUBLISHED=$(npm view oh-my-opencode version 2>/dev/null || echo "not published")
LOCAL=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")

# Raw data for agents (diffs, file lists)
COMMITS=$(git log "v${PUBLISHED}"..HEAD --oneline 2>/dev/null || echo "no commits")
COMMIT_COUNT=$(echo "$COMMITS" | wc -l | tr -d ' ')
DIFF_STAT=$(git diff "v${PUBLISHED}"..HEAD --stat 2>/dev/null || echo "no diff")
CHANGED_FILES=$(git diff --name-only "v${PUBLISHED}"..HEAD 2>/dev/null || echo "none")
FILE_COUNT=$(echo "$CHANGED_FILES" | wc -l | tr -d ' ')
```

If `PUBLISHED` is "not published", this is a first release — use the full git history instead.
---

## Phase 1: Parse Changes into Groups

Use the `/get-unpublished-changes` output as the starting point — it already groups by scope and type.

**Grouping strategy:**
1. Start from the `/get-unpublished-changes` analysis which already categorizes by feat/fix/refactor/docs with scope
2. Further split by **module/area** — changes touching the same module or feature area belong together
3. Target **up to 10 groups**. If fewer than 10 commits, each commit is its own group. If more than 10 logical areas, merge the smallest groups.
4. For each group, extract:
   - **Group name**: Short descriptive label (e.g., "agent-model-resolution", "hook-system-refactor")
   - **Commits**: List of commit hashes and messages
   - **Files**: Changed files in this group
   - **Diff**: The relevant portion of the full diff (`git diff v${PUBLISHED}..HEAD -- {group files}`)

---

## Phase 2: Spawn All Agents

Launch ALL agents in a single turn. Every agent uses `run_in_background=true`. No sequential launches.

### Layer 1: Ultrabrain Per-Change Analysis (up to 10)

For each change group, spawn one ultrabrain agent. Each gets only its portion of the diff — not the full changeset.

```
task(
  category="ultrabrain",
  run_in_background=true,
  load_skills=[],
  description="Deep analysis: {GROUP_NAME}",
  prompt="""
<review_type>PER-CHANGE DEEP ANALYSIS</review_type>
<change_group>{GROUP_NAME}</change_group>

<project>oh-my-opencode (npm package)</project>
<published_version>{PUBLISHED}</published_version>
<target_version>{LOCAL}</target_version>

<commits>
{GROUP_COMMITS — hash and message for each commit in this group}
</commits>

<changed_files>
{GROUP_FILES — files changed in this group}
</changed_files>

<diff>
{GROUP_DIFF — only the diff for this group's files}
</diff>

<file_contents>
{Read and include full content of each changed file in this group}
</file_contents>

You are reviewing a specific subset of changes heading into an npm release. Focus exclusively on THIS change group. Other groups are reviewed by parallel agents.

ANALYSIS CHECKLIST:

1. **Intent Clarity**: What is this change trying to do? Is the intent clear from the code and commit messages? If you have to guess, that's a finding.

2. **Correctness**: Trace through the logic for 3+ scenarios. Does the code actually do what it claims? Off-by-one errors, null handling, async edge cases, resource cleanup.

3. **Breaking Changes**: Does this change alter any public API, config format, CLI behavior, or hook contract? If yes, is it backward compatible? Would existing users be surprised?

4. **Pattern Adherence**: Does the new code follow the established patterns visible in the existing file contents? New patterns where old ones exist = finding.

5. **Edge Cases**: What inputs or conditions would break this? Empty arrays, undefined values, concurrent calls, very large inputs, missing config fields.

6. **Error Handling**: Are errors properly caught and propagated? No empty catch blocks? No swallowed promises?

7. **Type Safety**: Any `as any`, `@ts-ignore`, `@ts-expect-error`? Loose typing where strict is possible?

8. **Test Coverage**: Are the behavioral changes covered by tests? Are the tests meaningful or just coverage padding?

9. **Side Effects**: Could this change break something in a different module? Check imports and exports — who depends on what changed?

10. **Release Risk**: On a scale of SAFE / CAUTION / RISKY — how confident are you this change won't cause issues in production?

OUTPUT FORMAT:
<group_name>{GROUP_NAME}</group_name>
<verdict>PASS or FAIL</verdict>
<risk>SAFE / CAUTION / RISKY</risk>
<summary>2-3 sentence assessment of this change group</summary>
<has_breaking_changes>YES or NO</has_breaking_changes>
<breaking_change_details>If YES, describe what breaks and for whom</breaking_change_details>
<findings>
  For each finding:
  - [CRITICAL/MAJOR/MINOR] Category: Description
  - File: path (line range)
  - Evidence: specific code reference
  - Suggestion: how to fix
</findings>
<blocking_issues>Issues that MUST be fixed before publish. Empty if PASS.</blocking_issues>
""")
```

### Layer 2: Holistic Review via /review-work (5 agents)

Spawn a sub-agent that loads the `/review-work` skill. The review-work skill internally launches 5 parallel agents: Oracle (goal verification), unspecified-high (QA execution), Oracle (code quality), Oracle (security), unspecified-high (context mining). All 5 must pass for the review to pass.

```
task(
  category="unspecified-high",
  run_in_background=true,
  load_skills=["review-work"],
  description="Run /review-work on all unpublished changes",
  prompt="""
Run /review-work on the unpublished changes between v{PUBLISHED} and HEAD.

GOAL: Review all changes heading into npm publish of oh-my-opencode. These changes span {COMMIT_COUNT} commits across {FILE_COUNT} files.

CONSTRAINTS:
- This is a plugin published to npm — public API stability matters
- TypeScript strict mode, Bun runtime
- No `as any`, `@ts-ignore`, `@ts-expect-error`
- Factory pattern (createXXX) for tools, hooks, agents
- kebab-case files, barrel exports, no catch-all files

BACKGROUND: Pre-publish review of oh-my-opencode, an OpenCode plugin with 1268 TypeScript files, 160k LOC. Changes since v{PUBLISHED} are about to be published.

The diff base is: git diff v{PUBLISHED}..HEAD

Follow the /review-work skill flow exactly — launch all 5 review agents and collect results. Do NOT skip any of the 5 agents.
""")
```

### Layer 3: Oracle Release Synthesis (1 agent)

The oracle gets the full picture — all commits, full diff stat, and changed file list. It provides the final release readiness assessment.

```
task(
  subagent_type="oracle",
  run_in_background=true,
  load_skills=[],
  description="Oracle: overall release synthesis and version bump recommendation",
  prompt="""
<review_type>RELEASE SYNTHESIS — OVERALL ASSESSMENT</review_type>

<project>oh-my-opencode (npm package)</project>
<published_version>{PUBLISHED}</published_version>
<local_version>{LOCAL}</local_version>

<all_commits>
{ALL COMMITS since published version — hash, message, author, date}
</all_commits>

<diff_stat>
{DIFF_STAT — files changed, insertions, deletions}
</diff_stat>

<changed_files>
{CHANGED_FILES — full list of modified file paths}
</changed_files>

<full_diff>
{FULL_DIFF — the complete git diff between published version and HEAD}
</full_diff>

<file_contents>
{Read and include full content of KEY changed files — focus on public API surfaces, config schemas, agent definitions, hook registrations, tool registrations}
</file_contents>

You are the final gate before an npm publish. 10 ultrabrain agents are reviewing individual changes and 5 review-work agents are doing holistic review. Your job is the bird's-eye view that those focused reviews might miss.

SYNTHESIS CHECKLIST:

1. **Release Coherence**: Do these changes tell a coherent story? Or is this a grab-bag of unrelated changes that should be split into multiple releases?

2. **Version Bump**: Based on semver:
   - PATCH: Bug fixes only, no behavior changes
   - MINOR: New features, backward-compatible changes
   - MAJOR: Breaking changes to public API, config format, or behavior
   Recommend the correct bump with specific justification.

3. **Breaking Changes Audit**: Exhaustively list every change that could break existing users. Check:
   - Config schema changes (new required fields, removed fields, renamed fields)
   - Agent behavior changes (different prompts, different model routing)
   - Hook contract changes (new parameters, removed hooks, renamed hooks)
   - Tool interface changes (new required params, different return types)
   - CLI changes (new commands, changed flags, different output)
   - Skill format changes (SKILL.md schema changes)

4. **Migration Requirements**: If there are breaking changes, what migration steps do users need? Is there auto-migration in place?

5. **Dependency Changes**: New dependencies added? Dependencies removed? Version bumps? Any supply chain risk?

6. **Changelog Draft**: Write a draft changelog entry grouped by:
   - feat: New features
   - fix: Bug fixes
   - refactor: Internal changes (no user impact)
   - breaking: Breaking changes with migration instructions
   - docs: Documentation changes

7. **Deployment Risk Assessment**:
   - SAFE: Routine changes, well-tested, low risk
   - CAUTION: Significant changes but manageable risk
   - RISKY: Large surface area changes, insufficient testing, or breaking changes without migration
   - BLOCK: Critical issues found, do NOT publish

8. **Post-Publish Monitoring**: What should be monitored after publish? Error rates, specific features, user feedback channels.

OUTPUT FORMAT:
<verdict>SAFE / CAUTION / RISKY / BLOCK</verdict>
<recommended_version_bump>PATCH / MINOR / MAJOR</recommended_version_bump>
<version_bump_justification>Why this bump level</version_bump_justification>
<release_coherence>Assessment of whether changes belong in one release</release_coherence>
<breaking_changes>
  Exhaustive list, or "None" if none.
  For each:
  - What changed
  - Who is affected
  - Migration steps
</breaking_changes>
<changelog_draft>
  Ready-to-use changelog entry
</changelog_draft>
<deployment_risk>
  Overall risk assessment with specific concerns
</deployment_risk>
<monitoring_recommendations>
  What to watch after publish
</monitoring_recommendations>
<blocking_issues>Issues that MUST be fixed before publish. Empty if SAFE.</blocking_issues>
""")
```

---

## Phase 3: Collect Results

As agents complete (system notifications), collect via `background_output(task_id="...")`.

Track completion in a table:

| # | Agent | Type | Status | Verdict |
|---|-------|------|--------|---------|
| 1-10 | Ultrabrain: {group_name} | ultrabrain | pending | — |
| 11 | Review-Work Coordinator | unspecified-high | pending | — |
| 12 | Release Synthesis Oracle | oracle | pending | — |

Do NOT deliver the final report until ALL agents have completed.

---

## Phase 4: Final Verdict

<verdict_logic>

**BLOCK** if:
- Oracle verdict is BLOCK
- Any ultrabrain found CRITICAL blocking issues
- Review-work failed on any MAIN agent

**RISKY** if:
- Oracle verdict is RISKY
- Multiple ultrabrains returned CAUTION or FAIL
- Review-work passed but with significant findings

**CAUTION** if:
- Oracle verdict is CAUTION
- A few ultrabrains flagged minor issues
- Review-work passed cleanly

**SAFE** if:
- Oracle verdict is SAFE
- All ultrabrains passed
- Review-work passed

</verdict_logic>

Compile the final report:

```markdown
# Pre-Publish Review — oh-my-opencode

## Release: v{PUBLISHED} -> v{LOCAL}
**Commits:** {COMMIT_COUNT} | **Files Changed:** {FILE_COUNT} | **Agents:** {AGENT_COUNT}

---

## Overall Verdict: SAFE / CAUTION / RISKY / BLOCK

## Recommended Version Bump: PATCH / MINOR / MAJOR
{Justification from Oracle}

---

## Per-Change Analysis (Ultrabrains)

| # | Change Group | Verdict | Risk | Breaking? | Blocking Issues |
|---|-------------|---------|------|-----------|-----------------|
| 1 | {name} | PASS/FAIL | SAFE/CAUTION/RISKY | YES/NO | {count or "none"} |
| ... | ... | ... | ... | ... | ... |

### Blocking Issues from Per-Change Analysis
{Aggregated from all ultrabrains — deduplicated}

---

## Holistic Review (Review-Work)

| # | Review Area | Verdict | Confidence |
|---|------------|---------|------------|
| 1 | Goal & Constraint Verification | PASS/FAIL | HIGH/MED/LOW |
| 2 | QA Execution | PASS/FAIL | HIGH/MED/LOW |
| 3 | Code Quality | PASS/FAIL | HIGH/MED/LOW |
| 4 | Security | PASS/FAIL | Severity |
| 5 | Context Mining | PASS/FAIL | HIGH/MED/LOW |

### Blocking Issues from Holistic Review
{Aggregated from review-work}

---

## Release Synthesis (Oracle)

### Breaking Changes
{From Oracle — exhaustive list or "None"}

### Changelog Draft
{From Oracle — ready to use}

### Deployment Risk
{From Oracle — specific concerns}

### Post-Publish Monitoring
{From Oracle — what to watch}

---

## All Blocking Issues (Prioritized)
{Deduplicated, merged from all three layers, ordered by severity}

## Recommendations
{If BLOCK/RISKY: exactly what to fix, in priority order}
{If CAUTION: suggestions worth considering before publish}
{If SAFE: non-blocking improvements for future}
```

---

## Anti-Patterns

| Violation | Severity |
|-----------|----------|
| Publishing without waiting for all agents | **CRITICAL** |
| Spawning ultrabrains sequentially instead of in parallel | CRITICAL |
| Using `run_in_background=false` for any agent | CRITICAL |
| Skipping the Oracle synthesis | HIGH |
| Not reading file contents for Oracle (it cannot read files) | HIGH |
| Grouping all changes into 1-2 ultrabrains instead of distributing | HIGH |
| Delivering verdict before all agents complete | HIGH |
| Not including diff in ultrabrain prompts | MAJOR |
