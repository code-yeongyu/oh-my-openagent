import type { BuiltinSkill } from "../types"

const SOFTWARE_DEV_SKILL_NAME = "software-dev"

const SOFTWARE_DEV_SKILL_DESCRIPTION =
  "Structured software development pipeline: PLAN → BUILD (TDD) → VERIFY → REVIEW → SECURE → SHIP. Coordinates specialized roles (Developer, Tester, Quality Evaluator, Security Expert, Architect) through a 6-phase workflow with entry/exit criteria. Triggers: 'build feature', 'implement', 'develop', 'software development', 'dev pipeline', 'development workflow', 'code and test', 'full stack development'."

export const softwareDevSkill: BuiltinSkill = {
  name: SOFTWARE_DEV_SKILL_NAME,
  description: SOFTWARE_DEV_SKILL_DESCRIPTION,
  template: `# Software Development Pipeline — Structured Team Orchestration

## OVERVIEW

This skill defines a 6-phase software development pipeline with specialized roles. Each phase has entry/exit criteria. No phase can be skipped without justification.

**Use this skill for:**
- New features (3+ files)
- Significant refactors
- Any work benefiting from structured development

**Do NOT use for:**
- Trivial fixes (1-2 lines)
- Documentation-only changes
- Exploration tasks

---

## TEAM ROLES

| Role | Delegate To | Skills | Purpose |
|------|-------------|--------|---------|
| Architect | \`subagent_type="oracle"\` | — | Design, architecture decisions |
| Developer | \`category="source"\` | git-master, tdd-enforcer | Implementation + tests |
| Quality Evaluator | \`category="red-pill"\` | quality-gate, review-work | Lint, typecheck, review |
| Security Expert | \`subagent_type="sentinel"\` | security-core, security-sast, security-api, security-dependencies | Security audit |

---

## PIPELINE

| Phase | Skip? | Role | Exit Criteria |
|-------|-------|------|---------------|
| 1. PLAN | Small tasks | Architect | Approach defined, files listed |
| 2. BUILD | Never | Developer | Code written, tests pass |
| 3. VERIFY | Never | Quality | Lint/typecheck/test/build pass |
| 4. REVIEW | Small tasks | Quality (5-agent) | All reviewers PASS |
| 5. SECURE | Small + non-security | Security | No CRITICAL/HIGH findings |
| 6. SHIP | Never | Developer | Commits + PR created |

**Task Size Rules:**
- **Small (1-2 files):** BUILD → VERIFY → SHIP only
- **Medium (3-10 files):** PLAN → BUILD → VERIFY → REVIEW → SHIP
- **Large (10+ files):** ALL 6 PHASES
- **Security-related (any size):** Always include SECURE

---

## PHASE 1: PLAN

Fire architecture planning:

\`\`\`
task(
  subagent_type="oracle",
  load_skills=[],
  run_in_background=true,
  description="Plan implementation approach",
  prompt="Plan implementation for: {REQUEST}\\n\\nContext: {CODEBASE_CONTEXT}\\n\\nDeliver: approach, file list, edge cases, dependency order.")
\`\`\`

**Exit criteria:**
- [ ] Implementation approach defined
- [ ] File list with responsibilities
- [ ] Edge cases documented

---

## PHASE 2: BUILD (TDD)

For each file in dependency order:

\`\`\`
task(
  category="source",
  load_skills=["git-master", "tdd-enforcer"],
  run_in_background=true,
  description="Implement {FEATURE}",
  prompt="Implement from plan:\\n{PLAN}\\n\\nFile: {PATH}\\n\\nFollow tdd-enforcer: write test FIRST (RED), then minimum code (GREEN), then refactor. Run bun test after each change.")
\`\`\`

**Exit criteria:**
- [ ] All code written
- [ ] Tests written BEFORE implementation
- [ ] \`bun test\` — 0 failures

---

## PHASE 3: VERIFY

Run verification suite:

\`\`\`bash
bun run lint && bun run typecheck && bun test && bun run build
\`\`\`

Report evidence:
\`\`\`
✅ bun run lint — 0 issues
✅ bun run typecheck — no errors
✅ bun test — N passed, 0 failed
✅ bun run build — success
\`\`\`

If ANY fails → fix → re-run ALL.

**Exit criteria:**
- [ ] All 4 checks pass

---

## PHASE 4: REVIEW

Fire 5-agent parallel review:

\`\`\`
task(
  category="red-pill",
  load_skills=["quality-gate", "review-work"],
  run_in_background=true,
  description="Review implementation",
  prompt="Review completed implementation using review-work skill.\\n\\nGoal: {REQUEST}\\nFiles: {CHANGED_FILES}\\nDiff: {DIFF}")
\`\`\`

**Exit criteria:**
- [ ] All 5 reviewers PASS
- [ ] No CRITICAL/MAJOR blocking issues

---

## PHASE 5: SECURE

Fire security audit:

\`\`\`
task(
  subagent_type="sentinel",
  load_skills=["security-core", "security-sast", "security-api", "security-dependencies"],
  run_in_background=true,
  description="Security audit",
  prompt="Security audit on:\\n{CHANGED_FILES}\\n\\nDiff:\\n{DIFF}\\n\\nCheck: input validation, auth, secrets, injection, dependencies.")
\`\`\`

**Exit criteria:**
- [ ] No CRITICAL findings
- [ ] No HIGH findings

---

## PHASE 6: SHIP

\`\`\`
task(
  category="bullet-time",
  load_skills=["git-master"],
  run_in_background=false,
  description="Create commits and PR",
  prompt="Create atomic commits for implementation.\\n\\nFiles: {CHANGED_FILES}\\n\\nFollow git-master conventions. Target dev branch.")
\`\`\`

**Exit criteria:**
- [ ] Clean atomic commits
- [ ] PR targeting dev branch
- [ ] CI passes

---

## PIPELINE STATUS

Report after each phase:

\`\`\`
Pipeline Status:
  ✅ PLAN — Complete
  ✅ BUILD — Complete (N tests pass)
  ✅ VERIFY — Complete (all checks pass)
  🔄 REVIEW — In progress...
  ⬜ SECURE — Pending
  ⬜ SHIP — Pending
\`\`\`

If phase fails → STOP → fix → re-run that phase.

---

## ANTI-PATTERNS

| Anti-Pattern | Correct Action |
|-------------|----------------|
| Skip PLAN for large tasks | Plan first — you'll miss edge cases |
| Skip TDD in BUILD | Write test FIRST, always |
| Skip VERIFY | Run full suite before proceeding |
| Skip REVIEW for medium+ | Review catches quality issues |
| Skip SECURE for auth work | Security audit required |
| Proceed after phase failure | Fix first, then continue |
| Report done without evidence | Show verification output |
`,
}
