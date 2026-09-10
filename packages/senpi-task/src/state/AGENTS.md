# state - Durable Task Contracts

## OVERVIEW
Defines task record shapes, status/residency vocabularies, IDs, run statistics, spawn specs, and transition semantics.

## WHERE TO LOOK
| Task | Location | Notes |
|---|---|---|
| Contracts and constants | `types.ts`, `index.ts` | Public discriminants, compatibility fields, and barrel exports. |
| State transitions | `transitions.ts` | Validity, terminal idempotence, audits, and field application. |
| Record construction | `record.ts` | New task defaults and normalized persisted fields. |
| IDs and compatibility | `id.ts`, `resolved-reasoning.ts` | `st_` ids and reasoning normalization. |
| Visibility | `messageability.ts` | Whether a record can be steered, revived, or is not continuable. |

## CONVENTIONS
- Status and residency are literal unions with exhaustive `assertNever` branches.
- Persisted fields use snake_case; `TaskId` values use the `st_` prefix.
- `SpawnSpecV1` contains safe plain-data facts only; legacy process specs remain for compatibility.
- `resolved_model.source` distinguishes `category`, `explicit`, and `agent` resolution.

## ANTI-PATTERNS
- Do not add a transition case without updating transition tables and exhaustive branches.
- Never make a terminal transition overwrite a newer terminal result.
- Never treat legacy persisted spawn data as rebuildable in-process v1 data.
- Do not silently coerce malformed persisted scalar values.

## HOTSPOTS
- `types.ts` (281 lines) is the broadest dependency in the package; most subsystems import from it.
- `transitions.ts` (241) encodes the state machine, residency-only transitions, and audit results.
- Deprecated reasoning fields remain represented for persisted compatibility; read through the canonical field.

## QA
```sh
bun test packages/senpi-task/src/state
```

Parent: [`../AGENTS.md`](../AGENTS.md).
