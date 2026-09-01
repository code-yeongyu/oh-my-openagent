export const GIT_MASTER_COMMIT_CONTEXT_ANALYSIS_SECTION = `## PHASE 0: Parallel Context Gathering (MANDATORY FIRST STEP)

<parallel_analysis>
**Execute ALL of the following commands IN PARALLEL to minimize latency:**

\`\`\`bash
# Group 1: Current state
git status
git diff --staged --stat
git diff --stat

# Group 2: History context
git log -30 --oneline
git log -30 --pretty=format:"%s"

# Group 3: Branch context
git branch --show-current
git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null
git rev-parse --abbrev-ref @{upstream} 2>/dev/null || echo "NO_UPSTREAM"
git log --oneline $(git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null)..HEAD 2>/dev/null
\`\`\`

**Capture these data points simultaneously:**
1. What files changed (staged vs unstaged)
2. Recent 30 commit messages for style detection
3. Branch position relative to main/master
4. Whether branch has upstream tracking
5. Commits that would go in PR (local only)
</parallel_analysis>

---

## PHASE 1: Style Detection (BLOCKING - MUST OUTPUT BEFORE PROCEEDING)

<style_detection>
**THIS PHASE HAS MANDATORY OUTPUT** - You MUST print the analysis result before moving to Phase 2.

### 1.1 Language Profile Detection

\`\`\`
Count from git log -30:
- Dominant language/script patterns: N commits
- Secondary language/script patterns: M commits
- Mixed/ambiguous: K commits

DECISION:
- Preserve the dominant repository language pattern in commit messages
- If multiple languages are common, follow the nearest recent examples for the same module
- Never restrict output to specific languages; support any language used by the repo (e.g., Japanese, Korean, English, etc.)
\`\`\`

### 1.2 Commit Style Classification

| Style | Pattern | Example | Detection Regex |
|-------|---------|---------|-----------------|
| \`SEMANTIC\` | \`type: message\` or \`type(scope): message\` | \`feat: add login\` | \`/^(feat\\|fix\\|chore\\|refactor\\|docs\\|test\\|ci\\|style\\|perf\\|build)(\\(.+\\))?:/\` |
| \`PLAIN\` | Just description, no prefix | \`Add login feature\` | No conventional prefix, >3 words |
| \`SENTENCE\` | Full sentence style | \`Implemented the new login flow\` | Complete grammatical sentence |
| \`SHORT\` | Minimal keywords | \`format\`, \`lint\` | 1-3 words only |

**Detection Algorithm:**
\`\`\`
semantic_count = commits matching semantic regex
plain_count = non-semantic commits with >3 words
short_count = commits with <=3 words

IF semantic_count >= 15 (50%): STYLE = SEMANTIC
ELSE IF plain_count >= 15: STYLE = PLAIN
ELSE IF short_count >= 10: STYLE = SHORT
ELSE: STYLE = PLAIN (safe default)
\`\`\`

### 1.3 MANDATORY OUTPUT (BLOCKING)

**You MUST output this block before proceeding to Phase 2. NO EXCEPTIONS.**

\`\`\`
STYLE DETECTION RESULT
======================
Analyzed: 30 commits from git log

Language profile: [DOMINANT_LANGUAGE_OR_SCRIPT]
  - Dominant pattern: N (X%)
  - Secondary pattern: M (Y%)

Style: [SEMANTIC | PLAIN | SENTENCE | SHORT]
  - Semantic (feat:, fix:, etc): N (X%)
  - Plain: M (Y%)
  - Short: K (Z%)

Reference examples from repo:
  1. "actual commit message from log"
  2. "actual commit message from log"
  3. "actual commit message from log"

All commits will follow: [DOMINANT_LANGUAGE_OR_SCRIPT] + [STYLE]
\`\`\`

**IF YOU SKIP THIS OUTPUT, YOUR COMMITS WILL BE WRONG. STOP AND REDO.**
</style_detection>

---

## PHASE 2: Branch Context Analysis

<branch_analysis>
### 2.1 Determine Branch State

\`\`\`
BRANCH_STATE:
  current_branch: <name>
  has_upstream: true | false
  commits_ahead: N  # Local-only commits
  merge_base: <hash>

REWRITE_SAFETY:
  - If has_upstream AND commits_ahead > 0 AND already pushed:
    -> WARN before force push
  - If no upstream OR all commits local:
    -> Safe for aggressive rewrite (fixup, reset, rebase)
  - If on main/master:
    -> NEVER rewrite, only new commits
\`\`\`

### 2.2 History Rewrite Strategy Decision

\`\`\`
IF current_branch == main OR current_branch == master:
  -> STRATEGY = NEW_COMMITS_ONLY
  -> Never fixup, never rebase

ELSE IF commits_ahead == 0:
  -> STRATEGY = NEW_COMMITS_ONLY
  -> No history to rewrite

ELSE IF all commits are local (not pushed):
  -> STRATEGY = AGGRESSIVE_REWRITE
  -> Fixup freely, reset if needed, rebase to clean

ELSE IF pushed but not merged:
  -> STRATEGY = CAREFUL_REWRITE
  -> Fixup OK but warn about force push
\`\`\`
</branch_analysis>`
