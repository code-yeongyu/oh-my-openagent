# Fix Prompt Hang Race

## TL;DR
> Summary:      Fix OMO's internal prompt gate so failed or timed-out prompt dispatches do not leave a stale reservation that blocks sibling recovery prompts after OpenCode `promptAsync` returns before durable prompt completion. Keep behavior unchanged except the bug fix, prove it with failing-first Bun tests, actual tmux-backed QA, CI, review-work, and Cubic before merge.
> Deliverables:
> - Shared prompt gate regression tests and minimal gate cleanup fix
> - Route-level regressions for model fallback, runtime fallback, background wakes, and team live delivery
> - Updated `.debugging` journal with root-cause evidence and cleanup ledger
> - PR against `dev`, green CI, review-work pass, Cubic pass, merged branch, removed worktree
> Effort:       Medium
> Risk:         High — async prompt acceptance is fire-and-forget upstream, so duplicate suppression and recovery retry timing are easy to regress.

## Scope
### Must have
- Work only in `/Users/yeongyu/local-workspaces/gpt 5.5 xhigh` on branch `code-yeongyu/fix-prompt-hang-race`.
- Preserve the sibling OpenCode repo at `/Users/yeongyu/local-workspaces/opencode`; read and run it only as evidence unless an explicit later request changes scope.
- Keep `.debugging` current with hypotheses, red/green evidence, manual QA evidence, artifacts, and cleanup status.
- Add failing-first tests before the fix for the stale prompt reservation behavior.
- Fix the smallest mechanism that makes failed or timed-out prompt dispatches release their reservation promptly while successful dispatches still dedupe immediate duplicate prompts.
- Cover main-session internal prompt routes: model fallback, runtime fallback, session recovery, background-agent parent wakes, and team-mode live delivery/wake hints.
- Run actual manual QA through local commands and tmux sessions owned by this task.
- Commit atomically, create a PR, iterate until CI, review-work, and Cubic are all passing, merge, then remove the worktree.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- Do not modify sibling OpenCode product code.
- Do not kill the tmux server; only kill tmux sessions created by this task.
- Do not add compatibility layers, config switches, broad retry frameworks, or unrelated refactors.
- Do not bypass `src/shared/prompt-async-gate.ts` for any production internal prompt route.
- Do not delete failing tests, suppress type errors, use `as any`, `@ts-ignore`, or `@ts-expect-error`.
- Do not use `git reset --hard`, `git checkout --`, `rm -rf`, `--no-verify`, or direct `bun publish`.
- Do not treat a passing unit suite as enough; actual QA must exercise the local OpenCode/OMO prompt path.

## Verification strategy
> Zero human intervention — all verification is agent-executed.
- Test decision: TDD + Bun test (`bun:test`)
- QA policy: every task has agent-executed scenarios
- Evidence: `evidence/task-<N>-<slug>.<ext>`

## Execution strategy
### Parallel execution waves
> Target 5–8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks to maximize parallelism.

Wave 1 (no dependencies):
- Task 1: Confirm root cause and journal evidence
- Task 2: Fix shared prompt gate reservation semantics
- Task 3: Strengthen static prompt-route audit

Wave 2 (after Wave 1):
- Task 4: depends [2, 3]
- Task 5: depends [2, 3]
- Task 6: depends [2, 3]
- Task 7: depends [2, 3]

Wave 3 (after Wave 2):
- Task 8: depends [4, 5]
- Task 9: depends [4, 5, 6]
- Task 10: depends [6, 7]
- Task 11: depends [1, 2, 3, 4, 5, 6, 7]

Wave 4 (after Wave 3):
- Task 12: depends [8, 9, 10, 11]

Critical path: Task 2 → Task 4 → Task 8 → Task 11 → Task 12

### Dependency matrix
| Task | Depends on | Blocks | Can parallelize with |
|------|------------|--------|----------------------|
| 1    | none       | 11     | 2, 3                 |
| 2    | none       | 4, 5, 6, 7, 11 | 1, 3       |
| 3    | none       | 4, 5, 6, 7, 11 | 1, 2       |
| 4    | 2, 3       | 8, 9, 11 | 5, 6, 7          |
| 5    | 2, 3       | 8, 9, 11 | 4, 6, 7          |
| 6    | 2, 3       | 9, 10, 11 | 4, 5, 7        |
| 7    | 2, 3       | 10, 11 | 4, 5, 6           |
| 8    | 4, 5       | 12     | 9, 10, 11          |
| 9    | 4, 5, 6    | 12     | 8, 10, 11          |
| 10   | 6, 7       | 12     | 8, 9, 11           |
| 11   | 1, 2, 3, 4, 5, 6, 7 | 12 | 8, 9, 10 |
| 12   | 8, 9, 10, 11 | none | none                |

## Todos
> Implementation + Test = ONE task. Never separate.
> Every task MUST have: References + Acceptance Criteria + QA Scenarios + Commit.

