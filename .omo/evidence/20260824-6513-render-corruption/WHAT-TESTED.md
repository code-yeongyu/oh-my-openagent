# WHAT WAS TESTED

Issue: #6513 - tool-result render corruption (duplicated/substituted lines, character mutation) in eval/Read tool displays.

Surface: `omo run` CLI event renderer, `packages/omo-opencode/src/cli/run/`.

Commands:
- `bun test packages/omo-opencode/src/cli/run/event-message-handlers.test.ts` (red proof, fix stashed)
- `bun test packages/omo-opencode/src/cli/run/` (scoped suite, 200 tests)
- `bun run typecheck` (tsgo --noEmit + typecheck:script + typecheck:packages)

Behavior proven: given a text part snapshot that re-emits after an interleaved
tool result (or after any unrelated reset of the shared accumulator), and given
a sibling part whose snapshot is shorter than the stale accumulator, the
renderer must print each line exactly once and must not drop or splice content.
