# Plan - Issue #6871 compaction deadlock (salvage continuation)

Crash-recovery note: a previous agent session died mid-task leaving an untracked
`packages/omo-senpi/src/components/compaction-recovery/` component plus a
one-line registration in `component-list.ts`, with typecheck errors. This plan
records the salvaged scope; every remaining edit below was executed after this
file was written.

## Root cause (verified against pinned engine dist 2026.8.23)

- Engine builtin compaction (`node_modules/@code-yeongyu/senpi/dist/core/extensions/builtin/compaction/deterministic-fallback.js`,
  `createRequiredCompactionFallback`, lines 99-172) tries exactly TWO candidates:
  the prepared boundary (line 162-164) and the single latest meaningful user turn
  (lines 165-170). Each candidate is rejected by `projectCandidate` when the
  retained suffix misses `contextWindow - reserveTokens` (line 156-159) or fails
  `hasUnsafeRetainedContent` (line 154).
- When both candidates fail it returns `undefined`; the caller
  (`compaction/index.js` line 547-554) cancels with reason "deterministic
  compaction fallback cannot retain the prepared suffix".
- agent-session.js `_rejectCompaction` (line ~4160) emits `session_compact`
  with `accepted:false, rejectionCause:"cancelled-by-extension"` and nothing
  else handles the still-over-budget session: every later auto-compaction
  attempt fails identically -> session unusable (#6871).

The engine is an npm-pinned dependency, so the fix lands in the omo-senpi
adapter as a recovery component using only sanctioned ExtensionContext ports.

## Files

1. `packages/omo-senpi/src/components/compaction-recovery/detection.ts` (salvaged)
   Structural narrowing of `{type:"session_compact", accepted:false,
   reason:"threshold"|"overflow", rejectionCause:"cancelled-by-extension"}` and
   of the event context ports (`getContextUsage`, `getCompactionSettings`,
   `isCompacting`, `applyCompaction`, `sessionManager.getBranch`). All five ports
   verified present on the real runner context (runner.js lines 722-845).
2. `packages/omo-senpi/src/components/compaction-recovery/rescue.ts` (salvaged)
   `planRescueCompaction`: earliest SAFE boundary (user/assistant-first suffix,
   never toolResult-first) whose conservative 3-bytes-per-token suffix estimate
   fits `contextWindow - reserveTokens - 512`. Maximum retention that fits.
3. `packages/omo-senpi/src/components/compaction-recovery/diagnostics.ts` (salvaged)
   Best-effort JSONL record per phase under `<agentHome>/logs/compaction-recovery.log`
   (#6871 ask: persist WHY a rejection happened; engine only shows TUI text).
4. `packages/omo-senpi/src/components/compaction-recovery/index.ts` (salvaged + fixed)
   Registers `session_compact`; on a required rejection writes diagnostics, then
   DEFERS past the failing pipeline and applies the rescue plan through
   `applyCompaction(plan, {reason})`. Emits ONE visible guidance message when no
   rescue could be applied (#6871 ask: surfaced unrecoverable state).
5. `packages/omo-senpi/src/extension/component-list.ts` (salvaged)
   Registers `createCompactionRecoveryComponent()` after memory, before
   config-watch (keeps documented memory-before-config-watch invariant).
6. Tests (salvaged + fixed): `detection.test.ts`, `rescue.test.ts`,
   `index.test.ts` - bun test, given/when/then.
7. Crash-recovery fixes by this session:
   - index.ts: pass narrowed `rejected` into `runRescue(rejection)` param
     (hoisted function declarations do not keep TS narrowing) and use the param
     inside the function.
   - detection.test.ts: drop `percent` field not present in `RecoveryUsage`.
   - index.test.ts: supply required `config` in ComponentContext fixtures.

## Verification plan

- `bun test packages/omo-senpi/src/components/compaction-recovery` (21 tests)
- `tsgo --noEmit -p packages/omo-senpi/tsconfig.json`
- `bun run test:senpi` (build + typecheck + full package suite + evidence-dir script test)
- Before/after proof script captured in this evidence dir.
- Live senpi drivers: senpi binary absent in this environment -> would report
  SKIP; recorded honestly in QA.md.