- [ ] 1. Confirm root cause and journal evidence

  What to do: Update `.debugging` with the confirmed causal chain and the exact evidence already found: OpenCode `promptAsync` returns 204 after forking `SessionPrompt.prompt`, the fork later publishes `session.error` on failure, and OMO's gate can leave a short-lived reservation that overlaps recovery routes. Add the red/green/QA evidence ledger sections before creating more artifacts.
  Must NOT do: Do not alter source code in this task. Do not remove existing `.debugging` entries.

  Parallelization: Can parallel: YES | Wave 1 | Blocks: [11] | Blocked by: []

  References (executor has NO interview context — be exhaustive):
  - Pattern:  `.debugging:58` — existing 2026-05-17 journal run starts here and must be preserved.
  - Pattern:  `.debugging:81` — existing hypothesis says OpenCode `promptAsync` can resolve before durable acceptance.
  - Pattern:  `.debugging:86` — existing artifact ledger includes the worktree and branch cleanup obligations.
  - API/Type: `/Users/yeongyu/local-workspaces/opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts:295` — `promptAsync` handler starts.
  - API/Type: `/Users/yeongyu/local-workspaces/opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts:300` — handler calls `promptSvc.prompt`.
  - API/Type: `/Users/yeongyu/local-workspaces/opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts:306` — fork failure publishes `Session.Event.Error`.
  - API/Type: `/Users/yeongyu/local-workspaces/opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts:312` — prompt effect is forked with `startImmediately: true`.
  - API/Type: `/Users/yeongyu/local-workspaces/opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts:314` — handler returns `NoContent`.
  - API/Type: `/Users/yeongyu/local-workspaces/opencode/packages/opencode/src/session/prompt.ts:1092` — `createUserMessage` starts.
  - API/Type: `/Users/yeongyu/local-workspaces/opencode/packages/opencode/src/session/prompt.ts:1098` — invalid agent creates `NamedError.Unknown`.
  - API/Type: `/Users/yeongyu/local-workspaces/opencode/packages/opencode/src/session/prompt.ts:1099` — invalid agent publishes `Session.Event.Error`.
  - API/Type: `/Users/yeongyu/local-workspaces/opencode/packages/opencode/src/session/prompt.ts:1614` — `SessionPrompt.prompt` returns a completed `MessageV2.WithParts` effect.
  - API/Type: `/Users/yeongyu/local-workspaces/opencode/packages/opencode/src/session/prompt.ts:1631` — `noReply` returns after user message creation.
  - API/Type: `/Users/yeongyu/local-workspaces/opencode/packages/sdk/js/src/gen/sdk.gen.ts:637` — SDK says `promptAsync` returns immediately.
  - API/Type: `/Users/yeongyu/local-workspaces/opencode/packages/sdk/js/src/gen/types.gen.ts:2723` — `SessionPromptAsyncResponses` type starts.
  - API/Type: `/Users/yeongyu/local-workspaces/opencode/packages/sdk/js/src/gen/types.gen.ts:2727` — `promptAsync` success is `204: void`.
  - External: `https://github.com/anomalyco/opencode/issues/11616` — public docs issue describes `/prompt_async` as returning immediately and lists `session.error`.
  - External: `https://github.com/anomalyco/opencode/issues/12860` — public issue reports `/prompt_async` status can stay unknown after submission.

  Acceptance criteria (agent-executable only):
  - [ ] `rg -n "Root cause|promptAsync|204|session.error|NoContent|fork" .debugging` prints the updated root-cause section.
  - [ ] `rg -n "Artifacts To Revert|worktree|code-yeongyu/fix-prompt-hang-race|tmux" .debugging` confirms the cleanup ledger mentions the branch, worktree, and tmux constraints.
  - [ ] `git diff -- .debugging > evidence/task-1-journal.diff` captures only journal changes for this task.

  QA scenarios (MANDATORY — task incomplete without these):
  ```
  Scenario: root-cause journal is complete
    Tool:     bash
    Steps:    mkdir -p evidence; rg -n "Root cause|promptAsync|204|session.error|forkIn|NoContent" .debugging | tee evidence/task-1-journal.txt
    Expected: output contains .debugging lines for OpenCode 204, forked prompt completion, later session.error, and OMO reservation overlap.
    Evidence: evidence/task-1-journal.txt

  Scenario: cleanup ledger is preserved
    Tool:     bash
    Steps:    rg -n "remove after merged PR|Never kill tmux server|worktree|branch" .debugging | tee evidence/task-1-cleanup-ledger.txt
    Expected: output contains cleanup instructions for the PR branch/worktree and tmux server guardrail.
    Evidence: evidence/task-1-cleanup-ledger.txt
  ```

  Commit: YES | Message: `test(debugging): document prompt async race evidence` | Files: [`.debugging`]

- [ ] 2. Fix shared prompt gate reservation semantics

  What to do: Add failing-first tests in the existing gate test file proving that timed-out and rejected dispatches release their reservation even when `postDispatchHoldMs` is the default, while successful dispatches keep the short post-dispatch hold. Then minimally change `src/shared/prompt-async-gate.ts` so post-dispatch hold is applied only after a real `dispatched` result, not merely after `dispatchAttempted = true`. If the executor confirms that OpenCode's 204 is still too early for recovery routes, keep the gate change minimal and leave route-triggered release to Tasks 4 and 5.
  Must NOT do: Do not remove the successful-dispatch hold. Do not add a queue, debounce framework, global lock, or new config option.

  Parallelization: Can parallel: YES | Wave 1 | Blocks: [4, 5, 6, 7, 11] | Blocked by: []

  References (executor has NO interview context — be exhaustive):
  - Pattern:  `src/shared/prompt-async-gate.ts:97` — timeout wrapper starts.
  - Pattern:  `src/shared/prompt-async-gate.ts:122` — `dispatchAfterSessionIdle` starts.
  - Pattern:  `src/shared/prompt-async-gate.ts:158` — reservation object is created.
  - Pattern:  `src/shared/prompt-async-gate.ts:163` — reservation is stored before dispatch.
  - Pattern:  `src/shared/prompt-async-gate.ts:164` — current `dispatchAttempted` flag starts the risky state.
  - Pattern:  `src/shared/prompt-async-gate.ts:190` — dispatch is marked attempted before awaiting the SDK call.
  - Pattern:  `src/shared/prompt-async-gate.ts:191` — dispatch is wrapped with timeout.
  - Pattern:  `src/shared/prompt-async-gate.ts:197` — only this path returns `dispatched`.
  - Pattern:  `src/shared/prompt-async-gate.ts:198` — failure path returns `failed`.
  - Pattern:  `src/shared/prompt-async-gate.ts:201` — cleanup starts.
  - Pattern:  `src/shared/prompt-async-gate.ts:204` — current hold applies after any attempted dispatch.
  - Pattern:  `src/hooks/shared/prompt-async-gate.test.ts:60` — existing successful-dispatch hold test.
  - Pattern:  `src/hooks/shared/prompt-async-gate.test.ts:282` — existing timeout test uses `postDispatchHoldMs: 0`; add the default-hold regression beside it.
  - Pattern:  `src/hooks/shared/prompt-async-gate.test.ts:321` — existing rejected-dispatch test currently expects duplicate blocking; update or supersede with the corrected failing-first behavior.
  - Test:     `src/hooks/shared/prompt-async-gate.test.ts` — co-located Bun tests import from the shared gate re-export.

  Acceptance criteria (agent-executable only):
  - [ ] Before changing `src/shared/prompt-async-gate.ts`, `bun test src/hooks/shared/prompt-async-gate.test.ts --bail` fails on the new timeout/rejection reservation test; save output to `evidence/task-2-red.txt`.
  - [ ] After the minimal fix, `bun test src/hooks/shared/prompt-async-gate.test.ts --bail` passes; save output to `evidence/task-2-green.txt`.
  - [ ] `bun test src/shared/prompt-async-route-audit.test.ts src/hooks/shared/prompt-async-gate.test.ts --bail` passes.
  - [ ] `git diff -- src/shared/prompt-async-gate.ts src/hooks/shared/prompt-async-gate.test.ts` shows no unrelated refactor.

  QA scenarios (MANDATORY — task incomplete without these):
  ```
  Scenario: failed promptAsync releases reservation
    Tool:     bash
    Steps:    mkdir -p evidence; bun test src/hooks/shared/prompt-async-gate.test.ts --bail 2>&1 | tee evidence/task-2-green.txt
    Expected: test output exits 0 and includes the new case where an immediate rejected dispatch lets the next caller attempt dispatch instead of returning reserved.
    Evidence: evidence/task-2-green.txt

  Scenario: successful promptAsync still dedupes immediate duplicate
    Tool:     bash
    Steps:    bun test src/hooks/shared/prompt-async-gate.test.ts --bail 2>&1 | tee evidence/task-2-success-hold.txt
    Expected: existing successful hold tests still pass and assert prompt call count remains 1 for immediate duplicate after dispatch.
    Evidence: evidence/task-2-success-hold.txt
  ```

  Commit: YES | Message: `fix(prompt-gate): release failed dispatch reservations` | Files: [`src/shared/prompt-async-gate.ts`, `src/hooks/shared/prompt-async-gate.test.ts`]

