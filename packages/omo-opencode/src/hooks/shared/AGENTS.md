# hooks/shared — Shared Hook Shims and Their Tests

## OVERVIEW

Despite the name, this directory holds almost no implementation: `prompt-async-gate.ts` and `session-idle-settle.ts` are one-line re-exports of `../../shared/*`, and the rest of the directory is the test home for that shared behavior. It earns a file because the shim boundary is easy to mistake for the implementation.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Prompt gate implementation | `../../shared/prompt-async-gate.ts` (re-exported by `prompt-async-gate.ts`) |
| Idle settle implementation | `../../shared/session-idle-settle.ts` (re-exported by `session-idle-settle.ts`) |
| Real local implementation | `compaction-model-resolver.ts` |
| Prompt gate behavior suites | `prompt-async-gate*.test.ts` (dedupe, live routing, question, message fetch) |
| Repo-wide conflict guard | `merge-conflict-guard.test.ts` (scans files for conflict markers) |

## CONVENTIONS

- Import shared utilities by focused relative path; there is intentionally no `index.ts` barrel here.
- Add new prompt-gate or idle-settle logic to `src/shared/`, not to these shims; keep the shim files as pure re-exports.
- Prompt dispatch relies on reservations, deduplication, and routing metadata rather than timing.
- Tests use Bun and assert observable gate state instead of waiting on wall-clock delays.
- `compaction-model-resolver.ts` is the exception: it resolves the compaction agent/model from config and session state locally.
- The prompt-gate suites are the largest behavioral surface in this directory; treat them as the contract for dispatch changes.

## ANTI-PATTERNS

- Do not grow a shim file into an implementation; that splits the shared contract across two locations.
- Do not add a second prompt gate or bypass reservation/deduplication in a caller.
- Do not make asynchronous tests pass with fixed sleeps.
- Do not add an `index.ts` barrel here; hooks import these paths directly.
