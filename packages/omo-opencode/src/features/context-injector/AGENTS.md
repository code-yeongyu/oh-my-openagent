# src/features/context-injector/ — Directory Guidance Injection

Earned its file: score 8, distinct domain — owns the guidance-discovery contract that several hooks depend on, and the parent `features/AGENTS.md` carries only one row.

## OVERVIEW

Small hook feature that discovers applicable AGENTS.md and README.md guidance, collects bounded context entries, and exposes OpenCode message-transform hooks for injection.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Public boundary | `index.ts` |
| Directory traversal and collection | `collector.ts` |
| Message transformation | `injector.ts` |
| Shared contracts | `types.ts` |
| Regression coverage | `collector.test.ts`, `injector.test.ts` |

## CONVENTIONS

- Keep discovery/collection separate from message injection so traversal can be tested without an OpenCode hook.
- Preserve entry priority, source, and path metadata in the public types; consumers use these fields to explain injected guidance.
- The feature is integrated through hook composition and should remain safe when no guidance files are found.
- Tests use Bun's `bun:test` and focus on deterministic collected entries and transformed messages.

## RELATED

| Where | What |
|-------|------|
| `src/hooks/directory-agents-injector/`, `src/hooks/directory-readme-injector/` | Hook-side consumers of directory guidance |
| `src/__tests__/perf/fixtures/in-tree/` | Benchmark fixture tree for AGENTS.md walk-up discovery |

## ANTI-PATTERNS

- Do not inject arbitrary files or bypass the collector's scope rules.
- Do not duplicate AGENTS.md walk-up semantics in hook callers.
- Do not turn missing or unreadable guidance into a plugin-startup failure.