- [ ] 3. Strengthen static prompt-route audit

  What to do: Extend `src/shared/prompt-async-route-audit.test.ts` only if needed so the production invariant remains pinned: raw `session.prompt`/`session.promptAsync` calls stay inside the shared gate or documented wrappers, production callers cannot set `postDispatchHoldMs: 0`, and new route wrappers must throw or requeue on `failed` instead of silently dropping prompt failures. Keep the allowlist small and documented.
  Must NOT do: Do not add a broad allowlist for convenience. Do not weaken the existing raw-prompt scanner.

  Parallelization: Can parallel: YES | Wave 1 | Blocks: [4, 5, 6, 7, 11] | Blocked by: []

  References (executor has NO interview context — be exhaustive):
  - Pattern:  `src/shared/prompt-async-route-audit.test.ts:6` — `SOURCE_ROOT` points at production `src`.
  - Pattern:  `src/shared/prompt-async-route-audit.test.ts:8` — current raw prompt allowlist begins.
  - Pattern:  `src/shared/prompt-async-route-audit.test.ts:48` — AST helper extracts property names.
  - Pattern:  `src/shared/prompt-async-route-audit.test.ts:106` — raw prompt property detection starts.
  - Pattern:  `src/shared/prompt-async-route-audit.test.ts:139` — destructured prompt binding detection starts.
  - Pattern:  `src/shared/prompt-async-route-audit.test.ts:249` — production raw prompt audit test starts.
  - Pattern:  `src/shared/prompt-async-route-audit.test.ts:270` — production `postDispatchHoldMs: 0` audit starts.
  - Pattern:  `src/plugin/unstable-agent-babysitter.ts:29` — wrapper currently ignores non-failed statuses and should be assessed by audit or route tests.
  - Pattern:  `src/features/background-agent/parent-wake-notifier.ts:153` — failed result is thrown and requeued in catch.
  - Pattern:  `src/features/team-mode/tools/messaging.ts:212` — non-dispatched live delivery falls back to inbox.

  Acceptance criteria (agent-executable only):
  - [ ] `bun test src/shared/prompt-async-route-audit.test.ts --bail` passes.
  - [ ] If the audit is changed, first save a red run in `evidence/task-3-red.txt` proving the audit catches the intended bad pattern.
  - [ ] `rg -n "postDispatchHoldMs\\s*:\\s*0" src --glob '*.ts' --glob '!*.test.ts'` returns no production offenders.
  - [ ] `bun test src/shared/prompt-async-route-audit.test.ts src/hooks/shared/prompt-async-gate.test.ts --bail` passes.

  QA scenarios (MANDATORY — task incomplete without these):
  ```
  Scenario: raw prompt audit remains strict
    Tool:     bash
    Steps:    mkdir -p evidence; bun test src/shared/prompt-async-route-audit.test.ts --bail 2>&1 | tee evidence/task-3-audit.txt
    Expected: command exits 0 and reports the production prompt route audit passing with the existing narrow allowlist.
    Evidence: evidence/task-3-audit.txt

  Scenario: production callers do not disable the hold
    Tool:     bash
    Steps:    rg -n "postDispatchHoldMs\\s*:\\s*0" src --glob '*.ts' --glob '!*.test.ts' 2>&1 | tee evidence/task-3-hold-audit.txt; test "${PIPESTATUS[0]}" -eq 1
    Expected: no production TypeScript file sets postDispatchHoldMs to 0.
    Evidence: evidence/task-3-hold-audit.txt
  ```

  Commit: YES | Message: `test(prompt-gate): audit internal prompt routes` | Files: [`src/shared/prompt-async-route-audit.test.ts`]

