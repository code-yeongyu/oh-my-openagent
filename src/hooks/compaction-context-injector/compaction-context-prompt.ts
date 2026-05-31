import {
  createSystemDirective,
  SystemDirectiveTypes,
} from "../../shared/system-directive"

export const COMPACTION_CONTEXT_PROMPT = `${createSystemDirective(SystemDirectiveTypes.COMPACTION_CONTEXT)}

When summarizing this session, keep the result compact and continuation-focused. Prefer terse bullets over replaying the transcript.

## 1. User Requests
- Summarize the latest unresolved user requests and any earlier request still affecting the work
- Quote exact wording only when a later agent needs the literal phrase

## 2. Final Goal
- What the user ultimately wanted to achieve
- The end result or deliverable expected

## 3. Work Completed
- What has been done so far
- Files created/modified
- Validation already run and its result

## 4. Remaining Tasks
- What still needs to be done
- Pending items from the original request
- Known blockers or risks

## 5. Active Working Context (For Seamless Continuation)
- **Files**: Paths of files currently being edited or frequently referenced
- **Code in Progress**: Function names, data structures, or decisions under active development
- **External References**: Only URLs or docs that are still needed
- **State & Variables**: Important variable names, configuration values, or runtime state relevant to ongoing work

## 6. Explicit Constraints (Verbatim Only)
- Include ONLY active constraints explicitly stated by the user or existing AGENTS.md context
- Quote constraints verbatim when quoting a constraint
- Do NOT invent, add, or modify constraints
- Do not paste full AGENTS.md, system/developer messages, or long policy blocks; cite the source path/name and quote only decisive clauses
- If no explicit constraints exist, write "None"

## 7. Agent Verification State (Critical for Reviewers)
- **Current Agent**: What agent is running (momus, oracle, etc.)
- **Verification Progress**: Files already verified/validated
- **Pending Verifications**: Files still needing verification
- **Previous Rejections**: If reviewer agent, what was rejected and why
- **Acceptance Status**: Current state of review process

This section is CRITICAL for reviewer agents (momus, oracle) to maintain continuity.

## 8. Delegated Agent Sessions
- List active/recent background agent tasks that still matter
- For each: agent name, category, status, short description, and **task_id**
- **RESUME, DON'T RESTART.** Each listed delegated task retains full context. After compaction, use \`task_id\` to continue existing delegated work instead of spawning new tasks. This saves tokens, preserves learned context, and prevents duplicate work.

This context is critical for maintaining continuity after compaction.
`
