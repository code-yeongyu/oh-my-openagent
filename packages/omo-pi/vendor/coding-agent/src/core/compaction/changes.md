# changes.md — compaction

## Split-turn compaction serialization sync (2026-07-02)

### What changed

- `compaction.ts`: accepted upstream serialization of split-turn compaction summaries so single-concurrency providers do
  not receive overlapping generations.

### Why

- Split-turn compaction can be triggered while the session is still processing summary work. Serializing those summaries
  avoids provider-side 429/concurrency failures and keeps compaction state deterministic.

### Why extension system couldn't handle this

- The serialization boundary is inside core compaction preparation/execution. Extensions can provide or observe
  summaries, but they cannot serialize the underlying core summary request queue from outside.

### Expected merge conflict zones

- LOW: `compaction.ts` around summary generation scheduling and split-turn helper calls.

## Plugsuit-style Threshold Foundation (2026-04-28)

### What changed

- `compaction.ts`: Added speculative compaction settings fields (`speculativeEnabled`, `speculativeFraction`, `speculativeCooldownMs`) to `CompactionSettings` and defaults.
- `extensions/builtin/compaction/policy.ts`: Removed the 0.78 OMO threshold floor. Effective threshold now follows the adaptive plugsuit-style tiers directly (0.45/0.50/0.55/0.60/0.65), with yield adjustment clamped to the existing 0.4-0.7 adaptive range.
- `extensions/builtin/compaction/policy.ts`: Added `SPECULATIVE_FRACTION`, `shouldStartSpeculativeCompaction()`, `computeEffectiveKeepRecentTokens()`, and `isAtHardLimit()` for later speculative/emergency phases.
- `settings-manager.ts`: Resolved compaction settings now include speculative and restoration fields.
- `extensions/builtin/compaction/index.ts` and `speculative.ts`: Builtin compaction uses resolved settings from `ExtensionContext` instead of hardcoded defaults for before-turn threshold checks and snapshot preparation.

### Why

- Plugsuit starts compaction much earlier than the OMO 78% floor. Keeping the floor made senpi's auto-compaction late and mostly reactive.
- Removing the floor alone is unsafe for small context windows because the default `keepRecentTokens` (20000) can exceed the useful compactable range. The effective keep-recent cap prevents early thresholds from producing empty preparations.
- Speculative and emergency phases need stable policy functions and settings keys before they can be wired safely.

### Why extension system couldn't handle this

- The policy constants live in the builtin compaction extension and must be shared by unit tests, speculative snapshots, and future emergency pruning.
- Resolved settings are owned by core `SettingsManager`; builtin extensions needed a typed `ExtensionContext` reader to avoid bypassing user `settings.json`.

### Modified upstream files

- `compaction.ts` — additive `CompactionSettings` fields and defaults.
- `settings-manager.ts` — resolved setting defaults for new compaction fields.

### Expected merge conflict zones

- LOW: `compaction.ts` settings interface/defaults.
- MEDIUM: `settings-manager.ts` `CompactionSettings` and `getCompactionSettings()` if upstream changes settings shape.

### Migration notes

- Preserve the invariant that adaptive threshold and effective keep-recent cap are updated together. Do not reintroduce a hard floor without also proving small-context compaction can still prepare non-empty summaries.

## prepareCompaction Rejects Empty Summarization (2026-04-28)

### What changed

- `compaction.ts`: `prepareCompaction()` now returns `undefined` when both `messagesToSummarize` and `turnPrefixMessages` are empty.
- `_executeCompaction()` (unchanged) reaches its existing "Nothing to compact (session too small)" error path, which surfaces as a clear failure instead of silently invoking the LLM with an empty `<conversation>` block.

### Why

When `keepRecentTokens` (default 20000) is larger than the total session token count, `findCutPoint` defaults to the first valid cut point and then `findCutPoint`'s backward scan extends the cut all the way to entry 0 (model_change / thinking_level_change). The result was a preparation with `messagesToSummarize: []`, `turnPrefixMessages: []`, and `firstKeptEntryId` pointing at the very first non-message entry. The new builtin compaction extension then called the LLM with an empty `<conversation></conversation>` block and the 9-section prompt's R2 rule ("If a section has no content, write 'None.'") forced the model to emit `None.` for every section. That all-`None.` summary was persisted as a real compaction entry, **destroying the conversation that should have been summarized**.

A real reproducer: `~/.senpi/agent/sessions/--Users-yeongyu-local-workspaces-senpi-mono--/2026-04-28T01-50-51-950Z_*.jsonl` contains two consecutive compactions on a tiny Kimi K2.6 hello session, both stored as all-`None.` summaries with `tokensBefore` of 11527 and 11690.

### Why extension system couldn't handle this

`prepareCompaction()` is core; it computes the cut point, the messages to summarize, and the previous summary. Extensions can override the summary content via `session_before_compact`, but they cannot decide whether the core preparation step itself should reject the request. Without this guard in core, every extension and the upstream fallback `compact()` call would have to repeat the same emptiness check.

### Modified upstream files

- `compaction.ts` — `prepareCompaction()` returns `undefined` when there is nothing to summarize.

### Expected merge conflict zones

- LOW: `compaction.ts` `prepareCompaction()` is rarely changed upstream. The guard is a small additive check immediately before the final return; conflict resolution is to keep the guard and apply it after upstream's preparation logic computes `messagesToSummarize` / `turnPrefixMessages`.

### Migration notes

If upstream changes `prepareCompaction()` to compute additional summary inputs (for example a separate "trailing reminders" array), extend the emptiness guard to include them. The invariant: never return a defined `CompactionPreparation` whose total summarizable content is empty.

## Branch Summarization Routes Through Compaction Hook (2026-04-27)

### What changed

- `branch-summarization.ts`: `generateBranchSummary()` now emits `session_before_compact` with `reason: "branch"` before the default branch prompt path when an extension runner is provided.
- `branch-summarization.ts`: Branch entries are converted into an equivalent `CompactionPreparation` object for extensions.
- `branch-summarization.ts`: Extension `{ compaction: CompactionResult }` responses override the branch summary; `{ cancel: true }` aborts branch summarization.

### Why

- Branch summary was a separate route with a different prompt and no Critical Context section, causing the 9 inconsistencies the user listed.
- Routing through `session_before_compact` lets the builtin extension provide one canonical 9-section prompt across all 6 routes.
- The existing `BRANCH_SUMMARY_PROMPT` remains the fallback when no extension overrides.

### Why extension system couldn't handle this

The branch summarization path did not emit a compaction event before building its default prompt. Extensions can only replace branch summary content after this seam exists in core.

### Modified upstream files

- `branch-summarization.ts` — emits `session_before_compact` for branch summaries and accepts extension-provided compaction summaries.

### Expected merge conflict zones

- LOW: `branch-summarization.ts` is rarely touched upstream. If upstream changes branch summary preparation, keep the hook emission before default prompt construction and update the `CompactionPreparation` mapping to match the new data flow.

### Migration notes

If upstream changes branch summary preparation or adds new branch summary data sources, keep the `session_before_compact` hook emission before default prompt construction and update the `CompactionPreparation` mapping to match the new data flow. The `BRANCH_SUMMARY_PROMPT` fallback must remain intact for sessions without the compaction extension.
