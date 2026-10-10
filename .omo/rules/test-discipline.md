---
description: Test discipline - fires when reading or editing any test file in this repo
globs:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.test.mts"
  - "**/*.test.cts"
  - "**/*.test.mjs"
  - "**/*.test.js"
  - "**/*.spec.ts"
  - "**/*.spec.mjs"
  - "**/__tests__/**/*.ts"
  - "src/testing/**/*.ts"
  - "test-setup.ts"
  - "script/run-ci-tests.ts"
---

# Test Discipline (NON-NEGOTIABLE)

**Every test in this repo MUST pass `bun test` in one process, in one go - no isolation flags, no retries, no special ordering.** That is the gate. A test that needs `--only`, its own process, or a specific run order to pass is **BROKEN**. Fix the test; do not pamper it.

## FLAKY = FAILING

A test that passes 9 of 10 times is **failing 10% of the time**. Not "occasional." **BROKEN.**

**FORBIDDEN in test bodies** unless time itself is the system under test (`Date.now`, real timers, debounce/throttle windows):

- `setTimeout(resolve, N)` / `await new Promise(r => setTimeout(r, N))` / `await sleep(N)`
- "wait long enough for X to happen" - "enough" is a guess; CI machines are slower or faster than your laptop and the test WILL fail on someone else's box

The replacement: **subscribe BEFORE the trigger, await the signal with an explicit timeout.**

## EVENT TESTING - SUBSCRIBE-FIRST, TIMEOUT-BOUND

When code under test emits an event, fires a callback, or resolves a promise:

1. **Register the listener / construct the awaitable BEFORE you trigger the action.** Reverse order = lost event = flake.
2. **Race against an explicit timeout.** On timeout, **fail with a useful message** (`"waited 5s for event 'X', never fired"`). NEVER silently retry, NEVER fall through.
3. The timeout is a **circuit breaker**, not a synchronization primitive. If the assertion logic depends on the timeout firing first, the test is wrong.

## NO ISOLATION CRUTCHES

Tests must work under arbitrary parallel ordering in a single `bun test` run, **no matter how many mocks are involved.**

FORBIDDEN:

- `.only` / `.skip` to mask a flaky test
- Running a test in its own process to "fix" a state leak. `script/run-ci-tests.ts` already auto-isolates files that use `mock.module()` - DO NOT add to that list to cover up a real cross-test bug
- Reordering `describe` / `it` blocks to mask cross-test contamination
- Relying on test A running before test B

Cross-test contamination = **state leak**. Find the leak. Reset in `beforeEach`, add the reset to `test-setup.ts` if it is shared, or mock at the module boundary (`mock.module`) instead of mutating globals other tests will read.

## AUTHORING GATE

Before adding or changing a test, answer all four. A missing answer means do not add it yet:

1. What observable behavior, invariant, or independent contract does it protect?
2. What credible regression makes it fail?
3. Why does existing coverage not already catch that failure? Each contract has one primary test owner at the strongest boundary; extend its table case or shared fixture instead of adding a near-duplicate.
4. Does it need a production seam (export, flag, wrapper, injection hook) no production caller needs? If yes, test at the real boundary instead.

**Junk patterns** (reject unless the retention bar applies): assertion-free probes; self-comparisons and identity copiers; copied fixtures, inventories, manifests or export lists; exact source, import or string greps; private call-shape tests duplicated at a real boundary; duplicate invocations of one contract; replays of a shared helper through a wrapper; tests that exist to keep a test-only export or wrapper alive; production code whose only callers are tests; expected values produced by the code under test; mocks that implement the asserted behavior; fixture-supplied receipts or postconditions the code under test should produce; assertions against a store nothing writes; capability or flag restatements without a delivery proof; negative controls that pass for an unrelated reason; names that promise more than the input exercises.

**Retention bar:** keep a pattern match only when it independently guards a public API, protocol, config, migration, storage, security, platform, default, prompt-byte, generated or cross-language, package, release, or architecture contract, and say which one in the test. The repo's meta-audits (AGENTS.md "Test discipline meta-audits") stay under the architecture exception. Static or slow is never a deletion reason. A retained test that fails on the base is a product bug to fix at its owner, never a test to delete.

**Bug regressions:** the regression must fail on the pre-fix code for the intended reason. An existing owner test that already fails on the pre-fix code may be that proof; extend it instead of writing a second reproduction.

## PROMPT TESTS - ASSERT BEHAVIOR, NOT TEXT

A prompt, skill (`SKILL.md`), rule, or any markdown/instruction file is PROSE. Its wording is not a contract; the model reads it, a human edits it, it changes every sprint. **DO NOT write a test that asserts what the prose SAYS.**

**BANNED - every one of these guards a diff, not behavior:**

```ts
expect(prompt).toContain("You are Sisyphus")      // phrase-present pin
expect(skill).not.toContain("old wording")        // phrase-absent / past-wording guard
expect(prompt).toMatchSnapshot()                  // snapshot of prose
expect(prompt).toBe(EXPECTED_PROMPT)              // full-text pin
expect(wordCount(workflow)).toBeLessThanOrEqual(3930)  // word / char / LOC ceiling
expect(md.match(/some phrase/g)?.length).toBe(1)  // phrase-occurrence count
```

The wording changes, the test fails, and the next engineer edits the assertion to match the new text without understanding what it guarded. **The test guarded nothing** — worse, it now BLOCKS every legitimate prompt edit until someone bumps the pinned string or number.

**Decide by what CONSUMES the file:**

- **A machine consumes a value in it** (a parser reads a frontmatter field, a hook greps a sentinel token, a validator runs the doc's JSON sample, a runtime dispatches on a tool name the prose documents) -> test THAT: parse the field and assert the value, or run the real consumer over the file. Not the surrounding prose.
- **The file is shipped in two copies that must stay identical** (shared source + packaged copy) -> guard drift with ONE equality between the two real artifacts (`expect(packaged).toBe(source)`), never a list of phrase greps.
- **The change is PURE PROSE with no machine consumer** (rewording guidance, tightening an instruction, adding an example) -> there is NO behavioral seam, so write NO automated test. The guard is review + QA-by-read, not a grep. A green text-pin here is pretend-coverage; skipping the test is the correct, honest outcome. The authoring gate's first question has no answer here, so no test is added; say so in the PR instead of manufacturing a pin.

**REQUIRED when a behavioral seam exists - assert the conditional the code enforces:**

- "When `teamMode.enabled === true`, the builder MUST include the `team_send_message` tool" -> test the branch, keying on a stable token the runtime also uses, not a sentence
- "When `verbose === false`, the debug directive MUST be absent" -> test the negative branch
- "API keys MUST NOT appear in the system message" -> test the redaction
- "Skill X loads when requested and is absent when not" -> test inclusion + exclusion

Test what would break the **behavior**. Never test what would only break a **diff**.

**DELEGATION:** when you hand test-writing to a subagent, give it the behavior the test must distinguish ("fails if override precedence breaks"), NEVER a ready-made assertion string, prompt fragment, expected pass/assert count, or "marker already used by current tests". A prescribed mechanism that is wrong gets implemented faithfully — the defect ships behind a green suite, exactly what this rule exists to prevent. Nearby `toContain("<sentence>")` tests are existing violations, not a convention to follow.
