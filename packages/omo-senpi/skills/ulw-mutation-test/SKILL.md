---
name: ulw-mutation-test
description: >
  Validate that new or changed tests can detect realistic bugs by predicting,
  applying, classifying, and exactly restoring 3-5 targeted mutations. Use
  after changing assertions or test cases, when ulw-loop reaches its mutation
  gate, or whenever a passing test may be a false green.
---

# ULW Mutation Test

Prove that a test can stop realistic user-facing or operational bugs. Coverage
only proves that code ran; this workflow proves that an observable defect makes
the relevant test fail.

This is targeted, AI-guided mutation testing. Do not enumerate every syntactic
mutation. Select a few credible bugs from the behavior contract, predict their
effect before seeing results, and treat every mutation as untrusted temporary
work that must be restored immediately.

## When to Run

Run this skill when any of these are true:

- a work unit adds or changes a test assertion, case, fixture expectation,
  prompt-behavior rule, or test-quality claim;
- `ulw-loop` reaches its mutation-test gate;
- the user asks whether a test is meaningful, defensive, trustworthy, or a
  false green;
- coverage is offered as proof that tests protect behavior.

Documentation-only, formatting-only, or pure rename work may be
`not_applicable` only when it changes no assertion, test case, fixture
expectation, prompt-behavior rule, test-quality claim, or promised behavior.
Record the scoped diff evidence instead.

## Safety Invariants

These rules are binding:

1. Read the production path, the test, and one caller or dependency layer before
   designing mutations.
2. Record the baseline command, its green result, affected file hashes, and the
   pre-existing diff before the first mutation.
3. Mutate clean files or explicitly snapshotted lines only. Refuse patches
   overlapping pre-existing dirty changes. A dirty file is eligible only when
   the mutation targets separate lines and exact inverse restoration is proven.
4. Apply exactly one mutation at a time with the normal patch tool. Never use
   `git reset`, `git checkout`, or another destructive restoration shortcut.
5. Give every command a bounded timeout. A crash, malformed command, timeout, or
   interruption still enters the restoration path.
6. Restore the mutation before interpreting its result, then prove every
   affected file hash and the scoped diff match the baseline.
7. Never leave a mutation, temporary assertion, generated artifact, process,
   port, or fixture behind.

If exact restoration cannot be proven, stop and report `blocked`. A green test
run on a dirty or uncertain tree is not evidence.

## Gate

Establish the contract before touching production code:

1. Identify the changed assertion or test case and write its behavioral promise
   in one sentence.
2. Name the user-visible or operational observation it protects: return value,
   rendered UI, emitted event, persisted state, API response, billing effect, or
   another real boundary.
3. Run the smallest relevant test command once and require green.
4. Capture the baseline hashes and scoped diff for every file a mutation may
   touch.
5. Confirm that at least one credible mutation can change the promised
   observation while remaining syntactically and type valid.

An empty candidate set cannot pass. If no credible mutation exists after
reading the contract and reached path, report `not_verified` with the reason
instead of inventing a harmless mutation.

## Design 3-5 Mutations

Select three to five distinct failure surfaces when the behavior supports them.
Use fewer only when all credible surfaces are exhausted, and record why.
Quantity never justifies duplicate or unrealistic mutations.

Prefer real incident shapes:

- change a policy threshold, boundary, sign, unit, currency, or rounding rule;
- delete or invert an authorization, eligibility, validation, or idempotency
  guard;
- map an external field to the wrong internal meaning;
- treat a failure, timeout, empty result, or stale value as success;
- bypass a required confirmation, fee, inventory, or state transition;
- return, persist, emit, or render the wrong observable value.

Reject weak candidates:

- wording-only edits unrelated to the test promise;
- random code deletion with no plausible defect;
- changes that only produce syntax or type errors;
- mutations outside the path reached by the target test;
- refactors with identical observable behavior;
- multiple mutations that attack the same rule in the same way.

After attacking one rule, change the angle. For example, follow a boundary
mutation with guard deletion, response misclassification, or state-transition
corruption rather than another nearby numeric value.

## Predict Before Results

Append one prediction record to the mutation report **before** applying each
mutation:

```text
MUTATION M1
Risk: <real bug this represents>
Target: <file and symbol or line>
Temporary change: <precise semantic change>
Reachability proof: <why the selected test executes this path>
Observable change: <what a user or operator would see>
Predicted test: <exact test name>
Predicted failure: <assertion, status, value, event, or snapshot difference>
Validation command + deadline: <compile/type check or parser/loader preflight>
Test command + deadline: <exact test command and bounded deadline>
Restoration proof: <baseline hashes and scoped diff check>
```

Do not read the mutation result and then invent a prediction. The decision is:
"Did the named test fail for the named observable reason?" A generic non-zero
exit is insufficient.

## Execute One Mutation

For each prediction:

