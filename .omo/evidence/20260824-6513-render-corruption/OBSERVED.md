# WHAT WAS OBSERVED

## Root cause

`packages/omo-opencode/src/cli/run/event-message-handlers.ts` diffed
`message.part.updated` text/reasoning snapshots against single-slot session
accumulators (`state.lastPartText`, `state.lastReasoningText`):

- old line 67: `const newText = part.text.slice(state.lastPartText.length)`
- old line 52: same pattern for reasoning

The accumulators are shared across ALL parts and are force-reset by unrelated
events: `handleToolPart` (event-message-handlers.ts:146),
`handleToolResult` (event-tool-handlers.ts:36), and new-message handling
(handleMessageUpdated). When a text part emits a later full snapshot after such
a reset, `slice(0)` re-prints the entire block; when the accumulator holds a
different part's longer text, `slice(staleLength)` lands mid-content and prints
substituted lines, spliced character runs, or nothing. This matches the issue
signature: tail-biased duplication, cross-line substitution, mutated characters,
line-number desync, intermittence (event-order dependent), format independence.

## Red (before fix)

`bun test packages/omo-opencode/src/cli/run/event-message-handlers.test.ts`
with the fix stashed: 9 pass / 2 fail:

- "does not reprint a text part snapshot after an interleaved tool result":
  "alpha" rendered twice (Expected: 1, Received: 2)
- "renders a new text part whose snapshot is shorter than the previous part
  accumulator": "second part body" dropped entirely

Artifact: red-failing-test-output.txt

## Green (after fix)

Per-part baselines (`state.partTextById`, `state.reasoningTextById`) keyed by
part ID with prefix-match diffing (`resolveRenderedBaseline`), anonymous-bucket
adoption for legacy id-less deltas, buckets cleared on new assistant message.
Global mirrors (`lastPartText`/`lastReasoningText`) kept for existing readers
(runner.ts completion summary) and tests.

- `bun test packages/omo-opencode/src/cli/run/`: 200 pass / 0 fail
  (includes 4 new regression tests + all pre-existing renderer contracts)
- `bun run typecheck`: clean (tsgo --noEmit, script, all workspace packages)

Artifact: green-scoped-suite-output.txt
