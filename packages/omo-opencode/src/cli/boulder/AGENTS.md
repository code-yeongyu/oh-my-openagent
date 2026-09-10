# src/cli/boulder/ — Boulder State Inspector

Earned its file: score 9, distinct domain — the only read surface over Boulder state, split across command, formatter, and contract modules that the parent CLI file covers in one row.

## OVERVIEW

Small CLI adapter for inspecting the worktree-scoped Boulder state used by continuation hooks. The directory contains the command adapter, state formatting helpers, shared types, and co-located tests.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Command behavior | `boulder.ts` (`boulder`) |
| Output rendering | `formatter.ts` (`formatTextOutput`, `formatJsonOutput`, `formatNoBoulderMessage`, `formatReadErrorMessage`) |
| Shared state/result contracts | `types.ts` |
| Public boundary | `index.ts` |
| Regression coverage | `boulder.test.ts`, `formatter.test.ts` |

## CONVENTIONS

- Keep state loading and presentation separate: the adapter selects output mode while formatter helpers remain reusable.
- Preserve both human-readable and machine-readable output shapes exposed by the command options.
- Missing state and read failures have their own formatted messages in both text and JSON modes; do not recompute lifecycle state in the formatter.
- Tests use Bun's `bun:test` and exercise temporary state rather than user-global state.

## RELATED

| Where | What |
|-------|------|
| `src/features/boulder-state/` | Schema, storage, and lifecycle semantics this command reads |
| `src/hooks/atlas/`, `src/hooks/todo-continuation-enforcer/` | Runtime consumers that advance the same state |

## ANTI-PATTERNS

- Do not mutate Boulder state from this read-oriented inspector.
- Do not duplicate persistence or schema logic from `src/features/boulder-state/`; use that feature's storage contracts.
- Do not treat missing or inactive state as a crash; the command reports the available state and exits normally.
