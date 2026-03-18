export const TODOWRITE_DESCRIPTION = `Use this tool to create and manage a structured task list for tracking progress on multi-step work.

## Todo Format (MANDATORY)

Each todo title MUST encode four elements: WHERE, WHY, HOW, and EXPECTED RESULT.

Format: "[WHERE] [HOW] to [WHY] — expect [RESULT]"

GOOD:
- "src/utils/validation.ts: Add validateEmail() for input sanitization — returns boolean"
- "UserService.create(): Call validateEmail() before DB insert — rejects invalid emails with 400"
- "validation.test.ts: Add test for missing @ sign — expect validateEmail('foo') to return false"

BAD:
- "Implement email validation" (where? how? what result?)
- "Add dark mode" (this is a feature, not a todo)
- "Fix auth" (what file? what changes? what's expected?)

## Granularity Rules

Each todo MUST be a single atomic action completable in 1-3 tool calls. If it needs more, split it.

**Size test**: Can you complete this todo by editing one file or running one command? If not, it's too big.

## Task Management
- One in_progress at a time. Complete it before starting the next.
- Mark completed immediately after finishing each item.
- Skip this tool for single trivial tasks (one-step, obvious action).`
