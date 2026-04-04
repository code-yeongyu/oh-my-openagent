export const GIT_MASTER_REBASE_WORKFLOW_SECTION = `## REBASE MODE (Phase R1-R4)

## PHASE R1: Rebase Context Analysis

<rebase_context>
### R1.1 Parallel Information Gathering

\`\`\`bash
# Execute ALL in parallel
git branch --show-current
git log --oneline -20
git merge-base HEAD main 2>/dev/null || git merge-base HEAD master
git rev-parse --abbrev-ref @{upstream} 2>/dev/null || echo "NO_UPSTREAM"
git status --porcelain
git stash list
\`\`\`

### R1.2 Safety Assessment

| Condition | Risk Level | Action |
|-----------|------------|--------|
| On main/master | CRITICAL | **ABORT** - never rebase main |
| Dirty working directory | WARNING | Stash first: \`git stash push -m "pre-rebase"\` |
| Pushed commits exist | WARNING | Will require force-push; confirm with user |
| All commits local | SAFE | Proceed freely |
| Upstream diverged | WARNING | May need \`--onto\` strategy |

### R1.3 Determine Rebase Strategy

\`\`\`
USER REQUEST -> STRATEGY:

"squash commits" / "cleanup" / "정리"
  -> INTERACTIVE_SQUASH

"rebase on main" / "update branch" / "메인에 리베이스"
  -> REBASE_ONTO_BASE

"autosquash" / "apply fixups"
  -> AUTOSQUASH

"reorder commits" / "커밋 순서"
  -> INTERACTIVE_REORDER

"split commit" / "커밋 분리"
  -> INTERACTIVE_EDIT
\`\`\`
</rebase_context>

---

## PHASE R2: Rebase Execution

<rebase_execution>
### R2.1 Interactive Rebase (Squash/Reorder)

\`\`\`bash
# Find merge-base
MERGE_BASE=$(git merge-base HEAD main 2>/dev/null || git merge-base HEAD master)

# Start interactive rebase
# NOTE: Cannot use -i interactively. Use GIT_SEQUENCE_EDITOR for automation.

# For SQUASH (combine all into one):
git reset --soft $MERGE_BASE
git commit -m "Combined: <summarize all changes>"

# For SELECTIVE SQUASH (keep some, squash others):
# Use fixup approach - mark commits to squash, then autosquash
\`\`\`

### R2.2 Autosquash Workflow

\`\`\`bash
# When you have fixup! or squash! commits:
MERGE_BASE=$(git merge-base HEAD main 2>/dev/null || git merge-base HEAD master)
GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash $MERGE_BASE

# The GIT_SEQUENCE_EDITOR=: trick auto-accepts the rebase todo
# Fixup commits automatically merge into their targets
\`\`\`

### R2.3 Rebase Onto (Branch Update)

\`\`\`bash
# Scenario: Your branch is behind main, need to update

# Simple rebase onto main:
git fetch origin
git rebase origin/main

# Complex: Move commits to different base
# git rebase --onto <newbase> <oldbase> <branch>
git rebase --onto origin/main $(git merge-base HEAD origin/main) HEAD
\`\`\`

### R2.4 Handling Conflicts

\`\`\`
CONFLICT DETECTED -> WORKFLOW:

1. Identify conflicting files:
   git status | grep "both modified"

2. For each conflict:
   - Read the file
   - Understand both versions (HEAD vs incoming)
   - Resolve by editing file
   - Remove conflict markers (<<<<, ====, >>>>)

3. Stage resolved files:
   git add <resolved-file>

4. Continue rebase:
   git rebase --continue

5. If stuck or confused:
   git rebase --abort  # Safe rollback
\`\`\`

### R2.5 Recovery Procedures

| Situation | Command | Notes |
|-----------|---------|-------|
| Rebase going wrong | \`git rebase --abort\` | Returns to pre-rebase state |
| Need original commits | \`git reflog\` -> \`git reset --hard <hash>\` | Reflog keeps 90 days |
| Accidentally force-pushed | \`git reflog\` -> coordinate with team | May need to notify others |
| Lost commits after rebase | \`git fsck --lost-found\` | Nuclear option |
</rebase_execution>

---

## PHASE R3: Post-Rebase Verification

<rebase_verify>
\`\`\`bash
# Verify clean state
git status

# Check new history
git log --oneline $(git merge-base HEAD main 2>/dev/null || git merge-base HEAD master)..HEAD

# Verify code still works (if tests exist)
# Run project-specific test command

# Compare with pre-rebase if needed
git diff ORIG_HEAD..HEAD --stat
\`\`\`

### Push Strategy

\`\`\`
IF branch never pushed:
  -> git push -u origin <branch>

IF branch already pushed:
  -> git push --force-with-lease origin <branch>
  -> ALWAYS use --force-with-lease (not --force)
  -> Prevents overwriting others' work
\`\`\`
</rebase_verify>

---

## PHASE R4: Rebase Report

\`\`\`
REBASE SUMMARY:
  Strategy: <SQUASH | AUTOSQUASH | ONTO | REORDER>
  Commits before: N
  Commits after: M
  Conflicts resolved: K
  
HISTORY (after rebase):
  <hash1> <message1>
  <hash2> <message2>

NEXT STEPS:
  - git push --force-with-lease origin <branch>
  - Review changes before merge
\`\`\``
