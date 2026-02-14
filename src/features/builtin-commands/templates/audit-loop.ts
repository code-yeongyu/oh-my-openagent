export const AUDIT_LOOP_TEMPLATE = `You are starting an Audit Loop - a timeboxed, high-rigor improvement loop focused on top-tier UI quality.

## Mission

Run a repeated cycle until completion promise OR time limit:
1. Audit the codebase deeply (focus UI/UX quality and frontend architecture first)
2. Build and execute a PHASE 10 COMPREHENSIVE PLAN
3. Implement substantial improvements (not a single tiny patch)
4. Verify with tests/build/checks
5. Re-audit and continue

## Non-Negotiable Constraints

- DO NOT modify database-layer logic, migrations, SQL schema, or DB commands
- UI quality must be top-tier and intentional (Apple HIG-inspired interaction quality)
- No AI-slop outputs: avoid generic layouts, weak hierarchy, and superficial restyling
- Keep accessibility, clarity, and visual/system consistency high
- Follow AGENTS.md instructions strictly (root + nearest directory AGENTS.md files for touched code paths); if AGENTS rules conflict, AGENTS.md wins
- Hardcoded component styling is prohibited: use global design tokens/theme primitives/shared UI components only (color/spacing/typography/radius/shadow/motion)
- Required-skills rule: identify task-matched skills from AGENTS.md/skill catalog and use all required skills before implementation

## Focus Lock (Required)

- In cycle 1, choose ONE primary screen/surface as the focus target.
- Keep improving that SAME screen repeatedly each loop (audit -> plan -> implement -> validate -> re-audit).
- For timeboxed runs (default 3h), remain on the same screen for the full timebox unless blocked.
- Do not switch screens unless truly blocked; if switching is unavoidable, explain why and continue with one new screen only.
- Auto-progression rule: when the previous cycle includes SCREEN COMPLETE + Validation PASS + Regression Scan PASS, automatically move to the next highest-impact focus screen in the next cycle (no user instruction required).
- Focus lock hard rule: at least 85% of edited files/changes per cycle must remain in the chosen screen path.
- Switch blocker protocol: if you must switch screens for blocker reasons (not SCREEN COMPLETE progression), first write a BLOCKER REPORT with reason, attempted fixes, and why blocked.

## Execution Hard Rules (Required Every Cycle)

- Parallel research floor: before coding each cycle, launch at least 2 parallel explore/librarian tasks and use findings.
- Adaptive agent policy: start with 2 parallel research agents; escalate to 4-6 when blocked, failing validation, or stagnant cycles.
- Validation hard gate: do not start next loop until analyze/test/build checks were run and results were reported.
- Deterministic validator pipeline: run analyze -> focused tests -> build in this exact order every cycle and report each exit status.
- No-repeat guard: do not repeat the same plan items in consecutive cycles unless retry is required and approach changed.
- Design-system enforcement: prefer tokens/reusable components; avoid one-off inline styles and hardcoded visual values.
- Component-token gate: new/refactored UI components must consume global tokens; reject literal style values unless they are already defined token aliases.
- A11y exit criteria: explicitly verify keyboard navigation, focus visibility/order, semantics/labels, and contrast.
- Anti-micro-patch rule: if changes are too small, continue iterating in the same cycle until substantial improvements are delivered.
- Stagnation protocol: if two consecutive cycles are near-identical, force strategy change (different refactor route + more research agents).
- Time-budget policy per cycle: target ~20% audit/planning, ~50% implementation, ~30% validation + re-audit.
- Max churn guard: avoid re-editing the same saturated file across repeated cycles once quality gates keep passing.
- Required test delta: structural refactors must add or update at least one related test.
- Cycle objective cap: keep Next-Cycle Targets to maximum 3.
- Risk budget: at most one high-risk refactor per cycle.

## Required Cycle Evidence Format

End every cycle with:
- Focus Screen: primary screen path and reason
- Files Changed: list plus primary-screen ratio (%)
- Commands Run: analyze/test/build commands with pass/fail
- Screen Completion Signal: write SCREEN COMPLETE only when the current focus screen is truly complete and validated
- Skill Coverage: Required Skills + Skills Used + why each was applied
- Payload Checklist: structural refactor + removal/simplification + UX/a11y polish
- Remaining UI Debt: unresolved issues and risk notes
- Next-Cycle Targets: prioritized follow-ups on the same screen

## Focus-Screen Completion Lock (Strict)

If \`--completion-promise\` is used, completion is valid ONLY when every gate below is PASS:

- Scope Coverage Gate: enumerate and review all files in the focus-screen path (include reviewed file list in report)
- Issue Closure Gate: close all High/Medium issues for the focus screen, or explicitly waive each with rationale
- Validation Gate: run analyze + related tests + build for touched scope; all required checks must pass
- Accessibility Gate: verify keyboard traversal, focus order/visibility, semantics/labels, and contrast on the focus screen
- Re-Audit Gate: perform a second audit pass after fixes and report no newly introduced High issues
- Evidence Gate: publish a Gate Status table with PASS/FAIL for every gate
- Regression Gate: include Regression Scan PASS each cycle
- A11y Evidence Gate: include keyboard/focus/semantics/contrast checklist with PASS/FAIL
- Test Delta Gate: include Test Delta PASS evidence for structural refactors
- Risk Budget Gate: include High-Risk Refactors count (must be <= 1)
- Objective Cap Gate: Next-Cycle Targets must be <= 3
- Skill Coverage Gate: include Skill Coverage PASS and list Required Skills/Skills Used evidence

If any gate is FAIL or missing evidence, DO NOT output completion promise and continue looping on the same focus screen.

Saturation / Freeze:
- When a focus file is saturated and repeatedly validated, freeze it.
- Do not edit frozen files again unless BUG EVIDENCE or REGRESSION EVIDENCE is provided first.

## PHASE 10 COMPREHENSIVE PLAN (Required Every Cycle)

Before coding, write a concrete 10-phase plan for the current cycle and then execute all phases:

1. Baseline: map current UI architecture and quality gaps
2. Issue Ranking: prioritize highest-impact UI/UX and frontend engineering issues
3. Additions: identify what should be added for quality/completeness
4. Removals: identify what should be removed/simplified/de-duplicated
5. Structural Refactor: improve component boundaries, composition, and maintainability
6. Visual System: typography/spacing/color/hierarchy refinements to production quality
7. Interaction Quality: states, transitions, feedback, and error UX polishing
8. Accessibility: WCAG-aligned semantics, keyboard/focus, contrast, and labels
9. Validation: run tests/build/checks and fix regressions
10. Final Polish + Re-Prioritization: summarize outcomes and queue next cycle targets

Minimum cycle workload:
- Complete all 10 phases before ending a cycle
- Include both "add" and "remove/simplify" changes
- Deliver multiple meaningful improvements, not one minor change
- Keep the same-screen focus lock active while iterating
- Include at least: 1 structural refactor + 1 removal/simplification + 1 UX/a11y polish

## Loop Control

- If \`--completion-promise\` is provided, when fully complete output: \`<promise>{{COMPLETION_PROMISE}}</promise>\`
- If \`--completion-promise\` is omitted, loop will continue until timebox/max-iterations/cancel
- If promise is not output, continuation is injected automatically
- Max iterations: configurable (default 100)
- Max duration: configurable via \`--max-duration\` (default 3h)

## Exit Conditions

1. **Completion**: output completion promise tag
2. **Timebox**: hard stop when max duration is reached
3. **Max Iterations**: stop at iteration cap
4. **Cancel**: user runs \`/cancel-ralph\` or \`/stop-continuation\`

## Arguments

Parse arguments in this format and begin immediately:
\`"task description" [--max-duration=3h] [--completion-promise=TEXT] [--max-iterations=N]\``
