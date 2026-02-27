# Wave B Execution Sheet (Rehearsal-Derived)

- Timestamp (UTC): 2026-02-28T12:30:00Z
- Strategy gate: Path **A** (downstream-preservation priority)
- Inputs used:
  - `changes/route-c-bae3bdc2-downstream-preservation/evidence/rehearsal-conflicts.md`
  - `changes/route-c-bae3bdc2-downstream-preservation/evidence/rehearsal-impact-report.md`
  - `changes/route-c-bae3bdc2-downstream-preservation/evidence/wave-a-execution-sheet.md`
  - `git diff --name-status HEAD..rescue/pre-merge-bae3bdc2` (Wave B allowlist paths)
  - `git diff --name-status rescue/pre-merge-bae3bdc2...recovery/remerge-20260226` (conflict context)

## Exact Wave B Allowlist Paths

1. `src/hooks/todo-continuation-enforcer*`
2. `src/tools/session-manager/**`
3. `src/features/boulder-state/**`
4. `src/tools/delegate-task/**`
5. `src/shared/session-utils.ts`
6. `src/shared/task-parser.ts`
7. `src/shared/wave-grouper.ts`
8. `src/hooks/ralph-loop/**`

## Itemized Resolution Plan (placeholder -> concrete)

Resolution options (from rehearsal evidence):
- `O1`: keep rescue-side control flow, forward-port only required behavior.
- `O3`: hybrid merge when behavior + local architecture both matter.
- `D1`: delete/modify case -> keep compatibility path and preserve behavior.

| Ledger ID | Path | Rehearsal Type | Resolution Choice | Preserve/Equivalent Mapping | Concrete Action in Wave B |
|---|---|---|---|---|---|
| RP-041 / PATH-041 | `src/hooks/todo-continuation-enforcer.ts` | `delete-modify` | `D1` | `EQUIVALENT_REWRITE` | Apply rescue version (keep compatibility path, add boulder-session guard + fallback agent handling). |
| RP-059 / PATH-059 | `src/tools/session-manager/storage.ts` | `content` | `O1` | `PRESERVE` | Apply rescue version (directory normalization for Windows/Git-Bash/WSL path matching). |
| RP-061 / PATH-061 | `src/tools/session-manager/tools.ts` | `content` | `O1` | `PRESERVE` | Apply rescue version (`session_list` directory uses tool context first). |
| RP-060 / PATH-060 | `src/tools/session-manager/tools.context.test.ts` | `content (add/add)` | `O1` | `PROPOSED_DROP (EX-governed)` | Apply rescue test to keep context-directory behavior verification explicit in this wave. |
| RP-057 / PATH-057 | `src/tools/delegate-task/tools.test.ts` | `content` | `O3` | `PROPOSED_DROP (EX-governed)` | Apply rescue test sync for updated error text, timing hooks, and browser-provider behavior checks. |
| RP-105 / PATH-105 | `src/tools/session-manager/storage.test.ts` | `semantic-risk` | `O3` | `PROPOSED_DROP (EX-governed)` | Apply rescue test sync for cross-platform directory matching behavior. |
| RP-042 / PATH-042 (equivalent test surface) | `src/hooks/todo-continuation-enforcer.test.ts` | `content` | `O3` | `PROPOSED_DROP (EX-governed)` | Apply rescue test sync on legacy test path to match Wave B runtime behavior and preserve verification coverage. |
| RP-012 / PATH-012 | `src/features/boulder-state/storage.ts` | `content` | `O1` | `PRESERVE` | No edit in Wave B (already present; used by todo continuation guard). |
| RP-013 / PATH-013 | `src/features/boulder-state/types.ts` | `content` | `O1` | `PRESERVE` | No edit in Wave B. |
| RP-035 / PATH-035 | `src/hooks/ralph-loop/index.test.ts` | `content` | `O1` | `PROPOSED_DROP (EX-governed)` | No edit in Wave B. |
| RP-036 / PATH-036 | `src/hooks/ralph-loop/index.ts` | `content` | `O1` | `PRESERVE` | No edit in Wave B. |
| RP-050 / PATH-050 | `src/shared/session-utils.ts` | `content` | `O1` | `PRESERVE` | No edit in Wave B. |
| RP-052 / PATH-052 | `src/shared/task-parser.ts` | `content` | `O1` | `PRESERVE` | No edit in Wave B. |
| RP-103 / PATH-103 | `src/shared/wave-grouper.ts` | `semantic-risk` | `O1` | `PRESERVE` | No edit in Wave B. |
| RP-104 / PATH-104 | `src/tools/delegate-task/categories.ts` | `semantic-risk` | `O1` | `PRESERVE` | No edit in Wave B. |
| RP-055 / PATH-055 | `src/tools/delegate-task/constants.ts` | `content` | `O1` | `PRESERVE` | No edit in Wave B. |
| RP-056 / PATH-056 | `src/tools/delegate-task/executor.ts` | `content` | `O1` | `PRESERVE` | No edit in Wave B. |

## Apply Set for This Wave (code/test changes only)

1. `src/hooks/todo-continuation-enforcer.ts`
2. `src/hooks/todo-continuation-enforcer.test.ts`
3. `src/tools/session-manager/storage.ts`
4. `src/tools/session-manager/storage.test.ts`
5. `src/tools/session-manager/tools.ts`
6. `src/tools/session-manager/tools.context.test.ts`
7. `src/tools/delegate-task/tools.test.ts`

No other code path is allowed in Wave B.

## Targeted Test Commands

1. `bun test src/hooks/todo-continuation-enforcer.test.ts`
2. `bun test src/tools/session-manager/storage.test.ts src/tools/session-manager/tools.context.test.ts src/tools/session-manager/tools.test.ts`
3. `bun test src/tools/delegate-task/tools.test.ts`
4. `bun test src/shared/task-parser.test.ts src/shared/wave-grouper.test.ts`
5. `bun run build`

## Preservation Gate Expectations for Wave B

- Wave B touched required entries must remain `PRESERVE` or approved `PROPOSED_DROP` handling.
- Any touched required runtime path missing without approved exception => BLOCKED.
- Required-loss statement target for this wave: `WAVE_B_REQUIRED_MISSING=0`.
