# Reference: creating-changes

## Templates

### proposal.md Template

```markdown
# Proposal: <name>

## Problem Statement

[What problem are we solving? Why does this matter?]

## Proposed Solution

[High-level description of the approach]

- Key approach: [main technical strategy]
- Scope: [what's included/excluded]
- Estimated effort: [small/medium/large]

## Success Criteria

[How do we know this is done?]

- [ ] Criterion 1 (specific, measurable)
- [ ] Criterion 2 (specific, measurable)
- [ ] Criterion 3 (specific, measurable)

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| [Risk 1] | Low/Med/High | Low/Med/High | [How to mitigate] |
| [Risk 2] | Low/Med/High | Low/Med/High | [How to mitigate] |

## Alternatives Considered

### Option 1: [Name] (Recommended)
- **Pros**: [advantages]
- **Cons**: [disadvantages]
- **Why chosen**: [rationale]

### Option 2: [Name]
- **Pros**: [advantages]
- **Cons**: [disadvantages]
- **Why not chosen**: [rationale]

## Dependencies

- [External dependency 1]
- [Internal dependency 1]

## Timeline

- Phase 1: [description] - [estimate]
- Phase 2: [description] - [estimate]
```

### design.md Template

```markdown
# Design: <name>

## Goal

[One sentence describing what this builds - derived from proposal]

## Architecture

[2-3 sentences about the technical approach]

- Key components and their responsibilities
- Data flow between components
- Integration points with existing code

## Tech Stack

[List key technologies, libraries, frameworks involved]

- Runtime: [e.g., Node.js, Python, Go]
- Libraries: [key dependencies]
- Testing: [test framework and approach]

## File Structure

[Planned file changes]

```
src/
├── new-file.ts          # New: [purpose]
├── existing-file.ts     # Modify: [what changes]
└── ...
tests/
├── new-file.test.ts     # New: [test coverage]
└── ...
```

## Key Decisions

[Important technical decisions and their rationale]

1. **Decision**: [choice made]
   - **Why**: [rationale]
   - **Trade-off**: [what we gave up]

2. **Decision**: [choice made]
   - **Why**: [rationale]
   - **Trade-off**: [what we gave up]

## Edge Cases

[Known edge cases and how they'll be handled]

- Edge case 1: [handling approach]
- Edge case 2: [handling approach]
- Edge case 3: [handling approach]

## Open Questions

[Any unresolved questions - address before implementation]

- [ ] Question 1
- [ ] Question 2
```

### tasks.md Template

```markdown
# Tasks: <name>

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

## Phase 1: [Phase Title]

### Task 1.1: [Task Name] <!-- Risk: Tier-X -->

**Description:**
[1-2 sentences explaining what this task accomplishes and why]

**Files:**
- Create: `exact/path/to/new-file.ts`
- Modify: `exact/path/to/existing.ts` - [what changes]
- Test: `tests/exact/path/to/test.ts`

**Acceptance Criteria:**
- [ ] Criterion 1 (specific, measurable outcome)
- [ ] Criterion 2 (specific, measurable outcome)
- [ ] Criterion 3 (specific, measurable outcome)

**TDD Test Cases:**
1. **Test**: [test name/description]
   - **Given**: [precondition/setup]
   - **When**: [action performed]
   - **Then**: [expected outcome]

2. **Test**: [test name/description]
   - **Given**: [precondition/setup]
   - **When**: [action performed]
   - **Then**: [expected outcome]

**Edge Cases:**
- [edge case 1]: [how to handle]
- [edge case 2]: [how to handle]

**Dependencies:** None | Task X.Y

---

### Task 1.2: [Task Name] <!-- Risk: Tier-X -->

**Description:**
[1-2 sentences explaining what this task accomplishes and why]

**Files:**
- Create: `path/to/file.ts`
- Test: `tests/path/to/test.ts`

**Acceptance Criteria:**
- [ ] Criterion 1
- [ ] Criterion 2

**TDD Test Cases:**
1. **Test**: [test name/description]
   - **Given**: [precondition/setup]
   - **When**: [action performed]
   - **Then**: [expected outcome]

**Edge Cases:**
- [edge case]: [handling]

**Dependencies:** Task 1.1

---

## Phase 2: [Phase Title]

### Task 2.1: [Task Name] <!-- Risk: Tier-X -->

...

---

## Legend

- `[ ]` = Pending
- `[x]` = Complete
- `[~]` = In Progress
- `[-]` = Skipped

## Risk Tiers

| Tier | Description | TDD Requirement |
|------|-------------|-----------------|
| **0** | Always allowed (docs, comments, .gitignore) | None |
| **1** | Allowed with logging (CSS, renames) | None, logged |
| **2** | Require failing test OR exemption | Test or exemption |
| **3** | Strict TDD (core logic, new features) | Mandatory test first |
```

### Task Example (Complete)

