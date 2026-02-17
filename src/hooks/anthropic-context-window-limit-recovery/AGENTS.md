# src/hooks/anthropic-context-window-limit-recovery/ — Multi-Strategy Context Recovery

**Generated:** 2026-02-18

## OVERVIEW

31 files (~2232 LOC). Most complex hook. Recovers from context window limit errors via multiple strategies applied in sequence.

## RECOVERY STRATEGIES (in priority order)

| Strategy | File | Mechanism |
|----------|------|-----------|
| **Empty content recovery** | `empty-content-recovery.ts` | Handle empty/null content blocks in messages |
| **Deduplication** | `deduplication-recovery.ts` | Remove duplicate tool results from context |
| **Target-token truncation** | `target-token-truncation.ts` | Truncate largest tool outputs to fit target ratio |
| **Aggressive truncation** | `aggressive-truncation-strategy.ts` | Last-resort truncation with minimal output preservation |
| **Summarize retry** | `summarize-retry-strategy.ts` | Compaction + summarization then retry |

## KEY FILES

| File | Purpose |
|------|---------|
| `recovery-hook.ts` | Main hook entry — `session.error` handler, strategy orchestration |
| `executor.ts` | Execute recovery strategies in sequence |
| `parser.ts` | Parse Anthropic token limit error messages |
| `state.ts` | `AutoCompactState` — per-session retry/truncation tracking |
| `types.ts` | `ParsedTokenLimitError`, `RetryState`, `TruncateState`, config constants |
| `storage.ts` | Persist tool results for later truncation |
| `tool-result-storage.ts` | Store/retrieve individual tool call results |
| `message-builder.ts` | Build retry messages after recovery |

## RETRY CONFIG

- Max attempts: 2
- Initial delay: 2s, backoff ×2, max 30s
- Max truncation attempts: 20
- Target token ratio: 0.5 (truncate to 50% of limit)
- Chars per token estimate: 4

## PRUNING SYSTEM

`pruning-*.ts` files handle intelligent output pruning:
- `pruning-deduplication.ts` — Remove duplicate content across tool results
- `pruning-tool-output-truncation.ts` — Truncate oversized tool outputs
- `pruning-types.ts` — Pruning-specific type definitions

## SDK VARIANTS

`empty-content-recovery-sdk.ts` and `tool-result-storage-sdk.ts` provide SDK-based implementations for OpenCode client interactions.
