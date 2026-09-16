# QA: fix(senpi-task) batch spawn silently drops invalid items

Worktree: `~/omo-task-batch`, branch `fix/task-batch-silent-drop`, base `upstream/dev` @ `6c1ff1657`.

## What was tested

The `task` tool batch spawn path in `packages/senpi-task`, driven through its real entry points:

- `normalizeTaskToolArguments` (the tool's `prepareArguments` hook)
- `resolveSpawnItems` / `validateBatchShape` (validation)
- `buildTaskExecute` (the execute boundary, with a fake `TaskManager` that records every `start()` call)

Behaviour it was meant to prove: a batch containing items that fail validation must never return a
success-shaped response listing fewer children than were submitted.

## Root cause

Not the absence of per-item validation alone. The items were destroyed BEFORE validation ran.

`argument-normalization.ts` is registered as the tool's `prepareArguments`. Its `taskItems()` helper
`flatMap`ped away any item for which `taskItem()` returned `undefined`, and `taskItem()` returned
`undefined` whenever `prompt` was missing or blank. By the time `resolveSpawnItems` saw `params.tasks`,
the malformed items no longer existed, so validation had nothing to reject and the batch spawned only
the survivors, reporting `Batch running.` as a normal success.

## Chosen behaviour: (a) ATOMIC

Every other malformed-input path on this tool surface rejects the whole call with `invalid_arguments`
and spawns nothing:

- `execute.ts:25` - `invalidArguments()` for every batch-shape and item-target error
- `execute-batch.ts:125` - oversized batch (`> MAX_TASK_BATCH_ITEMS`) rejects the whole call
- `control/cancel.ts:32`, `control/send-results.ts:5`, `output/output.ts:127`, `team/lifecycle.ts:110`

There is no existing precedent anywhere in the package for a partially-executed call reporting
per-item rejections. Option (b) would have introduced a second, inconsistent error contract for one
failure mode. Atomic rejection also matches the requester's stated preference.

`SpawnItemsInvalidError` carries `rejected[]` (index + field + reason), `accepted`, and `submitted`,
so `accepted + rejected == submitted` is checkable directly from the error rather than inferred.

## What was observed

Command: `bun test packages/senpi-task/`

```
 1632 pass
 1 skip
 0 fail
 1 snapshots, 5168 expect() calls
Ran 1633 tests across 235 files. [29.12s]
```

Typecheck: `bunx tsgo --noEmit -p packages/senpi-task/tsconfig.json` - exit 0, no output.

### Failing-first proof

Source reverted (`git checkout` on `validation.ts` + `argument-normalization.ts`) with the new test
file left in place, then `bun test packages/senpi-task/src/tools/task/validation-item-rejection.test.ts`:

```
 7 pass
 13 fail
```

The 13 failures are exactly the bug-catching assertions. The 7 that still pass are the deliberate
no-regression guards (fully valid batch resolves, contentless provider padding still absorbed,
inheritance still applied, single-spawn `item_target` contract unchanged, valid background batch
still spawns all three).

The reproduction of the reported symptom is direct. The execute test routes its raw arguments through
the tool's real `prepareArguments` hook (`normalizeTaskToolArguments`), which is where the incident
actually destroyed the items. Against the unfixed code it fails at:

```
expect(startedIds).toEqual([])
error: expect(received).toEqual(expected)
- []
+ [ "one", ... ]
```

3 children spawned from a 6-item submission with no error surfaced - the reported incident.

## Review round

Two independent reviewers audited the first iteration (an `oracle` correctness review and a `deep`
adversarial empirical QA agent). Both reproduced the failing-first split and the green suite. Three
findings were accepted and fixed; one was rejected on evidence.

**Accepted - residual silent drop on the padding path.** `isProviderPaddingTask` classified ANY
blank-prompt item as provider padding. Combined with `tasksAreSinglePadding`, a call carrying a
top-level `prompt` plus batch items that omit `prompt` had its entire `tasks` array discarded, and
one unrelated child spawned under a success response. Verified directly: three lanes carrying
`name` + `description` + `task_summary` normalized to `tasks: undefined`. This is the same silent-drop
class the change exists to eliminate. Fixed by distinguishing padding from malformed real work: an
item is padding only when its prompt is a known padding token, or when it carries no content at all
(no name, description, category, target, model, skills, or summary). Blindly removing the blank-prompt
clause (the reviewer's literal suggestion) was rejected because it breaks absorption of genuine `{}`
padding items; the content check preserves both behaviors. Pinned by two new tests.

**Accepted - order-dependent fault reporting.** A target error at a lower index short-circuited with
`item_target` and masked every missing prompt after it, so identical fault sets reported differently
depending on item order, forcing the caller into the one-index-at-a-time loop the fix set out to
prevent. Batches now aggregate every fault into `invalid_items`; the single-spawn path keeps its
typed `item_target` first-error contract, which `execute.ts` depends on. Pinned by three new tests
asserting both orderings report both indices.

**Accepted - the execute test bypassed the real entry point.** It passed `prompt: ""` straight to
`buildTaskExecute`, so pre-fix it proved "spawns children with empty prompts" (6 starts) rather than
the reported 3-of-6 drop. It now routes through `normalizeTaskToolArguments` and reproduces the
incident exactly.

**Rejected - the claim that this change widened the padding hole.** One reviewer asserted the fix made
that drop newly reachable. The other reviewer's 2028-input differential sweep of the old and new
normalizer showed 0 regressions, 1182 drops fixed, and byte-identical output for the disputed input.
The hole was pre-existing, not introduced. It was fixed anyway because it is the same defect class.

Side effects of the aggregation change: three pre-existing tests in `validation.test.ts` that pinned
`item_target` for BATCH inputs now assert the aggregated `invalid_items` shape. The category+model
exclusivity RULE and its message remain asserted, including the inherited-model case.

## Acceptance criteria

1. Valid batch unchanged - covered by the two "no regression" tests plus the pre-existing
   `execute-batch.test.ts` suite, all green.
2. Missing `prompt` produces a clear error naming indices and the field - message reads
   `Rejected 3 of 6 task items; nothing was spawned. ... Invalid: item 1 (prompt: ...); item 3 ...`.
3. `accepted + rejected == submitted` asserted in
   `resolveSpawnItems spawned + rejected == submitted invariant`.
4. Inheritance runs BEFORE validation - asserted in `resolveSpawnItems inheritance precedes validation`;
   items carrying only a prompt inherit the top-level `subagent_type`/`model`/`load_skills` and resolve ok.
5. category + model exclusivity still rejected, own or inherited - still asserted by the pre-existing
   tests (batch cases now pin the aggregated `invalid_items` shape, single case still pins
   `item_target`), plus a new mixed-failure case.
6. `bun test packages/senpi-task/` passes in a single run.

## Scope

Limited to validation and its error reporting. The spawn path (`execute-batch.ts`, `execute-single.ts`,
the manager, the runners) is untouched. `item_target` keeps its existing first-error contract so the
three existing tests that pin it are unaffected; the new `invalid_items` code covers only the
previously-silent per-item hole, and folds a target error into the rejected list only when an earlier
item already failed (so no rejection is ever masked).

## What was omitted

No live Senpi session was driven. This change is pure input validation with no runtime, network, or
filesystem surface, and the execute-boundary test already asserts against a real `TaskManager` seam
that nothing spawns. No secrets or credentials were involved in any captured output.