- [ ] 4. Cover model-fallback promptAsync overlap

  What to do: Add or update model-fallback tests so an OpenCode-style sequence is pinned: first internal `promptAsync` returns/appears accepted, then a `session.error` arrives before the post-dispatch hold expires. Same-model duplicate events must remain deduped, but a legitimate next fallback/recovery route must not be skipped solely because of a stale reservation. Make the smallest route fix in `src/plugin/event.ts` only if the shared gate fix does not satisfy the tests.
  Must NOT do: Do not merge model-fallback and runtime-fallback state machines. Do not broaden fallback eligibility.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [8, 9, 11] | Blocked by: [2, 3]

  References (executor has NO interview context — be exhaustive):
  - Pattern:  `src/plugin/event.ts:451` — `autoContinueAfterFallback` starts.
  - Pattern:  `src/plugin/event.ts:462` — `modelFallbackContinuationsInFlight` is set.
  - Pattern:  `src/plugin/event.ts:465` — route aborts the active session before retry.
  - Pattern:  `src/plugin/event.ts:468` — route releases model-fallback reservations by exact source/prefix.
  - Pattern:  `src/plugin/event.ts:499` — async prompt path starts.
  - Pattern:  `src/plugin/event.ts:500` — route dispatches through `promptAsyncAfterSessionIdle`.
  - Pattern:  `src/plugin/event.ts:506` — `dispatched` sets `dispatched = true`.
  - Pattern:  `src/plugin/event.ts:508` — failed prompt is logged.
  - Pattern:  `src/plugin/event.ts:530` — cleanup/fallback dedupe state starts.
  - Pattern:  `src/plugin/event.model-fallback.test.ts:169` — existing overlapping error-events regression.
  - Pattern:  `src/plugin/event.model-fallback.test.ts:248` — existing providerless duplicate regression.
  - Pattern:  `src/plugin/event.model-fallback.test.ts:308` — existing distinct-provider regression expects two retries.
  - API/Type: `/Users/yeongyu/local-workspaces/opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts:295` — upstream `promptAsync` handler returns before prompt completion.
  - API/Type: `/Users/yeongyu/local-workspaces/opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts:306` — upstream later failure publishes `session.error`.

  Acceptance criteria (agent-executable only):
  - [ ] Before route or shared-gate fix is applied, save a red run for the new model-fallback overlap test in `evidence/task-4-red.txt`.
  - [ ] `bun test src/plugin/event.model-fallback.test.ts --bail` passes after the fix.
  - [ ] Existing duplicate suppression tests still assert one dispatch for same failed model and two dispatches for distinct providers.
  - [ ] `git diff -- src/plugin/event.ts src/plugin/event.model-fallback.test.ts` shows only fallback prompt reservation/recovery changes and tests.

  QA scenarios (MANDATORY — task incomplete without these):
  ```
  Scenario: duplicate same-model fallback remains suppressed
    Tool:     bash
    Steps:    mkdir -p evidence; bun test src/plugin/event.model-fallback.test.ts --bail 2>&1 | tee evidence/task-4-model-fallback.txt
    Expected: command exits 0; assertions around overlapping same-model events still show one prompt dispatch.
    Evidence: evidence/task-4-model-fallback.txt

  Scenario: distinct provider fallback is not blocked by stale reservation
    Tool:     bash
    Steps:    bun test src/plugin/event.model-fallback.test.ts --bail 2>&1 | tee evidence/task-4-distinct-provider.txt
    Expected: command exits 0; distinct-provider regression asserts two prompt dispatches rather than a reserved skip.
    Evidence: evidence/task-4-distinct-provider.txt
  ```

  Commit: YES | Message: `test(model-fallback): cover prompt async error overlap` | Files: [`src/plugin/event.ts`, `src/plugin/event.model-fallback.test.ts`]

- [ ] 5. Cover runtime-fallback retry cleanup

  What to do: Add runtime-fallback tests proving a failed, timed-out, or OpenCode-style async error retry clears `sessionRetryInFlight`, `sessionAwaitingFallbackResult`, fallback timeout, and pending model state so the next eligible fallback attempt can dispatch. Make the smallest fix in `src/hooks/runtime-fallback/auto-retry.ts` if state cleanup or reservation release is incomplete.
  Must NOT do: Do not change fallback model selection order, cooldown policy, or visible-response detection.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [8, 9, 11] | Blocked by: [2, 3]

  References (executor has NO interview context — be exhaustive):
  - Pattern:  `src/hooks/runtime-fallback/auto-retry.ts:38` — `abortSessionRequest` starts.
  - Pattern:  `src/hooks/runtime-fallback/auto-retry.ts:50` — abort call is issued.
  - Pattern:  `src/hooks/runtime-fallback/auto-retry.ts:51` — runtime-fallback reservation release happens after abort.
  - Pattern:  `src/hooks/runtime-fallback/auto-retry.ts:72` — fallback timeout scheduling starts.
  - Pattern:  `src/hooks/runtime-fallback/auto-retry.ts:113` — `autoRetryWithFallback` starts.
  - Pattern:  `src/hooks/runtime-fallback/auto-retry.ts:140` — retry-in-flight is set.
  - Pattern:  `src/hooks/runtime-fallback/auto-retry.ts:157` — awaiting fallback result is set.
  - Pattern:  `src/hooks/runtime-fallback/auto-retry.ts:160` — route dispatches through `promptAsyncAfterSessionIdle`.
  - Pattern:  `src/hooks/runtime-fallback/auto-retry.ts:177` — failed gate result throws.
  - Pattern:  `src/hooks/runtime-fallback/auto-retry.ts:193` — cleanup begins.
  - Pattern:  `src/hooks/runtime-fallback/auto-retry.ts:195` — non-dispatched retries clear awaiting state and timeout.
  - Pattern:  `src/hooks/runtime-fallback/index.test.ts:1274` — existing in-flight race test starts.
  - Pattern:  `src/hooks/runtime-fallback/index.test.ts:1352` — existing force-advance retry signal test starts.
  - Test:     `src/hooks/runtime-fallback/index.test.ts` — broad runtime fallback integration tests.
  - Test:     `src/hooks/runtime-fallback/success-retry-key-cleanup.test.ts` — cleanup-specific test style.

  Acceptance criteria (agent-executable only):
  - [ ] Red evidence saved to `evidence/task-5-red.txt` for the new retry cleanup regression before implementation.
  - [ ] `bun test src/hooks/runtime-fallback/index.test.ts src/hooks/runtime-fallback/success-retry-key-cleanup.test.ts --bail` passes.
  - [ ] New assertions prove a second fallback attempt reaches `promptAsync` after the first failed or timed out attempt.
  - [ ] No existing runtime-fallback duplicate suppression test starts dispatching duplicate same-source retries.

  QA scenarios (MANDATORY — task incomplete without these):
  ```
  Scenario: failed runtime fallback retry clears state
    Tool:     bash
    Steps:    mkdir -p evidence; bun test src/hooks/runtime-fallback/index.test.ts src/hooks/runtime-fallback/success-retry-key-cleanup.test.ts --bail 2>&1 | tee evidence/task-5-runtime-fallback.txt
    Expected: command exits 0 and includes the new cleanup regression.
    Evidence: evidence/task-5-runtime-fallback.txt

  Scenario: in-flight duplicate suppression still works
    Tool:     bash
    Steps:    bun test src/hooks/runtime-fallback/index.test.ts --bail 2>&1 | tee evidence/task-5-inflight.txt
    Expected: command exits 0 and the existing in-flight race test still expects a single fallback preparation while the retry is pending.
    Evidence: evidence/task-5-inflight.txt
  ```

  Commit: YES | Message: `fix(runtime-fallback): clear failed retry prompt state` | Files: [`src/hooks/runtime-fallback/auto-retry.ts`, `src/hooks/runtime-fallback/index.test.ts`, `src/hooks/runtime-fallback/success-retry-key-cleanup.test.ts`]

