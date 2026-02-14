import { SYSTEM_DIRECTIVE_PREFIX } from "../../shared/system-directive"
import type { RalphLoopState } from "./types"

const CONTINUATION_PROMPT = `${SYSTEM_DIRECTIVE_PREFIX} - RALPH LOOP {{ITERATION}}/{{MAX}}]

Your previous attempt did not output the completion promise. Continue working on the task.

IMPORTANT:
- Review your progress so far
- Continue from where you left off
- When FULLY complete, output: <promise>{{PROMISE}}</promise>
- Do not stop until the task is truly done

Original task:
{{PROMPT}}`

const AUDIT_LOOP_CONTINUATION_PROMPT = `${SYSTEM_DIRECTIVE_PREFIX} - AUDIT LOOP {{ITERATION}}/{{MAX}}]

Continue the audit-improve cycle with UI-first focus.

MANDATORY RULES:
- DO NOT modify Supabase database-related logic, migrations, SQL schema, or DB commands
- Follow AGENTS.md instructions strictly (root + nearest AGENTS.md files in edited directories); if AGENTS rules conflict, AGENTS.md wins
- Required-skills rule: identify task-matched skills and use all required skills for the cycle
- Prioritize top-tier UI quality inspired by production standards (Apple HIG-level rigor)
- No AI-slop patterns: avoid generic layouts and superficial cosmetic edits
- Maintain strong visual hierarchy, accessibility, interaction quality, and design consistency
- Hardcoded component styling is prohibited: use global design tokens/theme primitives/shared UI components only
- Validate each iteration (tests/build/checks when applicable)
- Start by writing a PHASE 10 COMPREHENSIVE PLAN (add/remove/refactor/polish)
- Execute all 10 phases before considering this cycle complete
- Do not stop after one small patch; perform a substantial multi-change cycle
- Keep improving the SAME primary screen selected in iteration 1; do not switch screens unless blocked
- At least 85% of file edits must stay in the primary screen path
- Auto-progression rule: if previous cycle shows SCREEN COMPLETE + Validation PASS + Regression Scan PASS, switch once to the next highest-impact screen automatically (no user instruction and no blocker report needed)
- If switching screens for blocker reasons (not SCREEN COMPLETE progression), first write BLOCKER REPORT: reason, attempted fixes, why blocked
- Before coding each cycle, run at least 2 parallel explore/librarian research tasks
- Adaptive agent policy: increase research agents to 4-6 when blocked, validation fails, or stagnation is detected
- Do not start next loop until analyze/test/build checks are run and reported
- Deterministic validator pipeline: run analyze -> focused tests -> build in that order with explicit pass/fail
- Regression gate: include Regression Scan PASS in cycle evidence before new implementation
- Do not repeat identical plan items across consecutive loops unless retry strategy changed
- Use design tokens/reusable components, avoid one-off inline hardcoded visual styles
- Component-token gate: new/refactored UI components must consume global tokens; reject literal style values unless they are token aliases
- Explicitly verify keyboard navigation, focus order/visibility, semantics/labels, and contrast
- Payload minimum per cycle: structural refactor + removal/simplification + UX/a11y polish
- Required test delta: structural refactors must add/update at least one related test
- Risk budget: maximum one high-risk refactor per cycle
- Objective cap: keep Next-Cycle Targets to at most 3 items
- If changes are too small, continue same cycle (anti-micro-patch)
- Focus-Screen Completion Lock: if using completion promise, only complete when all gates pass (Scope Coverage, Issue Closure, Validation, Accessibility, Re-Audit, Evidence)
- Time-budget policy per cycle: spend ~20% on audit/planning, ~50% on implementation, ~30% on validation/re-audit
- File freeze rule: saturated files stay locked unless BUG EVIDENCE or REGRESSION EVIDENCE is supplied

Required end-of-cycle evidence:
- Focus Screen
- Files Changed + primary-screen ratio (%)
- Commands Run + pass/fail
- Screen Completion Signal (SCREEN COMPLETE only when current focus screen is complete + validated)
- Payload Checklist
- Remaining UI Debt
- Next-Cycle Targets on same screen
- Gate Status table (PASS/FAIL for Scope Coverage, Issue Closure, Validation, Accessibility, Re-Audit, Evidence)
- Skill Coverage (Required Skills + Skills Used + PASS/FAIL)

Only when all 10 phases are genuinely completed and validated AND every completion-lock gate is PASS, output: <promise>{{PROMISE}}</promise>

Original task:
{{PROMPT}}`

