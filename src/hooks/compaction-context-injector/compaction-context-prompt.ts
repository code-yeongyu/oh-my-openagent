import {
  createSystemDirective,
  SystemDirectiveTypes,
} from "../../shared/system-directive"

export const COMPACTION_CONTEXT_PROMPT = `${createSystemDirective(SystemDirectiveTypes.COMPACTION_CONTEXT)}

When summarizing this session, include these sections:

## 1. User Requests (As-Is)
- List original user requests exactly as stated — preserve wording and intent

## 2. Final Goal
- What the user ultimately wanted — end result or deliverable

## 3. Work Completed
- What has been done: files created/modified, features implemented, problems solved

## 4. Remaining Tasks
- What still needs doing: pending items, follow-up tasks

## 5. Active Working Context (For Seamless Continuation)
- **Files**: Paths being edited or frequently referenced
- **Code in Progress**: Key snippets, function signatures, data structures
- **External References**: Documentation URLs, library APIs
- **State & Variables**: Important names, config values, runtime state

## 6. Explicit Constraints (Verbatim Only)
- Include ONLY constraints explicitly stated by user or AGENTS.md
- Quote constraints verbatim (do not paraphrase)
- Do NOT invent, add, or modify constraints
- Write "None" if no explicit constraints exist

## 7. Agent Verification State (Critical for Reviewers)
- Current agent, verification progress, pending verifications
- Previous rejections and reasons (if reviewer agent)
- Acceptance status of review process

## 8. Delegated Agent Sessions
- List ALL background tasks: agent name, category, status, description, session_id
- **RESUME, DON'T RESTART.** Each listed session retains full context — use session_id to continue instead of spawning new ones.
`
