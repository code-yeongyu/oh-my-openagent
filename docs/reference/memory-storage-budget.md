# Memory storage budget

The omo memory store should stay small: well under 100 MB per identity in steady state, normally 10-50 MB. Memory exists to be injected into agent context (the compiled memory block, recall nudges, the save nudge). Data that can never be injected or recalled is derived, bounded, or evicted.

This note maps what the store holds, which parts grew without a bound, and the limits that now apply. Research behind the numbers: production memory systems keep the injected tier at 8-32 KB (Claude Code loads at most 25 KB of `MEMORY.md`, <https://code.claude.com/docs/en/memory>; Codex injects a summary truncated to 2,500 tokens, <https://github.com/openai/codex/tree/main/codex-rs/memories>) and keep raw transcripts out of the memory store or on a retention sweep (Claude Code `cleanupPeriodDays`, default 30, <https://code.claude.com/docs/en/settings-reference>). The stores that grow to gigabytes are the ones that never delete (Codex rollout directories of 91-755 GiB in <https://github.com/openai/codex/issues/34061>).

## What the store holds

Per identity, under `~/.omo/memory/agents/<id>/` (or `OMO_MEMORY_HOME`):

| Area | Path | Injected? | Bound |
|---|---|---|---|
| Memory repo | `repo/` (git, markdown) | Yes: compiled block, projection (40 entries/dir, 24 KiB), recall | Content is bounded by the compile token advisory and projection caps; history is packed by maintenance |
| Transcript journals | `runtime/transcripts/<session>/` | No: input for reflection and facts only | **Was unbounded.** Now 32 MiB per identity (below) |
| Facts queue and runs | `runtime/facts-queue/`, `runtime/facts/` | No | Queue entries are consumed; terminal runs keep the newest 20 under 16 MiB (was 128 MiB) |
| Reflection runs, worktrees | `runtime/reflection*/`, `runtime/worktrees/` | No | Orphan sweep and run ledger retention |
| Recall | `runtime/recall/` | Nudges only | Kibitzer sidecars pruned after 7 idle days; ledgers are small per session |
| Receipts | `runtime/receipts.jsonl` | No | Append-only, about 300 bytes per event |

There is no SQLite database in the memory store, so WAL growth, freelists and `VACUUM` do not apply here. The BM25 term store is a derived cache inside `repo/.git/`.

## Where the growth was

Each session writes one `transcript.jsonl`, append-only. Nothing removed it once reflection and facts had consumed it; only journals that never recorded a message were swept (#9737). Tool results were already cut to 4 KiB, but reasoning was stored in full.

Measured with the real `TranscriptJournal` on a synthetic tool-heavy session (300 turns, each with a 400-char prompt, a 1,500-char answer, 6,000 chars of reasoning and four 12 KB tool results): 7.9 MB, 26 KB per turn. A hundred such sessions is about 800 MB, and every append re-reads the whole file.

## Limits

1. **Reasoning is capped at capture** to a 2,048-character head+tail window (`REASONING_TRUNCATE_LIMIT`), matching the tool-result window. The same session drops to 22 KB per turn. Reflection payloads are capped at 128 KiB anyway, so the dropped middle never reached a model.
2. **Consumed journals are retired.** A journal whose reflection cursor covers every assistant step, idle for 7 days and not live, is retired: its transcript is deleted, `state.json` is reset, and `retired.ids` keeps one 16-hex key per message (17 bytes). Because the session wiring replays the whole branch on every settle, an append skips rows whose message key is retired, so a resumed session journals only new messages.
3. **Transcripts have a 32 MiB budget per identity.** While over it, the least recently active non-live journals idle for 24 hours are retired as well, consumed or not. A backlog that reflection never consumed (for example while reflection is parked after repeated failures) is dropped on purpose: memory keeps what can be injected, and an unconsumed transcript is not that.
4. **Retired markers expire after 90 days**, so the key files cannot accumulate either. A session revived after that is journaled afresh.
5. **Facts watermarks follow retirement.** Facts cursors store transcript line numbers, which restart at 0 after retirement. Under the journal lock, retirement asks the facts queue to drop the conversation's cursor and consumed record (`FactsQueue.resetConversation`), and keeps the journal while a facts batch for it is still queued.
6. **Terminal facts runs keep at most 16 MiB** (newest 20, newest always kept). They are diagnostics.

Live sessions are never retired or evicted. A single very long live session can exceed the transcript budget until it ends; `/doctor` reports it.

## When the work runs

Retirement and eviction run inside the existing memory maintenance pass (`memory-maintenance.ts`): at most once per identity per 12 hours across all processes (stamp in the repo config, held under the identity's `memory-maintenance` lock), starting 30 s after a session binds, cancelled when the session exits. A host with no binding session does no memory work at all. On a store that is already oversized, the first pass after upgrade is the one-time compaction; later passes are a directory listing plus small `state.json` reads, and log nothing when nothing changed.

The pass never reads a transcript into memory: decisions use file sizes, mtimes and `state.json`, and retirement streams the transcript in 256 KiB chunks to collect message keys. Compacting a synthetic 460 MiB store (one 256 MiB unconsumed legacy journal plus 100 sessions of 2 MiB and a live one) took 316 ms and left 30.4 MiB; the largest event-loop stall measured during the pass was 1 ms.

## Metric

`measureMemoryFootprint(identityPaths)` (memory-core) walks the identity asynchronously, capped at 200,000 entries, and reports bytes per area: repo, transcripts, facts, reflection, worktrees, recall, other. `/doctor` shows it as the `storage` line and warns above 64 MiB in total or 32 MiB of transcripts. The maintenance log line `omo-senpi memory transcripts compacted` carries bytes before and after, counts, and the footprint.

## Not changed

- Memory repo history is kept; it is small packed markdown and the palace history view reads it.
- Receipts stay append-only; at about 300 bytes per event they need years to reach 1 MiB. Rotation is a follow-up if that changes.
