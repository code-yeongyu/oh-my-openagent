# lsp-core/src/lsp — Language Server Runtime

## OVERVIEW

The language-server runtime: 73 direct modules, ~10.7k LOC, the package's concurrency and mutation core. Earned its own file on size plus lifecycle risk (score 12; largest subtree in `lsp-core`). Per-file roles live in the parent's KEY FILES table - this file covers only what that table cannot say. Parent: [`packages/lsp-core/AGENTS.md`](../../AGENTS.md).

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Tunables (idle, init, respawn, resident cap, reaper interval) | `constants.ts` |
| Typed failure modes | `errors.ts`, `cleanup-errors.ts` |
| Adding/altering a language server entry | `server-definitions.ts`, then `server-resolution.ts` |
| Open-document mutation tracking | `workspace-document-state.ts` |
| Test-only servers and probes | `fixtures/` |

## CONVENTIONS

- Consumers import direct modules through the package's `./lsp/*` wildcard export; there is intentionally **no barrel here**, so a new file is public the moment it lands.
- Every relative ESM import carries a `.js` suffix even though sources are `.ts`.
- Test kinds are encoded in filenames and carry different intent: `.test.ts` (unit), `.integration.test.ts` (real server processes), `.characterization.test.ts` (frozen current behavior - a diff there means you changed observable behavior), plus adversarial workspace-edit suites.
- Lifecycle limits are constants, not literals: admission, idle reaping, init timeout, and respawn budget all read from `constants.ts`. Tests inject `now()` and `clientFactory` rather than sleeping.
- Cancellation is threaded, not polled: an `AbortSignal` reaches cold client acquisition and per-file scans, so aborting a cold start must leave `clientCount()` at 0.

## ANTI-PATTERNS

- Never add a fixed sleep to a client/manager test; await the exact state or event with a bounded timeout.
- Never let a best-effort cleanup path (client stop, reaper, tombstone) throw into the caller - route it through the cleanup-error reporter.
- Never widen a workspace mutation to run before its plan/simulate step, and never add an index barrel that changes the direct-module export contract.

## QA

```bash
bun test packages/lsp-core/src/lsp/
```

Integration and characterization suites spawn real language servers; run the unit
file nearest your change first, then the directory.
