export const GIT_MASTER_COMMIT_EXECUTION_VERIFICATION_SECTION = `## PHASE 4: Commit Strategy Decision

<strategy_decision>
### 4.1 For Each Commit Group, Decide:

\`\`\`
FIXUP if:
  - Change complements existing commit's intent
  - Same feature, fixing bugs or adding missing parts
  - Review feedback incorporation
  - Target commit exists in local history

NEW COMMIT if:
  - New feature or capability
  - Independent logical unit
  - Different issue/ticket
  - No suitable target commit exists
\`\`\`

### 4.2 History Rebuild Decision (Aggressive Option)

\`\`\`
CONSIDER RESET & REBUILD when:
  - History is messy (many small fixups already)
  - Commits are not atomic (mixed concerns)
  - Dependency order is wrong

RESET WORKFLOW:
  1. git reset --soft $(git merge-base HEAD main)
  2. All changes now staged
  3. Re-commit in proper atomic units
  4. Clean history from scratch

ONLY IF:
  - All commits are local (not pushed)
  - User explicitly allows OR branch is clearly WIP
\`\`\`

### 4.3 Final Plan Summary

\`\`\`yaml
EXECUTION_PLAN:
  strategy: FIXUP_THEN_NEW | NEW_ONLY | RESET_REBUILD
  fixup_commits:
    - files: [...]
      target: <hash>
  new_commits:
    - files: [...]
      message: "..."
      level: N
  requires_force_push: true | false
\`\`\`
</strategy_decision>

---

## PHASE 5: Commit Execution

<execution>
### 5.1 Register TODO Items

Use TodoWrite to register each commit as a trackable item:
\`\`\`
- [ ] Fixup: <description> -> <target-hash>
- [ ] New: <description>
- [ ] Rebase autosquash
- [ ] Final verification
\`\`\`

### 5.2 Fixup Commits (If Any)

\`\`\`bash
# Stage files for each fixup
git add <files>
git commit --fixup=<target-hash>

# Repeat for all fixups...

# Single autosquash rebase at the end
MERGE_BASE=$(git merge-base HEAD main 2>/dev/null || git merge-base HEAD master)
GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash $MERGE_BASE
\`\`\`

### 5.3 New Commits (After Fixups)

For each new commit group, in dependency order:

\`\`\`bash
# Stage files
git add <file1> <file2> ...

# Verify staging
git diff --staged --stat

# Commit with detected style
git commit -m "<message-matching-COMMIT_CONFIG>"

# Verify
git log -1 --oneline
\`\`\`

### 5.4 Commit Message Generation

**Based on COMMIT_CONFIG from Phase 1:**

\`\`\`
IF style == SEMANTIC:
  -> Use a semantic prefix + repository language message
  -> Examples:
     - "feat: add login feature"
     - "feat: ログイン機能を追加"
     - "feat: 로그인 기능 추가"

IF style == PLAIN:
  -> Use plain repository language message without semantic prefix
  -> Examples:
     - "Add login feature"
     - "ログイン機能を追加"
     - "로그인 기능 추가"

IF style == SHORT:
  -> "format" / "type fix" / "lint"
\`\`\`

**VALIDATION before each commit:**
1. Does message match detected style?
2. Does message use the repository's dominant language/script profile (from Phase 1.1)?
3. Is it similar to examples from git log?

If ANY check fails -> REWRITE message.
\`\`\`
\</execution>

---

## PHASE 6: Verification & Cleanup

<verification>
### 6.1 Post-Commit Verification

\`\`\`bash
# Check working directory clean
git status

# Review new history
git log --oneline $(git merge-base HEAD main 2>/dev/null || git merge-base HEAD master)..HEAD

# Verify each commit is atomic
# (mentally check: can each be reverted independently?)
\`\`\`

### 6.2 Force Push Decision

\`\`\`
IF fixup was used AND branch has upstream:
  -> Requires: git push --force-with-lease
  -> WARN user about force push implications

IF only new commits:
  -> Regular: git push
\`\`\`

### 6.3 Final Report

\`\`\`
COMMIT SUMMARY:
  Strategy: <what was done>
  Commits created: N
  Fixups merged: M

HISTORY:
  <hash1> <message1>
  <hash2> <message2>
  ...

NEXT STEPS:
  - git push [--force-with-lease]
  - Create PR if ready
\`\`\`
</verification>`
