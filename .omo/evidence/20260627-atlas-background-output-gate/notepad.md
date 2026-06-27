# Atlas background_output completion gate notepad

## Skill survey

- `work-with-pr`: required because the deliverable is a pushed PR targeting `dev`.
- `ulw-loop`: required by the handoff; using session id `atlas-bg-output-gate-20260627` with ledger at `.omo/ulw-loop/atlas-bg-output-gate-20260627/ledger.jsonl`.
- `opencode-qa`: required because `packages/omo-opencode/src/**` hook behavior is wired into OpenCode; QA evidence must prove the hook-relevant surface and isolation.
- `commit`: required for the atomic commit before pushing the PR.
- `smart-rebase`: not loaded now; only use if the branch conflicts with `dev`.

## Tier

HEAVY. The change touches background task completion semantics in an OpenCode lifecycle hook, and the handoff requires RED->GREEN plus real OpenCode hook QA.

## Success criteria

- C001 RED/GREEN unit: reproduce `background_output` plugin retrieval with an existing tracked `task_sessions["todo:1"]` while the top-level plan task is still unchecked; current behavior must skip `COMPLETION GATE`, fixed behavior must include it.
- C002 package verification: focused Atlas tests pass; feasible typecheck command passes or the blocker is recorded.
- C003 real-surface QA: OpenCode hook-relevant QA artifact proves the hook/event path in isolation, with real DB session count unchanged.

## Evidence paths

- `.omo/evidence/20260627-atlas-background-output-gate/red-background-output-gate.txt`
- `.omo/evidence/20260627-atlas-background-output-gate/green-background-output-gate.txt`
- `.omo/evidence/20260627-atlas-background-output-gate/focused-atlas-tests.txt`
- `.omo/evidence/20260627-atlas-background-output-gate/typecheck.txt`
- `.omo/evidence/20260627-atlas-background-output-gate/opencode-hook-qa.txt`
- `.omo/evidence/20260627-atlas-background-output-gate/qa-summary.md`

## Initial finding

`handleSubagentCompletionAfter` treats `isPluginToolRetrieval && trackedTaskSession !== null` as already verified. A task session can be tracked by the earlier background launch before the plan checkbox has been marked, so retrieval must still show the completion gate unless the plan task is actually checked or the session state's gate-suppression set already contains the task key.
