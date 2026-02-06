export const REVIEW_LOOP_TEMPLATE = `You are starting a Review Loop - a continuous PR review iteration that runs until no CRITICAL/HIGH issues remain.

## How Review Loop Works

1. You will review the PR diff, identify issues, fix them, commit, and push
2. Then re-review the updated PR to catch any new issues
3. When no CRITICAL/HIGH issues remain, output: \`<promise>REVIEW_COMPLETE</promise>\`
4. Maximum iterations: 10

## Loop Flow

\`\`\`
ITERATION N:
  1. REVIEW    → Launch 4 parallel review subagents on PR diff
  2. FILTER    → Keep only CRITICAL and HIGH severity issues
  3. CLASSIFY  → Split into: auto-fix vs needs-verification
  4. VERIFY    → YOU manually verify CRITICAL + non-consensus issues
  5. DECIDE    → Nothing to fix? EXIT (done) : Continue
  6. FIX       → Fix verified issues (STRICT: only PR files)
  7. COMMIT    → Auto-generate message, commit changes
  8. PUSH      → Push to remote
  9. LOOP      → N < 10? Go to ITERATION N+1 : EXIT (max reached)
\`\`\`

## STEP 0: SETUP

Determine the target branch and get the list of files in the PR:

\`\`\`bash
# Get target branch
TARGET_BRANCH=$ARGUMENTS
if [ -z "$TARGET_BRANCH" ]; then
  TARGET_BRANCH=$(gh pr view --json baseRefName --jq '.baseRefName' 2>/dev/null || \\
    git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || \\
    echo "main")
fi

# Get PR files (this is the STRICT scope - never modify files outside this list)
git diff \${TARGET_BRANCH}...HEAD --name-only
\`\`\`

Store the file list. **You may ONLY modify files in this list throughout all iterations.**

**Edge Case**: If the PR has no changed files (empty diff), output the completion tag immediately:
\`\`\`
If git diff returns empty:
  OUTPUT: "No files changed in PR. Review complete."
  OUTPUT: <promise>REVIEW_COMPLETE</promise>
  EXIT
\`\`\`

**Scope Check**: If ralph-loop is currently active, warn the user but do not block:
\`\`\`
If ralph-loop is running:
  OUTPUT: "Warning: ralph-loop is currently active. Review loop will run in parallel."
\`\`\`

## STEP 1: REVIEW (4 Parallel Subagents)

Launch 4 parallel review subagents. Each reviews the PR diff independently.

\`\`\`
delegate_task(
  category="unspecified-low",
  load_skills=[],
  run_in_background=true,
  description="Review Agent N",
  prompt="<REVIEW_AGENT_PROMPT with PR diff context>"
)
\`\`\`

### Review Subagent Prompt

\`\`\`
You are a code reviewer. Review ONLY the PR diff provided below.

## PR Context
Target branch: {TARGET_BRANCH}
Changed files: {FILE_LIST}
Diff: {git diff TARGET_BRANCH...HEAD}

## What to Review

Read the full files to understand context, but ONLY flag issues in the CHANGED LINES.

**Bugs (Primary Focus):**
- Logic errors, off-by-one, incorrect conditionals
- Missing null/error checks in NEW code
- Security issues: injection, auth bypass, data exposure
- Broken error handling

**Structure:**
- Does new code follow existing patterns?
- Are there established abstractions it should use?

**DO NOT flag:**
- Pre-existing issues (not introduced by this PR)
- Style preferences
- Hypothetical problems
- Code in unchanged lines

## Output Format

For each issue found:
\`\`\`

[SEVERITY] file:line - description

\`\`\`

Severity levels:
- CRITICAL: Will cause crashes, data loss, security breach
- HIGH: Significant bugs, broken functionality
- MEDIUM: Minor bugs, edge cases
- LOW: Style, suggestions, nitpicks

Only report issues you are CERTAIN about. If unsure, investigate first.
\`\`\`

## STEP 2: FILTER

After collecting all 4 subagent results:

1. **Deduplicate** - Group same/similar issues across subagents
   - Deduplication rule: same file + overlapping lines + similar description = same issue
2. **Keep ONLY CRITICAL and HIGH** - Discard MEDIUM and LOW
3. **Verify scope** - Discard any issues in files NOT in the original PR file list
4. **Count consensus** - Track how many subagents found each issue

## STEP 3: CLASSIFY

Split filtered issues into two buckets:

### AUTO-FIX (high confidence, no verification needed)

- Severity: HIGH
- Consensus: 2+ subagents reported the same issue

### NEEDS VERIFICATION (you must manually verify)

- All CRITICAL issues (regardless of consensus) - high stakes
- Non-consensus HIGH issues (only 1 subagent reported it) - uncertain

## STEP 4: VERIFY (Orchestrator Reviews)

For each issue in NEEDS VERIFICATION, YOU must:

1. **Read the actual code** at the reported file:line
2. **Analyze the context** - understand what the code is doing
3. **Determine if it's a real issue** - not a false positive
4. **Decide: FIX or SKIP**

### Verification Template

For each issue requiring verification:

\`\`\`
### Verifying: [CRITICAL] file:line - description
Reported by: N/4 subagents

**Code in question:**
[Read and quote the relevant code]

**Analysis:**
[Your analysis of whether this is a real issue]

**Verdict:** FIX | SKIP
**Reason:** [Why you decided to fix or skip]
\`\`\`

### Verification Criteria

**FIX if:**

- The issue is real and would cause problems
- The code clearly has a bug/vulnerability
- The fix is within scope (PR files only)

**SKIP if:**

- False positive - the code is actually correct
- The subagent misunderstood the logic
- Pre-existing issue (not introduced by this PR)
- Fix would require changes outside PR scope

## STEP 5: DECIDE

Combine:

- Verified issues (CRITICAL/non-consensus that passed verification)
- Auto-fix issues (consensus HIGH)

\`\`\`
IF combined_issues.length == 0:
  OUTPUT: "No issues to fix. Review complete."
  OUTPUT: <promise>REVIEW_COMPLETE</promise>
  EXIT
ELSE:
  CONTINUE to STEP 6
\`\`\`

## STEP 6: FIX

Fix each verified/approved issue.

**STRICT SCOPE RULE:** You may ONLY modify files that were in the original PR diff (from STEP 0).

If a fix would require modifying a file outside the PR:

- DO NOT modify it
- Log: "Cannot fix [issue] - would require modifying [file] which is outside PR scope"
- Skip this issue

After fixing, run lint on changed files to verify no new errors introduced.

## STEP 7: COMMIT

Auto-generate commit message:

\`\`\`bash
# Stage ONLY the files you modified (not all files)
git add <specific-pr-files>
git commit -m "fix: address review issues (iteration N)

Fixed:
- [list of fixed issues]

Skipped:
- [list with reasons: false positive / out of scope / etc]"
\`\`\`

## STEP 8: PUSH

\`\`\`bash
git push
\`\`\`

## STEP 9: LOOP

\`\`\`
iteration++
IF iteration >= 10:
  OUTPUT: "Max iterations (10) reached. Stopping."
  OUTPUT: <promise>REVIEW_COMPLETE</promise>
  EXIT
ELSE:
  GOTO STEP 1
\`\`\`

## VERIFICATION RULES SUMMARY

| Issue Type | Consensus    | Action                                  |
| ---------- | ------------ | --------------------------------------- |
| CRITICAL   | Any          | YOU VERIFY (read code, analyze, decide) |
| HIGH       | 2+ subagents | AUTO-FIX (high confidence)              |
| HIGH       | 1 subagent   | YOU VERIFY (uncertain)                  |
| MEDIUM/LOW | Any          | SKIP (not actionable)                   |

## GUARDRAILS SUMMARY

| Rule                    | Enforcement                        |
| ----------------------- | ---------------------------------- |
| Verify CRITICAL issues  | STEP 4 - you read code and decide  |
| Verify non-consensus    | STEP 4 - you read code and decide  |
| Auto-fix consensus HIGH | STEP 3 - skip verification         |
| Only modify PR files    | Check against STEP 0 file list     |
| Max 10 iterations       | Counter check in STEP 9            |
| Re-review entire PR     | STEP 1 always reviews full diff    |
| No human in loop        | All decisions made by orchestrator |

## EXIT CONDITIONS

1. **Success**: No CRITICAL/HIGH issues found after review
2. **All skipped**: All issues were false positives or out of scope
3. **Max iterations**: Reached 10 iterations
4. **Empty PR**: No files changed in the PR
5. **Manual cancel**: User runs \`/cancel-review-loop\` or Ctrl+C

## NOW: START THE LOOP

1. Run STEP 0 to get target branch and file list
2. Set iteration = 1
3. Begin STEP 1
`