- [ ] 6. Cover background-agent prompt wake and resume paths

  What to do: Add tests around background-agent launch/resume/parent-wake prompt failures so a failed or timed-out gated prompt does not leave the task in a hanging in-between state and does not block the retry/restore path behind a stale reservation. Fix only the affected background-agent path if the shared gate is not enough.
  Must NOT do: Do not change background concurrency limits, polling stability thresholds, task state schema, or tmux behavior.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [9, 10, 11] | Blocked by: [2, 3]

  References (executor has NO interview context — be exhaustive):
  - Pattern:  `src/features/background-agent/manager.ts:831` — task history records launch state before prompt dispatch.
  - Pattern:  `src/features/background-agent/manager.ts:892` — launch prompt uses `promptWithRetryInDirectory`.
  - Pattern:  `src/features/background-agent/manager.ts:895` — launch prompt failure is caught.
  - Pattern:  `src/features/background-agent/manager.ts:947` — launch prompt failure can try fallback retry.
  - Pattern:  `src/features/background-agent/manager.ts:1279` — resume path comments fire-and-forget prompt.
  - Pattern:  `src/features/background-agent/manager.ts:1293` — resume dispatches through `promptAsyncAfterSessionIdle`.
  - Pattern:  `src/features/background-agent/manager.ts:1321` — failed resume prompt throws into catch.
  - Pattern:  `src/features/background-agent/manager.ts:1339` — resume failure can try fallback retry.
  - Pattern:  `src/features/background-agent/parent-wake-notifier.ts:137` — parent wake dispatches through `promptAsyncAfterSessionIdle`.
  - Pattern:  `src/features/background-agent/parent-wake-notifier.ts:153` — failed parent wake throws and requeues.
  - Pattern:  `src/features/background-agent/manager.test.ts:7548` — existing stale launch prompt error regression.
  - Pattern:  `src/features/background-agent/manager.test.ts:7556` — existing launch prompt can remain pending until rejected.
  - Test:     `src/features/background-agent/manager.test.ts` — large integration-style manager test file.
  - Test:     `src/features/background-agent/parent-wake-notifier.test.ts` — use if present; otherwise add focused coverage next to the notifier.

  Acceptance criteria (agent-executable only):
  - [ ] Red evidence saved to `evidence/task-6-red.txt` before background-agent fix.
  - [ ] `bun test src/features/background-agent/manager.test.ts --bail` passes.
  - [ ] If a notifier test file exists or is added, `bun test src/features/background-agent/parent-wake-notifier.test.ts --bail` passes.
  - [ ] Assertions prove failed parent wake is requeued and failed resume restores or transitions task state instead of leaving an in-flight prompt hang.

  QA scenarios (MANDATORY — task incomplete without these):
  ```
  Scenario: launch/resume failure does not hang task state
    Tool:     bash
    Steps:    mkdir -p evidence; bun test src/features/background-agent/manager.test.ts --bail 2>&1 | tee evidence/task-6-background-manager.txt
    Expected: command exits 0 and includes the new failed prompt launch/resume regression.
    Evidence: evidence/task-6-background-manager.txt

  Scenario: parent wake is requeued after failed prompt
    Tool:     bash
    Steps:    if [ -f src/features/background-agent/parent-wake-notifier.test.ts ]; then bun test src/features/background-agent/parent-wake-notifier.test.ts --bail; else bun test src/features/background-agent/manager.test.ts --bail; fi 2>&1 | tee evidence/task-6-parent-wake.txt
    Expected: command exits 0 and the tested path asserts a wake is requeued after a failed gated prompt.
    Evidence: evidence/task-6-parent-wake.txt
  ```

  Commit: YES | Message: `test(background-agent): cover failed prompt wake recovery` | Files: [`src/features/background-agent/manager.ts`, `src/features/background-agent/manager.test.ts`, `src/features/background-agent/parent-wake-notifier.ts`, `src/features/background-agent/parent-wake-notifier.test.ts`]

- [ ] 7. Cover team-mode live delivery and wake hint paths

  What to do: Add tests proving team live delivery and idle wake hints recover from failed or gated prompt dispatch by leaving mailbox fallback paths available and not permanently reserving the recipient session. Fix only the affected team route if the shared gate is not enough.
  Must NOT do: Do not change team storage schema, member eligibility, worktree creation, or tmux layout behavior.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [10, 11] | Blocked by: [2, 3]

  References (executor has NO interview context — be exhaustive):
  - Pattern:  `src/features/team-mode/tools/messaging.ts:155` — `deliverLive` starts.
  - Pattern:  `src/features/team-mode/tools/messaging.ts:168` — mailbox reservation is taken before live delivery.
  - Pattern:  `src/features/team-mode/tools/messaging.ts:202` — live delivery dispatches through `promptAsyncAfterSessionIdle`.
  - Pattern:  `src/features/team-mode/tools/messaging.ts:212` — non-dispatched live delivery falls back to inbox injection.
  - Pattern:  `src/features/team-mode/tools/messaging.ts:234` — live delivery catch releases mailbox reservation.
  - Pattern:  `src/hooks/team-session-events/team-idle-wake-hint.ts:102` — wake hint skips if promptAsync unavailable.
  - Pattern:  `src/hooks/team-session-events/team-idle-wake-hint.ts:114` — wake hint dispatches through `promptAsyncAfterSessionIdle`.
  - Pattern:  `src/hooks/team-session-events/team-idle-wake-hint.ts:125` — non-dispatched wake hint is logged.
  - Test:     `src/features/team-mode/tools/messaging.test.ts` — live delivery tests include network-down cases around line 615.
  - Test:     `src/hooks/team-session-events/team-idle-wake-hint.test.ts` — wake hint tests cover dispatch and skip behavior.

  Acceptance criteria (agent-executable only):
  - [ ] Red evidence saved to `evidence/task-7-red.txt` before team-mode fix.
  - [ ] `bun test src/features/team-mode/tools/messaging.test.ts src/hooks/team-session-events/team-idle-wake-hint.test.ts --bail` passes.
  - [ ] Live delivery failure releases mailbox reservation and leaves the message available for inbox fallback.
  - [ ] Wake hint failure does not leave recipient session reserved for the next legitimate prompt.

  QA scenarios (MANDATORY — task incomplete without these):
  ```
  Scenario: team live delivery fallback remains available
    Tool:     bash
    Steps:    mkdir -p evidence; bun test src/features/team-mode/tools/messaging.test.ts --bail 2>&1 | tee evidence/task-7-team-messaging.txt
    Expected: command exits 0 and includes failed live-delivery fallback coverage.
    Evidence: evidence/task-7-team-messaging.txt

  Scenario: team wake hint does not poison prompt gate
    Tool:     bash
    Steps:    bun test src/hooks/team-session-events/team-idle-wake-hint.test.ts --bail 2>&1 | tee evidence/task-7-team-wake.txt
    Expected: command exits 0 and includes the wake-hint failure or gated retry regression.
    Evidence: evidence/task-7-team-wake.txt
  ```

  Commit: YES | Message: `test(team-mode): cover failed live prompt delivery` | Files: [`src/features/team-mode/tools/messaging.ts`, `src/features/team-mode/tools/messaging.test.ts`, `src/hooks/team-session-events/team-idle-wake-hint.ts`, `src/hooks/team-session-events/team-idle-wake-hint.test.ts`]