1. Reconfirm the baseline hashes.
2. Apply only that mutation.
3. Run the smallest compile or type check that covers the changed file. When
   the artifact has no compiler, run its parser or loader preflight instead.
4. If compilation succeeds, run the exact predicted test with a bounded
   timeout.
5. Capture exit status and the decisive output, including the failing test and
   assertion when present.
6. Apply the exact inverse patch immediately.
7. Verify hashes and scoped diff equal the baseline.
8. Only after restoration, classify the result.

Do not run mutations concurrently in one working tree. Do not stack a second
mutation on an unresolved first result. Long-running commands use the session's
background execution and observable completion channel; fixed sleeps and poll
loops are not evidence.

## Classify the Outcome

Use exactly one outcome per attempt:

| Outcome | Evidence | Action |
| --- | --- | --- |
| `killed` | The predicted test failed for the predicted observable reason. | Count the mutation as defended. |
| `survived_in_promise` | The mutation changed behavior promised by the target test, yet the relevant suite stayed green. | Repair the test now and rerun the same mutation. |
| `survived_unowned` | A real observable bug survived, but it is outside the current test's stated promise. | Add a concrete behavioral test task; do not mislabel it equivalent. |
| `misattributed` | A test failed, but not the predicted test or reason. | Diagnose the mismatch and replace or redesign the candidate. |
| `invalid` | Syntax, type checking, import, or startup failed before behavior was exercised. | Discard it and design a compile-valid replacement. |
| `unreached` | The selected test did not execute the mutated path. | Discard it and choose reached code or the correct test. |
| `equivalent` | The observable result is provably unchanged across the contract domain. | Record the proof and replace the candidate. |
| `inconclusive` | Tooling, environment, timeout, or restoration evidence is uncertain. | Resolve the uncertainty and rerun; it cannot pass the gate. |

Another test may kill the mutation before the predicted test does. Record the
actual owner. This proves suite-level defense but may still reveal that the
target test's stated promise is misleading; align the promise or assertion
rather than counting a generic failure.

When equivalence is uncertain, prefer `survived_unowned`. A plausible defect
must not disappear through optimistic classification.

## Repair Surviving Mutations

For `survived_in_promise`:

1. Keep production code restored.
2. Add the smallest assertion or case that observes the promised behavior.
3. Run the original code and require green.
4. Append a new prediction for the same mutation.
5. Apply the same mutation again.
6. Require the strengthened test to fail for the predicted reason.
7. Restore and re-prove the baseline.
8. Run the original test green once more.

For `survived_unowned`, create a test task whose title is the future behavioral
promise, not the discovery story. If that behavior is required by the active
goal, it remains blocking and must be implemented in the current loop.

Do not weaken an assertion, pin an internal implementation detail, or mock away
the integration merely to kill a mutation. The repaired test must observe the
same external contract a real consumer relies on.

## Restore and Verify

Restoration is part of every attempt, not end-of-run cleanup:

- compare each mutated file's content hash with its recorded baseline;
- compare the scoped diff with the pre-mutation diff;
- rerun the original focused test after any survivor repair;
- confirm no mutation marker, temporary fixture, process, port, or generated
  residue remains;
- capture a final status receipt.

If the source tree changes for legitimate implementation work between
mutations, establish a new baseline and mark earlier evidence as belonging to
the previous tree. Never relabel old output as evidence for new content.

## Report

Produce an auditable artifact:

```markdown
# Mutation verification

- Behavior promise:
- Baseline command and result:
- Baseline file hashes:
- Candidate budget:

| ID | Risk | Validation + deadline | Prediction | Result | Classification | Restoration |
| --- | --- | --- | --- | --- | --- | --- |

## Survivor repairs
- <test change, original-green proof, repeated-mutation proof>

## Candidate replacements
- <invalid, unreached, equivalent, misattributed, or inconclusive attempts>

## Final receipt
- Focused test:
- Type or compile check:
- Scoped diff:
- Final file hashes:
- Command deadlines:
- PID/PGID cleanup:
- Generated outputs:
- Residue check:
```

Under `ulw-loop`, store the report in the criterion's evidence artifact and
record it only after cleanup. Bind it to the current tree hash. If a commit is
explicitly authorized, summarize the result in that atomic commit; the report
remains the source of truth.

## Completion Contract

Mutation verification passes only when all are true:

- every selected candidate represents a distinct, realistic defect;
- every counted mutation is compile-valid, reached, and observably different;
- predictions were written before results;
- valid mutations were killed, or meaningful survivors were repaired and the
  same mutation then killed;
- invalid, unreached, equivalent, misattributed, and inconclusive attempts were
  replaced or explicitly left as blocking evidence;
- original focused tests and relevant type checks are green;
- exact restoration and residue checks match the baseline;
- the report names the behavior promise, commands, outcomes, repairs, and final
  tree receipt.

Stop as soon as this contract is proven. Tests alone, coverage alone, a mutation
score, or an unverified clean-looking diff do not prove completion.
