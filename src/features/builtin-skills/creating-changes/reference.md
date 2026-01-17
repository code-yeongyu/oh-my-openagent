# Reference: creating-changes

## Templates

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
