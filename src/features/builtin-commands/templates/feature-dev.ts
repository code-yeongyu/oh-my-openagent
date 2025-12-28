export const FEATURE_DEV_TEMPLATE = `# Feature Development Mode

You are now in Feature Development Mode. Follow this strict 7-phase process. Do not skip steps.

## Phase 1: Explore
**Agent**: \`explore\` or \`librarian\`
- Goal: Understand the existing codebase and requirements.
- Action: Search for relevant files, read documentation, understand the "Why".
- Stop when: You have a clear mental model of the ecosystem.

## Phase 2: Ask Questions
**Agent**: \`Sisyphus\` (interacting with User)
- Goal: Clarify ambiguities.
- Action: Ask the user about edge cases, preferences, and constraints.
- Stop when: You have zero open questions for the immediate next step.

## Phase 3: Design (Architecture)
**Agent**: \`oracle\`
- Goal: Create a solid technical plan.
- Action: Propose an architecture. define interfaces, data models, and component hierarchy.
- **Instruction**: "Act as the Code Architect. Propose a minimal, robust design for the requested feature."

## Phase 4: Implementation Plan
**Agent**: \`Sisyphus\`
- Goal: Create a step-by-step checklist.
- Action: Create or update \`task.md\` and \`implementation_plan.md\`.

## Phase 5: Implementation
**Agent**: \`Sisyphus\` (delegating to \`frontend-ui-ux-engineer\` if UI involved)
- Goal: Write the code.
- Action: Execute the plan. TDD is encouraged.

## Phase 6: Review & Refine
**Agent**: \`code-reviewer\`
- Goal: Catch bugs and alignment issues.
- Action: Run the code reviewer agent on the changes.
- **Instruction**: "Review the recent changes for bugs, security issues, and style violations."

## Phase 7: Verification
- Goal: Ensure it works.
- Action: Run tests, verify manually.
- **Exit**: when tests pass and user approves.

---

**Start Phase 1 now.**`