- [ ] 8. Manual QA direct upstream promptAsync failure path

  What to do: Exercise the sibling OpenCode promptAsync behavior against a local session so the evidence shows `prompt_async` returns before the later failure event. Use a task-owned tmux session or direct command with bounded polling. Capture request, status, emitted error, and cleanup commands.
  Must NOT do: Do not modify sibling OpenCode code. Do not kill the tmux server. Do not rely on a simulated unit test for this task.

  Parallelization: Can parallel: YES | Wave 3 | Blocks: [12] | Blocked by: [4, 5]

  References (executor has NO interview context — be exhaustive):
  - API/Type: `/Users/yeongyu/local-workspaces/opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts:295` — promptAsync handler.
  - API/Type: `/Users/yeongyu/local-workspaces/opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts:306` — later failure event publication.
  - API/Type: `/Users/yeongyu/local-workspaces/opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts:314` — NoContent return.
  - API/Type: `/Users/yeongyu/local-workspaces/opencode/packages/opencode/src/session/prompt.ts:1098` — invalid agent error.
  - API/Type: `/Users/yeongyu/local-workspaces/opencode/packages/sdk/js/src/gen/types.gen.ts:2727` — SDK success response is 204 void.
  - Pattern:  `.debugging:86` — cleanup ledger must track tmux sessions and worktree cleanup.
  - Test:     `packages/opencode/test/server/httpapi-promptasync-context.test.ts` in sibling repo — upstream already has promptAsync context coverage and can be used as a reference pattern.

  Acceptance criteria (agent-executable only):
  - [ ] `evidence/task-8-opencode-promptasync.txt` contains a 204/NoContent observation and a later `session.error` observation for the same session.
  - [ ] `.debugging` records the manual QA command, evidence path, and owned tmux session name if tmux is used.
  - [ ] Any tmux session created by this task is killed by name after evidence capture; `tmux ls` still works and no `kill-server` command is used.

  QA scenarios (MANDATORY — task incomplete without these):
  ```
  Scenario: upstream promptAsync returns before durable completion
    Tool:     tmux
    Steps:    mkdir -p evidence; create a task-owned tmux session named omo-promptasync-upstream-qa that starts or connects to local OpenCode, creates a session, posts /prompt_async with an invalid agent, subscribes to events, writes the 204 response and subsequent session.error to evidence/task-8-opencode-promptasync.txt, signals completion with tmux wait-for; then kill only tmux session omo-promptasync-upstream-qa.
    Expected: evidence file contains the same session id, HTTP 204 or NoContent for prompt_async, and later session.error with Agent not found or equivalent prompt failure.
    Evidence: evidence/task-8-opencode-promptasync.txt

  Scenario: tmux server is preserved
    Tool:     bash
    Steps:    tmux ls 2>&1 | tee evidence/task-8-tmux-ls.txt
    Expected: command succeeds or reports no sessions; no task command used tmux kill-server.
    Evidence: evidence/task-8-tmux-ls.txt
  ```

  Commit: NO | Message: `n/a` | Files: [`evidence/task-8-opencode-promptasync.txt`, `.debugging`]

- [ ] 9. Manual QA OMO main-session no-hang path

  What to do: Run an actual OMO/OpenCode session in a task-owned tmux session and reproduce the original main-session internal prompt race as closely as possible: trigger an internal fallback/recovery prompt, force a prompt failure or timeout, and verify the next recovery/fallback prompt is dispatched or requeued instead of hanging behind `reserved`. Capture `/tmp/oh-my-opencode.log`, session output, and final status.
  Must NOT do: Do not declare success from tests alone. Do not kill global tmux server. Do not leave an OpenCode server or task-owned tmux session running.

  Parallelization: Can parallel: YES | Wave 3 | Blocks: [12] | Blocked by: [4, 5, 6]

  References (executor has NO interview context — be exhaustive):
  - Pattern:  `package.json:24` — scripts section starts.
  - Pattern:  `package.json:25` — `bun run build` command.
  - Pattern:  `package.json:36` — `bun run typecheck` command.
  - Pattern:  `package.json:38` — `bun test` command.
  - Pattern:  `src/plugin/event.ts:499` — model-fallback async prompt path.
  - Pattern:  `src/hooks/runtime-fallback/auto-retry.ts:160` — runtime-fallback async retry path.
  - Pattern:  `src/features/background-agent/parent-wake-notifier.ts:137` — background parent wake prompt path.
  - Pattern:  `src/shared/prompt-async-gate.ts:189` — prompt gate logs dispatching.
  - Pattern:  `src/shared/prompt-async-gate.ts:199` — prompt gate logs failed.
  - Pattern:  `/tmp/oh-my-opencode.log` — project logger target from AGENTS.md.

  Acceptance criteria (agent-executable only):
  - [ ] `evidence/task-9-omo-main-session.txt` contains the actual OMO run transcript and exits without indefinite wait.
  - [ ] `evidence/task-9-omo-log.txt` contains prompt gate dispatch/failure/retry evidence and no final stale `reserved` skip for the target session.
  - [ ] The owned tmux session is removed by name and no tmux server kill is used.

  QA scenarios (MANDATORY — task incomplete without these):
  ```
  Scenario: OMO main-session recovery does not hang after prompt failure
    Tool:     tmux
    Steps:    mkdir -p evidence; truncate or mark /tmp/oh-my-opencode.log with a QA delimiter; start a task-owned tmux session named omo-main-prompt-race-qa from /Users/yeongyu/local-workspaces/gpt 5.5 xhigh; run the built local CLI or local plugin against sibling OpenCode with a prompt that triggers fallback/recovery; wait via tmux wait-for; capture pane to evidence/task-9-omo-main-session.txt and log slice to evidence/task-9-omo-log.txt; kill only omo-main-prompt-race-qa.
    Expected: transcript reaches a terminal success or expected handled failure, and log shows any failed/reserved prompt is followed by cleanup/retry/requeue rather than permanent hang.
    Evidence: evidence/task-9-omo-main-session.txt

  Scenario: no stale prompt reservation after QA
    Tool:     bash
    Steps:    rg -n "prompt-async-gate.*(reserved|failed|dispatched)|model-fallback|runtime-fallback" evidence/task-9-omo-log.txt | tee evidence/task-9-prompt-gate-log.txt
    Expected: output shows the target session's failed prompt path and a subsequent dispatch/requeue; it does not end with only a reserved skip.
    Evidence: evidence/task-9-prompt-gate-log.txt
  ```

  Commit: NO | Message: `n/a` | Files: [`evidence/task-9-omo-main-session.txt`, `evidence/task-9-omo-log.txt`, `.debugging`]

