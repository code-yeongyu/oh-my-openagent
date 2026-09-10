# team-state-store — Durable Team State Facade

## OVERVIEW

This directory is a path-stable facade over `@oh-my-opencode/team-core/team-state-store`, not an independent persistence implementation. It earned local guidance because 16 files form a distinct compatibility boundary used by team runtime code.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Public surface | `index.ts` |
| State load/transition | `store.ts` |
| Atomic locking | `locks.ts` |
| Resume and recovery | `resume.ts`, `active-resume.ts`, `creating-resume.ts`, `deleting-resume.ts`, `resume-report.ts` |
| Cleanup, liveness, reconciliation | `runtime-cleanup.ts`, `session-liveness.ts`, `reservation-reconciliation.ts` |
| Error normalization | `error-normalization.ts` |

## CONVENTIONS

- Keep the local filenames and path exports stable; consumers import these shims by feature-relative path, most often `team-state-store/store`.
- `index.ts` re-exports the whole team-core module, while each sibling file mirrors one team-core submodule path.
- Durable updates must use team-core state transitions, which provide atomic locking and persistence semantics.
- Every non-test file here is a single `export *` line; colocated `locks.test.ts`, `store.test.ts`, and `resume.test.ts` exercise the re-exported behavior with Bun.
- Preserve explicit named re-exports so the local API remains compatible with team-mode callers.

## ANTI-PATTERNS

- Do not add a second local state store or direct file mutation beside team-core.
- Do not bypass atomic transition helpers for durable state writes.
- Do not change a shim's export path without updating every team-mode consumer and its tests.
- Do not add local logic between the shim and team-core; behavior must stay identical across harnesses.
