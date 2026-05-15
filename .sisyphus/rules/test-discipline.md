---
description: Test discipline — fires when reading or editing any test file in this repo
globs:
  - "**/*.test.ts"
  - "**/__tests__/**/*.ts"
  - "src/testing/**/*.ts"
  - "test-setup.ts"
  - "script/run-ci-tests.ts"
---

# Test Discipline (NON-NEGOTIABLE)

**Every test in this repo MUST pass `bun test` in one process, in one go — no isolation flags, no retries, no special ordering.** That is the gate. A test that needs `--only`, its own process, or a specific run order to pass is **BROKEN**. Fix the test; do not pamper it.

## FLAKY = FAILING

A test that passes 9 of 10 times is **failing 10% of the time**. Not "occasional." **BROKEN.**

**FORBIDDEN in test bodies** unless time itself is the system under test (`Date.now`, real timers, debounce/throttle windows):

- `setTimeout(resolve, N)` / `await new Promise(r => setTimeout(r, N))` / `await sleep(N)`
- "wait long enough for X to happen" — "enough" is a guess; CI machines are slower or faster than your laptop and the test WILL fail on someone else's box

The replacement: **subscribe BEFORE the trigger, await the signal with an explicit timeout.**

## EVENT TESTING — SUBSCRIBE-FIRST, TIMEOUT-BOUND

When code under test emits an event, fires a callback, or resolves a promise:

1. **Register the listener / construct the awaitable BEFORE you trigger the action.** Reverse order = lost event = flake.
2. **Race against an explicit timeout.** On timeout, **fail with a useful message** (`"waited 5s for event 'X', never fired"`). NEVER silently retry, NEVER fall through.
3. The timeout is a **circuit breaker**, not a synchronization primitive. If the assertion logic depends on the timeout firing first, the test is wrong.

## NO ISOLATION CRUTCHES

Tests must work under arbitrary parallel ordering in a single `bun test` run, **no matter how many mocks are involved.**

FORBIDDEN:

- `.only` / `.skip` to mask a flaky test
- Running a test in its own process to "fix" a state leak. `script/run-ci-tests.ts` already auto-isolates files that use `mock.module()` — DO NOT add to that list to cover up a real cross-test bug
- Reordering `describe` / `it` blocks to mask cross-test contamination
- Relying on test A running before test B

Cross-test contamination = **state leak**. Find the leak. Reset in `beforeEach`, add the reset to `test-setup.ts` if it is shared, or mock at the module boundary (`mock.module`) instead of mutating globals other tests will read.

## PROMPT TESTS — ASSERT BEHAVIOR, NOT TEXT

When testing code that builds an LLM prompt, **DO NOT pin the current wording.**

**BANNED — these tests guard a diff, not behavior:**

```ts
expect(prompt).toContain("You are Sisyphus")
expect(prompt).toMatchSnapshot()
expect(prompt).toBe(EXPECTED_PROMPT)
```

The wording changes next sprint, the test fails, and the next engineer edits the assertion to match the new text without understanding what the test was guarding. **The test guarded nothing.**

**REQUIRED — assert the structural invariant the prompt logic enforces:**

- "When `teamMode.enabled === true`, the prompt MUST mention `team_send_message`" → test the conditional branch
- "When `verbose === false`, the prompt MUST NOT include the debug directive" → test the negative branch
- "API keys MUST NOT appear in the system message" → test the redaction
- "Skill X's instructions MUST appear when the skill is loaded, and MUST NOT when it is not" → test inclusion + exclusion

Test what would break the **behavior**. Never test what would only break a **diff**.
