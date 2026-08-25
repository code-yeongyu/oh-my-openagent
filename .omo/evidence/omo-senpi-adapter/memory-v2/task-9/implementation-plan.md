# Todo 9 implementation plan

1. Add RED memory-core tests for the IC-7 discriminated extraction schema, atomic batch commit/trailers, no-facts result, and rollback on a pre-commit failure.
2. Add RED omo-senpi tests for quick-unresolvable skip, all-pending launch payload, supervisor-backed extraction finalization, queue retention on failure, and deterministic writer-lock retry interleavings.
3. Implement the facts extraction schema, JSONL parser, persona loader, and single-commit `applyFactsBatch` in `packages/memory-core/src/facts/`.
4. Extend the canonical worker spawn module with facts payload preparation and supervisor launch manifest/ledger support. Do not create a second supervisor.
5. Implement the facts runner/finalizer and durable single-flight/reconcile logic in the memory component, then wire settle debounce and session-start recovery through `facts-wiring.ts` and `wiring.ts`.
6. Run focused diagnostics/typechecks and affected tests once, then the omo-senpi package gate. Restore only forbidden generated bundles if the gate dirties them.
7. Run isolated real-surface QA with a deterministic `SENPI_BIN` fixture, waiting via bounded stat-before/watch/re-stat on `outcome.json` then `final.json`; record teardown.
8. Record RED/GREEN evidence and commit only task-owned source, tests, asset, and evidence paths with the binding subject.