- [ ] 10. Manual QA background and team routes

  What to do: Exercise at least one background-agent parent wake/resume path and one team live-delivery/wake path in real local execution or, if team-mode live execution is blocked by credentials/config, use the closest agent-executed CLI/tool invocation plus captured logs and explain the limitation in `.debugging`. The key pass condition is no permanent prompt reservation after a failed prompt delivery; background wakes requeue and team messages remain available through inbox fallback.
  Must NOT do: Do not create nested teams. Do not leave team worktrees, mailbox files, or tmux panes unmanaged. Do not remove user team config.

  Parallelization: Can parallel: YES | Wave 3 | Blocks: [12] | Blocked by: [6, 7]

  References (executor has NO interview context — be exhaustive):
  - Pattern:  `src/features/background-agent/parent-wake-notifier.ts:137` — background parent wake prompt dispatch.
  - Pattern:  `src/features/background-agent/parent-wake-notifier.ts:153` — failed wake throws into requeue path.
  - Pattern:  `src/features/background-agent/manager.ts:1293` — background resume prompt dispatch.
  - Pattern:  `src/features/team-mode/tools/messaging.ts:168` — live delivery reserves mailbox entry.
  - Pattern:  `src/features/team-mode/tools/messaging.ts:202` — live delivery prompt dispatch.
  - Pattern:  `src/features/team-mode/tools/messaging.ts:241` — catch releases mailbox reservation.
  - Pattern:  `src/hooks/team-session-events/team-idle-wake-hint.ts:114` — wake hint prompt dispatch.
  - Pattern:  `src/features/team-mode/AGENTS.md:1` — team-mode overview and guardrails.

  Acceptance criteria (agent-executable only):
  - [ ] `evidence/task-10-background-route.txt` contains real background route evidence showing no hang and correct requeue/handled failure.
  - [ ] `evidence/task-10-team-route.txt` contains real team route evidence or a documented blocked-run fallback with the exact command and reason.
  - [ ] `.debugging` records any created team run, worktree, tmux session, mailbox path, and cleanup command.
  - [ ] Any created team/task artifacts are cleaned up or explicitly preserved only if they are required evidence.

  QA scenarios (MANDATORY — task incomplete without these):
  ```
  Scenario: background failed prompt route is handled
    Tool:     tmux
    Steps:    run a task-owned local OMO session that launches or resumes a background task with a controlled prompt failure; capture task output and /tmp/oh-my-opencode.log to evidence/task-10-background-route.txt; clean up only task-owned tmux sessions.
    Expected: background task reaches completed, error, interrupt, or requeued state; it does not remain indefinitely running due to a reserved prompt gate.
    Evidence: evidence/task-10-background-route.txt

  Scenario: team live delivery failure falls back without stale reservation
    Tool:     bash
    Steps:    execute the smallest team-mode command sequence available in this worktree/config to send a member message or wake hint; if full team-mode is unavailable, run the team-mode focused test plus log why real execution is blocked; capture output to evidence/task-10-team-route.txt.
    Expected: real route or documented blocked fallback shows failed prompt delivery releases mailbox reservation or leaves inbox fallback available.
    Evidence: evidence/task-10-team-route.txt
  ```

  Commit: NO | Message: `n/a` | Files: [`evidence/task-10-background-route.txt`, `evidence/task-10-team-route.txt`, `.debugging`]

- [ ] 11. Local full verification and atomic commits

  What to do: Run focused tests, full Bun tests, typecheck, and build locally. Group commits by logical unit if earlier tasks have not already committed. Preserve `.debugging` updates and keep evidence files uncommitted unless the user explicitly wants evidence committed.
  Must NOT do: Do not commit unrelated dirty files. Do not modify `package.json` version. Do not use `--no-verify`.

  Parallelization: Can parallel: YES | Wave 3 | Blocks: [12] | Blocked by: [1, 2, 3, 4, 5, 6, 7]

  References (executor has NO interview context — be exhaustive):
  - Pattern:  `package.json:25` — build script.
  - Pattern:  `package.json:36` — typecheck script.
  - Pattern:  `package.json:38` — test script.
  - Pattern:  `src/hooks/shared/prompt-async-gate.test.ts:282` — gate timeout regression area.
  - Pattern:  `src/plugin/event.model-fallback.test.ts:169` — model-fallback race regression area.
  - Pattern:  `src/hooks/runtime-fallback/index.test.ts:1274` — runtime-fallback in-flight regression area.
  - Pattern:  `src/features/background-agent/manager.test.ts:7548` — background stale prompt error regression area.
  - Pattern:  `src/features/team-mode/tools/messaging.test.ts` — team messaging coverage.
  - Pattern:  `src/shared/prompt-async-route-audit.test.ts:249` — raw prompt audit.
  - External: `/Users/yeongyu/.agents/skills/git-master/SKILL.md` — atomic commit guidance.

  Acceptance criteria (agent-executable only):
  - [ ] `bun test src/hooks/shared/prompt-async-gate.test.ts src/shared/prompt-async-route-audit.test.ts src/plugin/event.model-fallback.test.ts src/hooks/runtime-fallback/index.test.ts --bail` passes.
  - [ ] `bun test src/features/background-agent/manager.test.ts src/features/team-mode/tools/messaging.test.ts src/hooks/team-session-events/team-idle-wake-hint.test.ts --bail` passes.
  - [ ] `bun test` passes.
  - [ ] `bun run typecheck` passes.
  - [ ] `bun run build` passes.
  - [ ] `git status --short` shows only intended committed changes plus untracked evidence if evidence is intentionally not committed.
  - [ ] `git log --oneline origin/dev..HEAD` shows atomic conventional commits and no WIP commits.

  QA scenarios (MANDATORY — task incomplete without these):
  ```
  Scenario: full local verification passes
    Tool:     bash
    Steps:    mkdir -p evidence; bun test 2>&1 | tee evidence/task-11-bun-test.txt; bun run typecheck 2>&1 | tee evidence/task-11-typecheck.txt; bun run build 2>&1 | tee evidence/task-11-build.txt
    Expected: all three commands exit 0.
    Evidence: evidence/task-11-bun-test.txt

  Scenario: commit history is clean
    Tool:     bash
    Steps:    git status --short | tee evidence/task-11-git-status.txt; git log --oneline origin/dev..HEAD | tee evidence/task-11-git-log.txt
    Expected: no unrelated tracked changes remain unstaged/uncommitted; commits are conventional and logically atomic.
    Evidence: evidence/task-11-git-log.txt
  ```

  Commit: YES | Message: `chore(prompt-race): verify local prompt recovery fix` | Files: [`.debugging`, `src/shared/prompt-async-gate.ts`, `src/hooks/shared/prompt-async-gate.test.ts`, `src/shared/prompt-async-route-audit.test.ts`, `src/plugin/event.ts`, `src/plugin/event.model-fallback.test.ts`, `src/hooks/runtime-fallback/auto-retry.ts`, `src/hooks/runtime-fallback/*.test.ts`, `src/features/background-agent/*.ts`, `src/features/background-agent/*.test.ts`, `src/features/team-mode/**/*.ts`, `src/features/team-mode/**/*.test.ts`, `src/hooks/team-session-events/*.ts`, `src/hooks/team-session-events/*.test.ts`]

