# Memory storage budget

The omo memory store should stay small: well under 100 MB per identity in steady state, normally 10-50 MB. Memory exists to be injected into agent context (the compiled memory block, recall nudges, the save nudge); data that can never be injected or recalled should be derived, bounded, or removed once it has been used.

This note maps what the store holds, measures where it grows, and records what is implemented now and what is proposed but held for a design review with the memory maintainers. Research behind the numbers: production memory systems keep the injected tier at 8-32 KB (Claude Code loads at most 25 KB of `MEMORY.md`, <https://code.claude.com/docs/en/memory>; Codex injects a summary truncated to 2,500 tokens, <https://github.com/openai/codex/tree/main/codex-rs/memories>) and keep raw transcripts out of the memory store or on a retention sweep (Claude Code `cleanupPeriodDays`, default 30, <https://code.claude.com/docs/en/settings-reference>). The stores that grow to gigabytes are the ones that never delete (Codex rollout directories of 91-755 GiB in <https://github.com/openai/codex/issues/34061>).

## What the store holds

Per identity, under `~/.omo/memory/agents/<id>/` (or `OMO_MEMORY_HOME`):

| Area | Path | Injected? | Bound today |
|---|---|---|---|
| Memory repo | `repo/` (git, markdown) | Yes: compiled block, projection (40 entries/dir, 24 KiB), recall | Compile token advisory and projection caps; history packed by maintenance |
| Transcript journals | `runtime/transcripts/<session>/` | No: input for reflection and facts only | Consumed idle journals are retired (below); unconsumed ones are kept |
| Facts queue and runs | `runtime/facts-queue/`, `runtime/facts/` | No | Queue entries are consumed; terminal runs keep the newest 20 under 128 MiB |
| Reflection runs, worktrees | `runtime/reflection*/`, `runtime/worktrees/` | No | Orphan sweep and run ledger retention |
| Recall | `runtime/recall/` | Nudges only | Kibitzer sidecars pruned after 7 idle days |
| Receipts | `runtime/receipts.jsonl` | No | Append-only, about 300 bytes per event |

There is no SQLite database in the memory store, so WAL growth, freelists and `VACUUM` do not apply here. The BM25 term store is a derived cache inside `repo/.git/`.

## Where the growth is

Each session writes one `transcript.jsonl`, append-only. Nothing removed it once reflection and facts had consumed it; only journals that never recorded a message were swept (#9737). Measured with the real `TranscriptJournal` on a synthetic tool-heavy session (300 turns, each with a 400-char prompt, a 1,500-char answer, 6,000 chars of reasoning and four 12 KB tool results): 7.9 MB, 26 KB per turn. A hundred such sessions is about 800 MB.

## Implemented: retire consumed journals, report the size

1. **Consumed journals are retired.** A journal whose reflection cursor covers every assistant step, with nothing appended for 7 days and whose session is not live, is retired: its transcript is deleted, `state.json` is reset, and `retired.ids` keeps one 16-hex key per message (17 bytes). Because the session wiring replays the whole branch on every settle, an append skips rows whose message key is retired, so a resumed session journals only its new messages. Unconsumed journals are never removed.
2. **Facts watermarks follow retirement.** Facts cursors store transcript line numbers keyed by session id, and a retired journal restarts at line 0. If the old watermark stayed, every later batch of a resumed session would be enqueued, run, and then rejected as already consumed, so the same turns would be extracted on every settle. Retirement therefore asks the facts queue, under the journal lock, to drop that conversation's cursor and consumed record (`FactsQueue.resetConversation`), and keeps the journal while a facts batch for it is still queued. This is the only facts change; it touches no sync or identity code.
3. **The work runs in the existing maintenance pass** (`memory-maintenance.ts`): at most once per identity per 12 hours across processes, under the identity's `memory-maintenance` lock, 30 s after a session binds, cancelled when the session exits. A host with no binding session does no memory work. The pass never reads a transcript into memory: decisions use file sizes, mtimes and `state.json`, and retirement streams the transcript in 256 KiB chunks to collect message keys.
4. **Metric.** `measureMemoryFootprint(identityPaths)` walks the identity asynchronously, capped at 200,000 entries, and reports bytes per area (repo, transcripts, facts, reflection, worktrees, recall, other). `/doctor` shows it as the `storage` line and warns above 64 MiB.

## Proposed, held for design review

These need a decision from the memory maintainers and are not part of this change:

- **Eviction under storage pressure:** a per-identity transcript budget (for example 32 MiB) that also retires idle journals reflection never consumed. Without it, a store whose reflection is parked after repeated failures still grows without bound; with it, that backlog is lost unless it is first force-consumed or summarized, or the prune is made user-visible.
- **Capping reasoning at capture** to a head+tail window like tool results (measured 26 KB to 22 KB per turn on the session above). It changes what reflection sees.
- **Expiring retired markers** after a long idle period, and a smaller cap for terminal facts runs.
