# Plan: plan-gate hardening for metis/momus (a+b)

Approved design (session 019fbbe3): the invocation gate for plan-gated agents must require
BOTH an explicit USER request of ulw-plan AND a plan artifact touched in-session; SKILL.md
read alone must no longer open the gate; denial messages must not coach self-unlock; the
ulw-plan skill description must state explicit-user-request-only activation.

## Changes
1. packages/senpi-task/src/agents/invocation-guard.ts
   - SkillInvocationState += hasUserRequested(skill), hasPlanArtifact()
   - AgentInvocationCondition += requiresPlanArtifact: boolean (metis/momus: true)
   - evaluateInvocationGuard: forbids(hasInvoked) -> requires(hasUserRequested) -> artifact
   - new denial messages without unlock coaching
2. packages/omo-senpi/src/components/task/skill-invocation-tracker.ts
   - user-request channel: input text, strip <ultrawork-mode>/<system-reminder> blocks,
     match /skill:ulw-plan or \bulw[-_ ]?plan\b -> userRequested("ulw-plan")
   - plan-artifact channel: successful read/write/edit with path matching
     (^|sep).omo/plans/*.md at ANY root (worktree/external included); apply_patch patch-body scan
   - session_shutdown clears all state
3. packages/senpi-task/src/tools/task/description.ts - gated line names the real condition
4. packages/omo-senpi/scripts/qa/plan-gated-agents-e2e.mjs - read-only unlock => DENIED (negative),
   user-request + plan write => ALLOWED, start-work close unchanged
5. packages/omo-senpi/plugin/skills/ulw-plan/SKILL.md - description: ACTIVATES ONLY on explicit
   user request; never self-activates from a bare ulw run (copies not byte-identical; senpi copy only)
6. packages/senpi-task/AGENTS.md - plan-gated agents paragraph updated
7. Tests: invocation-guard.test.ts, execute-invocation-guard.test.ts, skill-invocation-tracker.test.ts

## Order (TDD)
RED guard tests -> GREEN guard -> RED tracker tests -> GREEN tracker -> wire/description ->
e2e update + real run (evidence to .omo/evidence/20260801-plan-gate-hardening/) ->
typecheck + package tests -> commits -> PR to dev -> CI/Cubic -> merge (merge commit)

## Reviewer topology
No momus self-review (that pattern is what this change removes). Gates: CI + Cubic + self-review.