- [ ] 12. Create PR, pass CI/reviews, merge, and clean up worktree

  What to do: Push branch, create a PR against `dev`, run the verification loop until CI, review-work, and Cubic all pass. Use a PR body file under `/tmp/pull-request-prompt-hang-race-<timestamp>.md` and get user confirmation before `gh pr create` per project instruction. After all gates pass, merge as requested by the PR workflow, then remove `/Users/yeongyu/local-workspaces/gpt 5.5 xhigh` worktree after merge.
  Must NOT do: Do not create the PR body inline. Do not merge before CI, review-work, and Cubic all pass. Do not remove the worktree before merge. Do not delete user data or unrelated worktrees.

  Parallelization: Can parallel: NO | Wave 4 | Blocks: [] | Blocked by: [8, 9, 10, 11]

  References (executor has NO interview context — be exhaustive):
  - External: `/Users/yeongyu/local-workspaces/gpt 5.5 xhigh/.agents/skills/work-with-pr/SKILL.md` — PR lifecycle requires CI, review-work, Cubic, merge, and worktree cleanup.
  - External: `/Users/yeongyu/.agents/skills/git-master/SKILL.md` — commit history must be atomic before push.
  - Pattern:  `package.json:25` — build command mirrors CI build.
  - Pattern:  `package.json:36` — typecheck command mirrors CI typecheck.
  - Pattern:  `package.json:38` — test command mirrors CI root test.
  - Pattern:  `.debugging:88` — worktree removal is already tracked as a cleanup artifact.
  - Pattern:  `.debugging:89` — branch cleanup is already tracked as a cleanup artifact.

  Acceptance criteria (agent-executable only):
  - [ ] PR exists and targets `dev`; `gh pr view --json number,baseRefName,headRefName,url` saved to `evidence/task-12-pr.json`.
  - [ ] `gh pr checks --watch --fail-fast` passes for the PR head.
  - [ ] review-work final report has no blocking issues and is saved to `evidence/task-12-review-work.txt`.
  - [ ] Cubic comment says no issues found, or equivalent pass status, saved to `evidence/task-12-cubic.txt`.
  - [ ] PR is merged.
  - [ ] `git worktree list` no longer contains `/Users/yeongyu/local-workspaces/gpt 5.5 xhigh` after merge cleanup.

  QA scenarios (MANDATORY — task incomplete without these):
  ```
  Scenario: PR gates all pass
    Tool:     bash
    Steps:    mkdir -p evidence; gh pr view --json number,baseRefName,headRefName,url > evidence/task-12-pr.json; gh pr checks --watch --fail-fast 2>&1 | tee evidence/task-12-ci.txt; run review-work and save its final report to evidence/task-12-review-work.txt; query PR comments/reviews for Cubic and save pass evidence to evidence/task-12-cubic.txt.
    Expected: PR targets dev, CI exits 0, review-work has no blocking issues, and Cubic reports no issues found.
    Evidence: evidence/task-12-ci.txt

  Scenario: merged branch worktree cleanup
    Tool:     bash
    Steps:    after merge, run git worktree list | tee evidence/task-12-worktrees-before-cleanup.txt; remove only /Users/yeongyu/local-workspaces/gpt 5.5 xhigh with git worktree remove; run git worktree list | tee evidence/task-12-worktrees-after-cleanup.txt.
    Expected: after-cleanup evidence does not contain /Users/yeongyu/local-workspaces/gpt 5.5 xhigh.
    Evidence: evidence/task-12-worktrees-after-cleanup.txt
  ```

  Commit: NO | Message: `n/a` | Files: [`/tmp/pull-request-prompt-hang-race-<timestamp>.md`, `evidence/task-12-pr.json`, `evidence/task-12-ci.txt`, `evidence/task-12-review-work.txt`, `evidence/task-12-cubic.txt`]

## Final verification wave (MANDATORY — after all implementation tasks)
> Runs in PARALLEL. ALL must APPROVE. Surface results to the caller and wait for an explicit "okay" before declaring complete.
- [ ] F1. Plan compliance audit — every task done, every acceptance criterion met
- [ ] F2. Code quality review — diagnostics clean, idioms match, no dead code
- [ ] F3. Real manual QA — every QA scenario executed with evidence captured
- [ ] F4. Scope fidelity — nothing extra shipped beyond Must-Have, nothing Must-NOT-Have introduced

## Commit strategy
- One logical change per commit. Conventional Commits (`<type>(<scope>): <subject>` body + footer).
- Atomic: every commit builds and passes tests on its own.
- No "WIP" / "fix typo squash later" commits on the final branch — clean up before merge.
- Recommended commit sequence:
- `test(debugging): document prompt async race evidence`
- `fix(prompt-gate): release failed dispatch reservations`
- `test(prompt-gate): audit internal prompt routes`
- `test(model-fallback): cover prompt async error overlap`
- `fix(runtime-fallback): clear failed retry prompt state`
- `test(background-agent): cover failed prompt wake recovery`
- `test(team-mode): cover failed live prompt delivery`
- Reference the plan file path in the final commit footer: `Plan: plans/fix-prompt-hang-race.md`.

## Success criteria
- All Must-Have shipped; all QA scenarios pass with captured evidence; F1–F4 approved; commit history clean.