```markdown
### Task 1.1: Add user authentication middleware <!-- Risk: Tier-3 -->

**Description:**
Create Express middleware that validates JWT tokens from the Authorization header and attaches the decoded user to the request context.

**Files:**
- Create: `src/middleware/auth.ts`
- Create: `src/types/express.d.ts` - Extend Express Request type
- Test: `tests/middleware/auth.test.ts`

**Acceptance Criteria:**
- [ ] Middleware extracts JWT from `Authorization: Bearer <token>` header
- [ ] Valid tokens result in `req.user` being populated with decoded payload
- [ ] Invalid tokens return 401 Unauthorized with JSON error body
- [ ] Expired tokens return 401 with specific "token expired" message
- [ ] Missing Authorization header returns 401 with "missing token" message

**TDD Test Cases:**
1. **Test**: should reject request with no Authorization header
   - **Given**: Request without Authorization header
   - **When**: Middleware processes request
   - **Then**: Returns 401 with `{ error: "Missing authentication token" }`

2. **Test**: should reject request with invalid token format
   - **Given**: Authorization header with malformed token
   - **When**: Middleware processes request
   - **Then**: Returns 401 with `{ error: "Invalid token format" }`

3. **Test**: should reject request with expired token
   - **Given**: Authorization header with expired JWT
   - **When**: Middleware processes request
   - **Then**: Returns 401 with `{ error: "Token expired" }`

4. **Test**: should attach user to request for valid token
   - **Given**: Authorization header with valid JWT containing user payload
   - **When**: Middleware processes request
   - **Then**: `req.user` equals decoded payload, `next()` called

5. **Test**: should reject token signed with wrong secret
   - **Given**: JWT signed with different secret
   - **When**: Middleware processes request
   - **Then**: Returns 401 with `{ error: "Invalid token" }`

**Edge Cases:**
- Token with future `iat` (issued at): Reject as invalid
- Token without required claims (sub, exp): Reject with specific error
- Concurrent requests with same token: Should work (stateless)

**Dependencies:** None
```

## Task Granularity Guidelines

Each task should be:
- **2-5 minutes of work** (bite-sized)
- **Single responsibility** (one logical change)
- **Independently verifiable** (clear acceptance criteria)

**DO NOT include:**
- Full implementation code (that's for executing-plans)
- Step-by-step coding instructions
- Expected command outputs

**DO include:**
- Exact file paths
- Detailed acceptance criteria (specific, measurable)
- TDD test case descriptions with Given/When/Then
- Edge cases to consider
- Risk tier label
- Dependencies on other tasks

## Best Practices

- **Front-load risk**: Put Tier-3 tasks early for early validation
- **Phase independence**: Each phase should be deployable if possible
- **Clear dependencies**: Explicit task ordering prevents confusion
- **Testable criteria**: Every acceptance criterion should be verifiable
- **Edge case coverage**: Identify edge cases before implementation

---

### findings.md Template

```markdown
# Findings: <name>

> This file tracks research discoveries, decisions, and issues during planning and execution.
> **2-Action Rule**: After every 2 browser/view operations, save findings here.

## Requirements

[Captured from brainstorming conversation]

- Requirement 1: [description]
- Requirement 2: [description]
- Requirement 3: [description]

## Research Findings

### [Topic 1]

- Finding: [what was discovered]
- Source: [where this came from]
- Implications: [how this affects the design]

### [Topic 2]

- Finding: [what was discovered]
- Source: [where this came from]
- Implications: [how this affects the design]

## Technical Decisions

| Decision | Choice | Rationale | Alternatives Considered |
|----------|--------|-----------|------------------------|
| [Decision 1] | [What was chosen] | [Why] | [Other options] |
| [Decision 2] | [What was chosen] | [Why] | [Other options] |

## Issues Encountered

| Issue | Status | Resolution |
|-------|--------|------------|
| [Issue 1] | Open/Resolved | [How it was resolved or current status] |
| [Issue 2] | Open/Resolved | [How it was resolved or current status] |

## Resources

- [Link 1]: [Description]
- [Link 2]: [Description]
- [Documentation reference]: [Description]

## Visual/Browser Findings

> For UI work: Record what you see after browser operations.

### Screenshot/View 1
- **URL/Page**: [where]
- **Observation**: [what you saw]
- **Action Needed**: [what to do about it]

### Screenshot/View 2
- **URL/Page**: [where]
- **Observation**: [what you saw]
- **Action Needed**: [what to do about it]
```

### progress.md Template

```markdown
# Progress: <name>

> This file tracks execution progress, test results, and errors.
> Update after completing each task or encountering issues.

## Session Log

### [YYYY-MM-DD] Session 1

**Focus**: [What was worked on]
**Duration**: [Approximate time]
**Status**: In Progress / Completed

#### Actions Taken
- [x] Action 1
- [x] Action 2
- [ ] Action 3 (pending)

#### Phase Progress
- Phase 1: ✅ Complete (2/2 tasks)
- Phase 2: 🔄 In Progress (1/3 tasks)
- Phase 3: ⏳ Pending

---

### [YYYY-MM-DD] Session 2

**Focus**: [What was worked on]
**Duration**: [Approximate time]
**Status**: In Progress / Completed

#### Actions Taken
- [x] Action 1
- [x] Action 2

---

## Test Results

| Test Suite | Pass | Fail | Skip | Notes |
|------------|------|------|------|-------|
| [Suite 1] | 5 | 0 | 0 | All passing |
| [Suite 2] | 3 | 1 | 0 | See error log |

## Error Log

| Timestamp | Error | Context | Resolution |
|-----------|-------|---------|------------|
| [time] | [error message] | [what was happening] | [how it was fixed] |
| [time] | [error message] | [what was happening] | [pending] |

## 5-Question Reboot Check

> Answer these when resuming work after a break or session change.

| Question | Answer |
|----------|--------|
| 1. What phase/task am I on? | [Phase X, Task Y.Z] |
| 2. What was I doing when I stopped? | [Description] |
| 3. What's the next action? | [Specific next step] |
| 4. Are there any blockers? | [Yes/No - details] |
| 5. What files are currently modified? | [List of files] |

## Blockers

| Blocker | Status | Owner | Notes |
|---------|--------|-------|-------|
| [Blocker 1] | Active/Resolved | [Who] | [Details] |

## Notes

[Any additional notes, observations, or reminders]
```
