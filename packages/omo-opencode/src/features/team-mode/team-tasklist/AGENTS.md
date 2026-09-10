# team-tasklist — Team Tasklist Facade

## OVERVIEW

This 14-file directory exposes the team-core tasklist API through local re-export shims and colocated operation tests. It is a distinct compatibility boundary, while task persistence and claiming remain implemented in `@oh-my-opencode/team-core`.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Public tasklist API | `index.ts` (re-exports the whole team-core tasklist module) |
| Per-operation shims | one file per operation, each a single `export *` |
| Create/update/get/list operations | `store.ts`, `claim.ts`, `update.ts`, `get.ts`, `list.ts` |
| Dependency handling | `dependencies.ts` |
| Test fixtures | `test-support.ts` (shim over team-core test support) |
| Behavior tests | one `*.test.ts` per operation |

## CONVENTIONS

- Keep one local shim per tasklist operation and preserve the existing team-core import paths.
- Every non-test file is a single `export *` line; the directory holds 98 LOC of shims plus colocated tests.
- Treat task IDs, dependency status, claims, and updates as team-core contracts; this directory adapts paths rather than redefining semantics.
- Claiming is atomic in team-core; concurrent claims resolve there, not here.
- Tests use Bun and remain beside the shim they exercise.

## ANTI-PATTERNS

- Do not implement a parallel task store in this directory.
- Do not write task files directly when a team-core operation exists.
- Do not silently alter re-export names or operation argument shapes; update consumers and tests together.