const AUDIT_LOOP_CONTINUATION_NO_PROMISE_PROMPT = `${SYSTEM_DIRECTIVE_PREFIX} - AUDIT LOOP {{ITERATION}}/{{MAX}}]

Continue the audit-improve cycle with UI-first focus.

MANDATORY RULES:
- DO NOT modify Supabase database-related logic, migrations, SQL schema, or DB commands
- Follow AGENTS.md instructions strictly (root + nearest AGENTS.md files in edited directories); if AGENTS rules conflict, AGENTS.md wins
- Required-skills rule: identify task-matched skills and use all required skills for the cycle
- Prioritize top-tier UI quality inspired by production standards (Apple HIG-level rigor)
- No AI-slop patterns: avoid generic layouts and superficial cosmetic edits
- Maintain strong visual hierarchy, accessibility, interaction quality, and design consistency
- Hardcoded component styling is prohibited: use global design tokens/theme primitives/shared UI components only
- Validate each iteration (tests/build/checks when applicable)
- Start by writing a PHASE 10 COMPREHENSIVE PLAN (add/remove/refactor/polish)
- Execute all 10 phases before ending the cycle
- Include both additive improvements and simplification/removal improvements
- Keep improving the SAME primary screen selected in iteration 1; do not switch screens unless blocked
- At least 85% of file edits must stay in the primary screen path
- Auto-progression rule: if previous cycle shows SCREEN COMPLETE + Validation PASS + Regression Scan PASS, switch once to the next highest-impact screen automatically (no user instruction and no blocker report needed)
- If switching screens for blocker reasons (not SCREEN COMPLETE progression), first write BLOCKER REPORT: reason, attempted fixes, why blocked
- Before coding each cycle, run at least 2 parallel explore/librarian research tasks
- Adaptive agent policy: increase research agents to 4-6 when blocked, validation fails, or stagnation is detected
- Do not start next loop until analyze/test/build checks are run and reported
- Deterministic validator pipeline: run analyze -> focused tests -> build in that order with explicit pass/fail
- Regression gate: include Regression Scan PASS in cycle evidence before new implementation
- Do not repeat identical plan items across consecutive loops unless retry strategy changed
- Use design tokens/reusable components, avoid one-off inline hardcoded visual styles
- Component-token gate: new/refactored UI components must consume global tokens; reject literal style values unless they are token aliases
- Explicitly verify keyboard navigation, focus order/visibility, semantics/labels, and contrast
- Payload minimum per cycle: structural refactor + removal/simplification + UX/a11y polish
- Required test delta: structural refactors must add/update at least one related test
- Risk budget: maximum one high-risk refactor per cycle
- Objective cap: keep Next-Cycle Targets to at most 3 items
- If changes are too small, continue same cycle (anti-micro-patch)
- Apply Focus-Screen Completion Lock discipline every cycle (Scope Coverage, Issue Closure, Validation, Accessibility, Re-Audit, Evidence)
- Time-budget policy per cycle: spend ~20% on audit/planning, ~50% on implementation, ~30% on validation/re-audit
- File freeze rule: saturated files stay locked unless BUG EVIDENCE or REGRESSION EVIDENCE is supplied

Required end-of-cycle evidence:
- Focus Screen
- Files Changed + primary-screen ratio (%)
- Commands Run + pass/fail
- Screen Completion Signal (SCREEN COMPLETE only when current focus screen is complete + validated)
- Payload Checklist
- Remaining UI Debt
- Next-Cycle Targets on same screen
- Gate Status table (PASS/FAIL for Scope Coverage, Issue Closure, Validation, Accessibility, Re-Audit, Evidence)
- Skill Coverage (Required Skills + Skills Used + PASS/FAIL)

Do NOT stop early. Keep iterating until timebox, max iterations, or explicit user stop command.

Original task:
{{PROMPT}}`

const TIMEOUT_SUMMARY_PROMPT = `${SYSTEM_DIRECTIVE_PREFIX} - RALPH LOOP TIMEBOX ENDED]

Hard time limit reached. STOP implementation now.

Provide a final report only:
1. Highest-impact issues found
2. Improvements completed
3. Validation results (tests/build/checks)
4. Remaining risks / unfinished items
5. Suggested next wave priorities
`

export function buildContinuationPrompt(state: RalphLoopState): string {
  const useAuditTemplateWithoutPromise =
    state.mode === "audit-loop" && state.completion_detection_enabled === false
	const baseTemplate =
		state.mode === "audit-loop"
      ? useAuditTemplateWithoutPromise
        ? AUDIT_LOOP_CONTINUATION_NO_PROMISE_PROMPT
        : AUDIT_LOOP_CONTINUATION_PROMPT
      : CONTINUATION_PROMPT

	const continuationPrompt = baseTemplate.replace(
		"{{ITERATION}}",
		String(state.iteration),
	)
		.replace("{{MAX}}", String(state.max_iterations))
		.replace("{{PROMISE}}", state.completion_promise)
		.replace("{{PROMPT}}", state.prompt)

	return state.ultrawork ? `ultrawork ${continuationPrompt}` : continuationPrompt
}

export function buildTimeoutSummaryPrompt(state: RalphLoopState): string {
  if (state.mode === "audit-loop") {
    return `${TIMEOUT_SUMMARY_PROMPT}

Audit-loop specific constraints reminder:
- Confirm that no Supabase DB mutation was performed.
- Keep recommendations UI-first and production-grade.
- Confirm AGENTS.md instructions were followed for touched paths.
- Confirm UI styling changes use global tokens/shared components (no hardcoded literal visual values).
- Include final Gate Status table for the focus-screen completion lock.
- Include final Skill Coverage evidence (Required Skills + Skills Used + PASS/FAIL).
`
  }

  return TIMEOUT_SUMMARY_PROMPT
}
