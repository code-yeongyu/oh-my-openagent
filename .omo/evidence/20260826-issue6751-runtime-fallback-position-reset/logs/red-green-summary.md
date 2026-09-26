# RED -> GREEN log summary

## RED (unmodified production code, new tests only)

Command:
  bun test packages/omo-opencode/src/hooks/runtime-fallback/event-handler.test.ts \
    packages/omo-opencode/src/hooks/runtime-fallback/chat-message-handler.test.ts \
    packages/omo-opencode/src/hooks/runtime-fallback/runtime-fallback-position.test.ts

Result: 22 pass, 5 fail. Full output: logs/red-new-tests.log

Failing (all for the expected defect reasons):
1. stop echo preserves fallback position - FAILED: state replaced with fresh
   createFallbackState (fallbackIndex -1, failedModels empty).
2. stop+idle echo pair survives - FAILED: same wipe signature via both paths.
3. forward-only progression across echoes - FAILED: second dispatch repeated
   go/fallback-a instead of advancing to zen/fallback-b.
4. marker-carrying dispatch mismatch keeps position - FAILED: manual-change
   reset replaced state with originalModel=go/fallback-a (the corruption that
   enables the backward hop to the just-failed primary).
5. e2e monotonicity through real hook - FAILED: dispatched sequence became
   [go/fallback-a, zen/fallback-b, go/fallback-a] after the echo wipe.

Baseline before adding tests: logs/red-baseline.txt (295 tests pass on the
pristine directory).

## GREEN (after fixes)

1. bun test packages/omo-opencode/src/hooks/runtime-fallback/ -> 296 pass
   (includes the watchdog-mark test added during audit wave 1).
2. Adjacent gate suite -> 366 pass across 38 files (twice consecutively):
   logs/gates-run2.log
3. bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json -> exit 0
   (both rounds): logs/tsgo-run2.log
4. GIT_MASTER=1 git diff --check -> clean (both rounds)
5. Hygiene scan of added lines: zero hits for as any / @ts-ignore /
   @ts-expect-error / non-null assertions / as unknown
6. Isolated QA: logs/qa-transcript.txt - 8/8 assertions pass.

## Audit-wave edits and re-verification

- Wave 1 finding W1-1 (P2): first-prompt-watchdog abort source was not marked
  internal; its abort echo wiped prepared fallback state. Fixed in
  auto-retry-abort.ts with RED->GREEN test in auto-retry.test.ts. Focused
  re-run: runtime-fallback directory 296 pass + tsgo exit 0.
- No source/test/evidence edits after that fix except evidence documentation
  files themselves; final verification waves ran over the frozen tree.
