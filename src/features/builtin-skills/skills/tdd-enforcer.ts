import type { BuiltinSkill } from "../types"

const TDD_ENFORCER_SKILL_NAME = "tdd-enforcer"

const TDD_ENFORCER_SKILL_DESCRIPTION =
  "Test-Driven Development enforcement: RED-GREEN-REFACTOR cycle, mandatory test-first for every fix/feature/refactor, bun test conventions, BDD comment patterns, unit vs integration test strategy, evidence requirements. Triggers: 'write tests', 'TDD', 'test first', 'unit test', 'integration test', 'test coverage', 'testing', 'failing test', 'test suite'."

export const tddEnforcerSkill: BuiltinSkill = {
  name: TDD_ENFORCER_SKILL_NAME,
  description: TDD_ENFORCER_SKILL_DESCRIPTION,
  template: `# TDD Enforcer — Mandatory Testing Quality Gate

## THE PRIME DIRECTIVE

<critical_warning>
**NO IMPLEMENTATION WITHOUT A FAILING TEST FIRST.**

This is not a suggestion. This is a hard constraint.

| Situation | Required First Action |
|-----------|----------------------|
| Bug fix | Write a test that REPRODUCES the bug (RED) |
| New feature | Write failing tests for each acceptance criterion |
| New function / class / hook / tool | Write the test file BEFORE the source file |
| Refactor | Verify coverage exists; write tests if not — THEN refactor |
| Any code change | Ask: "Do I have a failing test for this?" — if NO, STOP |

**VIOLATION = AUTOMATIC FAILURE.** Reporting "done" without tests is not acceptable.
</critical_warning>

---

## RED-GREEN-REFACTOR CYCLE (MANDATORY FOR EVERY CHANGE)

\`\`\`
RED   → Write a test. Run it. It MUST fail (for the right reason).
GREEN → Write minimum code to make that test pass. No more.
REFACTOR → Clean up code. Tests MUST stay green throughout.
\`\`\`

**MANDATORY SELF-CHECK before each phase transition:**

\`\`\`
Before GREEN:
  "Does my test fail with the expected error? (not a compile error)"
  IF NO → Fix the test. Do not proceed.

Before REFACTOR:
  "Does bun test pass with 0 failures?"
  IF NO → Fix the implementation. Do not proceed.

Before marking task DONE:
  "Does bun test pass with 0 failures?"
  "Have I written tests for EVERY change I made?"
  IF EITHER IS NO → STOP. Fix it. Do not report done.
\`\`\`

---

## PROJECT TEST CONVENTIONS (Matrixx / Bun)

### File Placement
- Source file: \`src/foo/bar.ts\` → Test file: \`src/foo/bar.test.ts\`
- Tests live **alongside** source files, NEVER in a separate top-level \`test/\` directory
- One test file per source file (for unit tests)

### File Header (REQUIRED on every test file)
\`\`\`typescript
/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
\`\`\`

### BDD Comment Pattern (REQUIRED in every test case)
\`\`\`typescript
test("creates task with required subject field", async () => {
  //#given
  const args = { subject: "Implement authentication" }

  //#when
  const result = await tool.execute(args, TEST_CONTEXT)

  //#then
  expect(result).toHaveProperty("task")
  expect(result.task.subject).toBe("Implement authentication")
})
\`\`\`

**Rules:**
- \`//#given\` — set up state, inputs, preconditions
- \`//#when\` — execute the single action under test
- \`//#then\` — assert the observable outcomes
- NEVER combine when+then into one block
- NEVER omit any of the three markers

### Test Structure Template
\`\`\`typescript
/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"

// Import the unit under test
import { createMyThing } from "./my-thing"

describe("createMyThing", () => {
  let thing: ReturnType<typeof createMyThing>

  beforeEach(() => {
    thing = createMyThing({ /* minimal config */ })
  })

  afterEach(() => {
    // cleanup if needed
  })

  describe("happy path", () => {
    test("does the expected thing", async () => {
      //#given
      const input = "valid-input"

      //#when
      const result = await thing.doSomething(input)

      //#then
      expect(result).toBe("expected-output")
    })
  })

  describe("error cases", () => {
    test("throws when input is empty", async () => {
      //#given
      const input = ""

      //#when / #then
      await expect(thing.doSomething(input)).rejects.toThrow("Input cannot be empty")
    })
  })
})
\`\`\`

---

## WHAT TO TEST — BY TASK TYPE

### Bug Fix
1. **RED**: Write a test that fails because of the bug. The failure message must describe the bug.
2. **GREEN**: Apply the minimal fix. Test now passes.
3. **VERIFY**: Run full suite — no regressions.
4. The regression test stays in the suite forever. It is the bug's tombstone.

\`\`\`typescript
// Example: bug was "returns undefined when key is missing"
test("returns null (not undefined) when key is missing", () => {
  //#given
  const store = createStore({})

  //#when
  const result = store.get("nonexistent-key")

  //#then
  expect(result).toBeNull()        // was: undefined
  expect(result).not.toBeUndefined()
})
\`\`\`

### New Feature / New Functionality
1. Write one failing test per acceptance criterion (not one mega-test)
2. Each test covers exactly ONE behavior
3. Add integration test if the feature crosses module boundaries
4. Never write tests after implementation — write them before

| Acceptance Criterion | → | One Failing Test |
|---------------------|---|-----------------|
| "Returns paginated results" | → | test that offset/limit works |
| "Rejects empty input" | → | test that error is thrown |
| "Emits event on completion" | → | test that listener receives event |

### Hook or Tool (Matrixx-specific)
\`\`\`typescript
// Hook tests use mock plugin contexts
import type { PluginInput } from "@opencode-ai/plugin"

function buildMockContext(overrides?: Partial<PluginInput>): PluginInput {
  return {
    directory: "/tmp/test-project",
    // ... minimal required fields
    ...overrides,
  } as PluginInput
}

test("hook injects env var when git command detected", async () => {
  //#given
  const hook = createMyHook(buildMockContext())
  const args = { command: "git status" }

  //#when
  const result = await hook.toolExecuteBefore("bash", args)

  //#then
  expect(result.args.env).toHaveProperty("GIT_PAGER", "cat")
})
\`\`\`

### Refactoring
1. Confirm existing test coverage before touching anything
2. If coverage is thin → **write tests first**, then refactor (RED-GREEN-REFACTOR still applies)
3. Run \`bun test\` after EACH refactoring step — not just at the end
4. Refactoring is complete only when: same behavior, tests pass, code is cleaner

---

## UNIT vs INTEGRATION — KNOW THE DIFFERENCE

| Dimension | Unit Test | Integration Test |
|-----------|-----------|-----------------|
| **Scope** | One function / class / module | Multiple modules interacting |
| **Dependencies** | Mocked / stubbed | Real (or close-to-real) |
| **Speed** | Fast (< 50ms each) | Slower (I/O, file system, network) |
| **Isolation** | Complete | Partial |
| **Failure message** | Points to exact function | Points to interaction |

**Required for each change:**
- **Always**: at least one unit test per new/modified function
- **When crossing module boundaries**: at least one integration test
- **When touching I/O** (files, network, timers): integration test with real/temp resources (use \`tmp_path\` or \`TEST_STORAGE\` pattern)

**Integration test pattern (filesystem):**
\`\`\`typescript
const TEST_STORAGE = ".test-my-feature"

beforeEach(() => {
  if (existsSync(TEST_STORAGE)) rmSync(TEST_STORAGE, { recursive: true, force: true })
  mkdirSync(TEST_STORAGE, { recursive: true })
})

afterEach(() => {
  if (existsSync(TEST_STORAGE)) rmSync(TEST_STORAGE, { recursive: true, force: true })
})
\`\`\`

---

## EVIDENCE REQUIREMENTS (Task NOT complete without these)

Every implementation task requires this evidence before reporting done:

\`\`\`
bun test                   → Must show: X tests passed, 0 failed
bun run typecheck          → Must show: exit code 0, no errors
\`\`\`

**How to report:**
\`\`\`
✅ bun test — 42 tests passed, 0 failed (3.2s)
✅ bun run typecheck — no errors
\`\`\`

If ANY verification fails:
1. STOP. Do not report done.
2. Fix the failure (code, never the test).
3. Re-run ALL verification commands.
4. Report done only when ALL pass.

---

## ANTI-PATTERNS (AUTOMATIC FAILURE)

<critical_warning>
| Anti-Pattern | Why It's Wrong | Correct Action |
|-------------|----------------|----------------|
| Write implementation THEN tests | Tests become documentation, not verification | Write failing test FIRST |
| Delete a failing test | You're hiding a problem | Fix the code to make it pass |
| Skip a failing test (\`test.skip\`) | Same as deleting | Fix the code |
| Write empty test body | Provides false confidence | Write real assertions |
| Only mock everything | Tests prove the mock works, not the code | Use real deps where feasible |
| Only happy-path tests | Errors happen in production | Add error/edge case tests |
| Run \`bun test\` once at the very end | Bugs compound | Run after each GREEN step |
| "Tests are for later" | Later never comes | Test-first, always |
| Separate test commit from impl commit | Breaks bisect, breaks CI | Same commit always |
</critical_warning>

---

## TEST COVERAGE CHECKLIST

Before marking any task complete, verify each item:

**For every function/method added or modified:**
- [ ] Unit test exists for the primary behavior
- [ ] Unit test exists for edge case: empty/null/zero input
- [ ] Unit test exists for the error path (what happens when it fails?)
- [ ] Test names are descriptive: "does X when Y" not "test1"

**For every bug fix:**
- [ ] Regression test that reproduces the bug in RED phase
- [ ] Regression test passes in GREEN phase

**For every cross-module feature:**
- [ ] Integration test verifying the interaction end-to-end

**For every commit:**
- [ ] Test file included in same commit as implementation file
- [ ] \`bun test\` passes with 0 failures
- [ ] \`bun run typecheck\` passes with 0 errors

---

## HARD RULES (NO EXCEPTIONS)

\`\`\`
NEVER write implementation code without a preceding failing test
NEVER delete or skip a failing test — fix the code instead
NEVER commit implementation without the corresponding test file
NEVER report a task done without running bun test to confirm 0 failures
NEVER use @ts-ignore or as any to suppress type errors in test files
NEVER write tests AFTER implementation — write them BEFORE
\`\`\`
`,
}
