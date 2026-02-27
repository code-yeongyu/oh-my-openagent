# Wave A Execution Sheet (Rehearsal-Derived)

- Timestamp (UTC): 2026-02-28T00:00:00Z
- Strategy gate: Path **A** (downstream-preservation priority), with rehearsal options from `rehearsal-conflicts.md`
- Source refs used:
  - `rescue/pre-merge-bae3bdc2` (`e27d53e7`) for conflict-safe Wave A orchestration modules
  - `recovery/remerge-20260226` (`566774e2`) for conflict context and decision trace

## Exact Wave A Allowlist Paths

1. `src/hooks/atlas/**`
2. `src/hooks/index.ts`
3. `src/index.ts`
4. `src/plugin-handlers/config-handler.ts`
5. `src/hooks/anthropic-context-window-limit-recovery/index.ts`
6. `src/hooks/compaction-context-injector/**`

## Itemized Resolution Plan (placeholder → concrete)

Resolution options refer to `rehearsal-conflicts.md`:
- `O1`: keep rescue-side control flow, forward-port only needed behavior.
- `O2`: keep recovery-side implementation, adapt rescue entrypoints.
- `O3`: hybrid merge where behavior and architecture must both hold.

| Ledger ID | Path | Rehearsal Type | Resolution Choice | Preserve/Equivalent Mapping | Concrete Action in Wave A |
|---|---|---|---|---|---|
| RP-020 / PATH-020 | `src/hooks/atlas/atlas-hook.ts` | `content (add/add)` | `O1` | `PRESERVE` | Apply from `rescue/pre-merge-bae3bdc2` |
| RP-021 / PATH-021 | `src/hooks/atlas/event-handler.ts` | `content (add/add)` | `O1` | `PRESERVE` | Apply from `rescue/pre-merge-bae3bdc2` |
| RP-023 / PATH-023 | `src/hooks/atlas/index.ts` | `content` | `O3` | `PRESERVE` | Replace monolith entry with rescue barrel export |
| RP-024 / PATH-024 | `src/hooks/atlas/system-reminder-templates.ts` | `content (add/add)` | `O1` | `PRESERVE` | Apply from `rescue/pre-merge-bae3bdc2` |
| RP-025 / PATH-025 | `src/hooks/atlas/tool-execute-after.ts` | `content (add/add)` | `O1` | `PRESERVE` | Apply from `rescue/pre-merge-bae3bdc2` |
| RP-022 / PATH-022 | `src/hooks/atlas/index.test.ts` | `content` | `O3` | `PROPOSED_DROP (EX-004)` | Keep test in sync for Wave A verification by applying rescue version |
| RP-043 / PATH-043 | `src/index.ts` | `content` | `O3` | `PRESERVE` | Apply rescue startup-repair behavior with equivalent local import rewrite (`./shared/session-bucket-repair`) |
| RP-019 / PATH-019 | `src/hooks/anthropic-context-window-limit-recovery/index.ts` | `content` | `O1` | `PRESERVE` | No edit in Wave A (baseline kept; no unresolved loss introduced) |
| RP-028 / PATH-028 | `src/hooks/compaction-context-injector/index.ts` | `content` | `O1` | `PRESERVE` | No edit in Wave A (baseline kept) |
| RP-027 / PATH-027 | `src/hooks/compaction-context-injector/index.test.ts` | `content` | `O1` | `PROPOSED_DROP (EX-006)` | No edit in Wave A |
| RP-029 / PATH-029 | `src/hooks/index.ts` | `content` | `O1` | `PRESERVE` | No edit in Wave A (baseline kept) |
| RP-044 / PATH-044 | `src/plugin-handlers/config-handler.ts` | `content` | `O1` | `PRESERVE` | No edit in Wave A (baseline kept) |

## Apply Set for This Wave (code changes only)

1. `src/hooks/atlas/index.ts`
2. `src/hooks/atlas/atlas-hook.ts`
3. `src/hooks/atlas/event-handler.ts`
4. `src/hooks/atlas/system-reminder-templates.ts`
5. `src/hooks/atlas/tool-execute-after.ts`
6. `src/hooks/atlas/index.test.ts`
7. `src/index.ts` (equivalent import rewrite after rescue forward-port)

No other code path is allowed in Wave A.

## Targeted Test Commands

1. `bun test src/hooks/atlas/index.test.ts`
2. `bun test src/hooks/compaction-context-injector/index.test.ts`
3. `bun run build`

## Preservation Gate Expectations for Wave A

- Wave A touched required entries must resolve to `PRESERVE` or approved exception handling.
- `UNAPPROVED_REQUIRED_PATH_LOSS` must remain `0` for all Wave A required entries.
- No drop is permitted outside existing approved exceptions list (`EX-001..EX-028`).
