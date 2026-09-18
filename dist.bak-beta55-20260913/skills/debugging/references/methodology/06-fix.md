# Phase 6 + 7 — Root Cause Confirmation & TDD Fix

A cause is not "confirmed" until you can toggle the bug by toggling the cause. Every other level of evidence is correlation, and correlation-driven fixes ship bugs.

---

## Phase 6 — Root Cause Confirmation

You are allowed to call the cause "confirmed" only when ALL THREE of these hold:

### 1. Captured runtime value matches the hypothesis exactly

Not "the value looks consistent with" — the value is exactly the value the hypothesis predicted. If your hypothesis was "baseUrl is api.anthropic.com despite ANTHROPIC_BASE_URL being set to a proxy", the captured value is literally `"https://api.anthropic.com"` in the debugger at the moment of the HTTP call.

### 2. Reproducible

Running the repro a second time yields the same observation. Flaky repros mean you haven't isolated the cause; you've isolated a symptom that sometimes appears when the cause does. Keep investigating.

### 3. Toggle proof (the one most skipped)

**Changing the value** (via debugger assignment, env override, or a speculative one-line patch) **makes the bug disappear — and reverting brings the bug back**.

If you can't toggle the bug by toggling the suspected cause, what you have is a correlation, not a mechanism. A correlation is a strong hypothesis, not a confirmed cause.

Examples of a valid toggle proof:

| Suspected cause | Toggle |
|---|---|
| Env var overrides library default, and the override is wrong | Unset the env var → bug goes away. Reset it → bug comes back. |
| Async task is not awaited | Add `await` → bug goes away. Remove `await` → bug comes back. |
| Third-party SDK uses hardcoded URL | Monkey-patch SDK to use env URL → bug goes away. Unpatch → bug comes back. |
| Race condition on shared state | Add a mutex → bug goes away under load. Remove mutex → bug comes back under load. |

If you can't construct a toggle proof, you haven't confirmed the cause. Run one more round.

### Update the journal

```markdown
## Root cause (confirmed <ISO timestamp>)
- Mechanism: <one paragraph, causal not correlational — the chain from cause to observable symptom>
- Evidence: <file:line of captured value | path to saved repro | address + register state>
- Toggle proof: "With <change X>, repro produces <good>. Reverting <change X>, repro produces <bad>."
- Fix scope: <files and approximate line count>
```

The "mechanism" field is the acid test. If you can't write the causal chain from cause to observable symptom as one paragraph, you don't yet understand the bug well enough to fix it.

---

## Phase 7 — TDD Fix

Red, green, refactor. No shortcuts.

### 1. Red — failing-first test

Write a test that fails *specifically because of this bug*. Requirements:

- **Test name reads like a bug report.** `test_refinement_turn_returns_empty_content_when_anthropic_returns_401` is good. `test_bug_fix` is not.
- **Failure message clearly shows what the bug looks like.** If someone reads only the failure output, they understand what's broken.
- **Minimum infrastructure.** Don't spin up the whole server if a unit test against the right seam captures the mechanism.

Run the test. Confirm it fails. Paste the failure output into the journal:

```markdown
### Red phase (<ISO timestamp>)
Test: <path>::<name>
Command: <exact invocation>
Output:
```
<verbatim failure output>
```
Confirms: the bug is reproducible at the test-harness level, not just the manual repro.
```

### 2. Green — minimum change

Make the test pass with the **smallest change that fully fixes the observed mechanism**.

If the diff is larger than ~30 lines and you aren't refactoring, something is wrong — either you're fixing more than the bug, or the root cause was deeper than you confirmed. Back to Phase 6.

Signs you're over-fixing:
- Adding "just in case" null checks or try/except around other code
- Refactoring adjacent functions because "while I'm here"
- Adding new configuration options the bug didn't require
- Introducing new abstractions to "make this cleaner"

Resist all of these. Fix the bug. Note the surrounding issues for follow-up. Move on.

### 3. Refactor — ONLY AFTER GREEN

Only cleanup directly related to the fix. Do not re-architect.

If the code around the fix is rough, note it in the journal as a follow-up for the user; do not expand scope here. Refactoring during a bugfix is how one-line fixes turn into hundred-line diffs nobody can review.

### 4. Regression — full suite green

Run the full test suite for the affected package (not just the one new test). Existing tests must still pass.

If they don't, your "fix" broke something else. Back to Phase 6 with the new failure as evidence — usually it means the mechanism you thought you fixed was load-bearing for some other code path you didn't know about, and the "broken" test is actually pointing at a better understanding of the system.

### 5. Close the observability gap

If diagnosis burned extra rounds *because state was invisible* — no log line told you which branch ran, what the value was, whether the fallback engaged — that invisibility is a defect adjacent to the bug, and this is the one moment where adding a log line is NOT "just in case": this session is the evidence that the line earns its place. Ship the fix WITH that line, written to the standard of the `programming` skill's `references/logging.md` — level chosen by consumer, placed at the decision point, data in fields not interpolation, through the project's designated logger. If the project deliberately does not log, respect that and skip this step.

This does not soften the artifact rule: every temporary `print` / `dbg!` / `console.log` planted *during* diagnosis stays journaled and gets scrubbed in Phase 9. The triage is the consumer test — a line whose ongoing consumer you can name is part of the fix; a line that only served today's session is an artifact.

### Update the journal

```markdown
### Green phase (<ISO timestamp>)
Fix: <file:line> — <two-line description of the change>
Test: <path>::<name> now passes
Full suite: <N tests, <M failures — should be 0>
```

---

## The red-green discipline summary

No red test → no proof the fix addresses the reported bug. Only proof it doesn't break tests that already existed.

A test written *after* the fix might still pass with the fix reverted. If that's the case, the test doesn't lock the bug — it locks something else. Always verify the test fails without the fix and passes with it. The journal should show both outputs.
