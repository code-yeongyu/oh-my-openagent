# Preemptive compaction: stale-token re-fire, empty summaries, 60s budget

Branch: `fix/preemptive-compaction-refire-and-empty-summary` (base `dev` @ `10bf3db1d`)
Date: 2026-09-18 · Host: Windows · bun 1.3.14

## What the live session showed

Session `ses_...UkQsyy`, 1M-window model (`opencode-go/deepseek-v4.1-flash`, `limit.context` 1000000,
threshold 0.78 → 780,000). OMO's own log (`[preemptive-compaction]` entries) recorded **four consecutive
fires, all of which failed the same way**:

```
17:31:15  Compaction failed {"providerID":"opencode-go","modelID":"deepseek-v4.1-flash","error":"Error: Compaction summarize timed out after 60000ms"}
17:36:44  Compaction failed { ... timed out after 60000ms }
17:49:07  Compaction failed { ... timed out after 60000ms }
17:52:16  Compaction failed { ... timed out after 60000ms }
```

The session database shows what happened to each abandoned attempt:

| attempt started | timeout logged | summary message written | result |
|---|---|---|---|
| ~17:30:15 | 17:31:15 | 17:31:19 | `summary: true`, **0 parts, 0 output tokens** — empty summary |
| ~17:35:44 | 17:36:44 | 17:36:50 | content written 66s after the attempt |
| ~17:48:07 | 17:49:07 | 17:49:11 | content written 64s after the attempt |
| ~17:51:16 | 17:52:16 | 17:52:23 | content written 67s after the attempt |

Two defects follow directly from that shape:

1. **The summarize takes 64–67s against a 60s budget**, so every attempt on a large context is abandoned
   mid-flight. The plugin logs a failure and never latches the session, while the request itself keeps
   running and replaces the prompt a few seconds later.
2. Because the abandoned attempt is never latched, the next tool call after the 60s cooldown recomputes
   the ratio from the **pre-compaction** measurement (824,748 in this session) even though the prompt has
   just been replaced. That is a compaction fired at a real fill of 71,333 tokens (7.1% of the window).

## Changes

- `preemptive-compaction.ts` — on `session.compacted`, drop the cached measurement. It is the
  pre-compaction prompt, above threshold by definition; keeping it lets a tool call justify another
  compaction from a prompt that no longer exists. The next finished non-compaction assistant message
  re-populates the cache.
- `preemptive-compaction-trigger.ts` — after `summarize` resolves, verify the resulting message carries
  text. An empty summary is logged, surfaced as a warning toast, and **not** latched, so a retry stays
  possible instead of the conversation being replaced by nothing.
- `preemptive-compaction-trigger.ts` — `PREEMPTIVE_COMPACTION_TIMEOUT_MS` 60_000 → 120_000, matching the
  budget the degradation monitor already uses for the same call.
- `preemptive-compaction-empty-summary.ts` (new) — the empty-summary check, modelled on the existing
  no-text-tail helper.

## QA & Evidence

### Red / green — the new tests fail without the fix

```
# fix stashed, tests kept
(fail) should trigger compaction when usage exceeds threshold
(fail) should not re-fire from the pre-compaction measurement after a timed-out summarize completes
(fail) should reject an empty compaction summary and allow a retry after cooldown
 16 pass · 3 fail

# fix applied
 19 pass · 0 fail · 32 expect() calls
```

The first line is the pre-existing threshold test, whose assertion is updated by this change: the trigger
now reads `session.messages()` once per compaction to verify the summary. The token source is still the
cache, never a fetch.

### Package suite — CI command, with and without the patch

```
bun test --timeout 20000 packages/omo-opencode

with patch (run 1): 8447 pass · 3 skip · 8 fail · 8458 tests · 196.94s
with patch (run 2): 8448 pass · 3 skip · 7 fail · 8458 tests · 150.76s
patch stashed     : 8446 pass · 3 skip · 7 fail · 8456 tests
```

The same seven failures appear in both states, by name:

```
config check > does not flag configured custom providers as unavailable when they exist in opencode.json
createDynamicTruncator > exposes async usage and sync truncation helpers
dynamicTruncate > suppresses output when the context window is exhausted
getContextWindowUsage > ... retries fresh instead of being poisoned by the timeout
model-resolution-config > reads its opencode view
production prompt injection routes > only the shared gate may call raw OpenCode prompt APIs
sweepWorktrees classification > classifies merged, unmerged, dirty, locked, excluded, missing, and detached worktrees
```

None of the seven are preemptive-compaction tests. Run 1's eighth failure did not reproduce in run 2 and
is one of the timing-sensitive cases above; recorded as a flake, not a regression. The two new tests
account for the 8458 − 8456 test delta, and both pass.

### Typecheck and build

```
bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json   → clean, exit 0
bun run build                                               → all steps completed, exit 0
```

Built bundle (`dist/index.js`) verified to contain `PREEMPTIVE_COMPACTION_TIMEOUT_MS2 = 120000`, the
`tokenCache.delete(sessionID)` call in the `session.compacted` branch, and both new log/toast strings.

### Why this is sufficient

Each of the three behaviors has a test that fails on the previous code and passes on this one. The
package-suite comparison isolates the change from the seven pre-existing failures. The threshold and
timeout numbers are not invented: they come from the session's own log and database, quoted above.

## Risks & residuals

- **Longer block on a stalled summarize.** A compaction can now hold its slot for up to 120s instead of
  60s. Accepted: at 60s the call was abandoned *before* the point where it actually completes on a large
  context, which is the failure this change exists to remove.
- **Empty-summary detection fails open.** If the session's messages cannot be read, the check reports
  "not empty" and the previous behavior stands. Accepted: a false positive would block a legitimate
  compaction.
- **Not addressed here:** the trigger reads its measurement during `tool.execute.after`, so a measurement
  can still lag one message behind. This change removes the case where the lagging value is the
  *pre-compaction* one; the general ordering race is left alone.
- **Not addressed here:** the degradation monitor's recovery path calls `summarize` through
  `resolveCompactionModel`, which falls back to the session's own model when the per-agent compaction
  model cannot be resolved. In this session that fallback ran two summarizations of ~650K tokens each on
  the session model instead of the configured compaction model.
