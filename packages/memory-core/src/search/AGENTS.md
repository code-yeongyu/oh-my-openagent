# memory-core/src/search — Transcript Search

## OVERVIEW

Parses bounded search queries, scores searchable transcript text, applies date filters, and reads session data through a provider abstraction. Distinct domain (score 8): the read-only FTS-lite path, independent of the write/lock stack. Parent: [`packages/memory-core/AGENTS.md`](../../AGENTS.md).

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Query grammar and normalization | `query.ts` |
| Scoring and search orchestration | `engine.ts` |
| Session JSONL provider | `senpi-session-provider.ts` |
| Public barrel | `index.ts` |

## CONVENTIONS

- Providers implement the session/document boundary; scoring remains deterministic and returns a score or no-match result.
- Normalize text before matching and preserve date-range semantics separately from textual scoring.
- Keep result limits and malformed-session handling explicit at the provider/engine boundary.
- Tests are colocated and should exercise parser, ranking, and JSONL edge cases without timing luck.

## ANTI-PATTERNS

- Do not couple the search engine to a harness-specific session store.
- Do not treat lexical message IDs as chronological order.
- Do not let malformed provider input crash unrelated search results.

## QA

```bash
bun test packages/memory-core/src/search/
```

Cover the parser and the JSONL session provider together: most regressions here
are malformed-line handling, not ranking.
