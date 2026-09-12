# Plan: Fix #7150 - assistant prefill recovery infinite continuation loop

## Root cause (verified against worktree source)

`ensureUserTurnAfterAssistantTail()` in `packages/omo-opencode/src/plugin/messages-transform.ts`
appends `[internal] Continue from the previous assistant state.` whenever BOTH hold:

1. Last payload message role == `"assistant"`.
2. Any trigger matches:
   - `hasInternalContinuationTrigger()` - last user turn carries `metadata.compaction_continue === true`
     (sticky: stays the last user turn for the whole autonomous run after one compaction),
   - `shouldRepairAssistantPrefillForModel(...)` - provider in
     `ASSISTANT_PREFILL_UNSUPPORTED_PROVIDERS` (incl. `opencode`, `opencode-go`,
     `opencode-zen-proxy`) AND modelID normalizes to a rejecting prefix
     (`claude-opus-4*`, `claude-sonnet-4-6`, `claude-mythos`) or an anthropic namespace.

There is NO completeness check and NO loop-breaker:

- OpenCode stores tool results as parts on the assistant message itself, so every
  tool-call -> auto-continue request ends with an assistant-side tail.
- For gated models/triggers the injection therefore fires on EVERY such request,
  including after the agent explicitly signalled completion (completed tool call).
  The injected instruction makes the model continue and re-signal -> infinite loop
  (30+ cycles observed in the issue). Post-compaction, the sticky trigger makes the
  injection fire even for plain finished text turns.

## Fix design (minimal, keeps all pinned test behavior)

New file `packages/omo-opencode/src/plugin/assistant-prefill-recovery.ts`:
factory `createAssistantPrefillRecoveryGate()` returning
`maybeAppendRecovery(output)`; `createMessagesTransformHandler` owns one instance
(closure state lives one plugin-load, reset per test via fresh factory).

Skip injection (loop-breakers + completeness gate), checked in order:

1. Chain-breaker marker: last user turn already carries a part with
   `metadata.assistant_prefill_recovery === true` -> never inject on top of it.
2. Attempt cap: max 3 injections per user-turn epoch (epoch = last user turn id,
   tracked per sessionID in a bounded Map; new user turn resets). Mirrors the
   `recent-synthetic-idles` bounded-map style.
3. Complete assistant tail:
   - `info.time.completed` positive (turn finished normally), OR
   - last part is a tool part with terminal status (`completed` | `error`;
     unknown status counts as terminal - fail-safe toward not looping).
4. Otherwise inject (genuinely partial: dangling `pending`/`running` tool call,
   empty/missing parts, or text-only partial prefill stream - the shape all
   existing pinned inject-tests use).

Injected part additionally stamped with `metadata.assistant_prefill_recovery: true`
(machine-detectable marker, mirrors `compaction_continue` pattern).

All field reads defensive (`isRecord` + string/number readers) - no `as any`.

## Files

| File | Change |
|------|--------|
| `packages/omo-opencode/src/plugin/assistant-prefill-recovery.ts` | NEW: gate factory + pure helpers |
| `packages/omo-opencode/src/plugin/assistant-prefill-recovery.test.ts` | NEW: regression scenarios (a)(b)(c) + cap + marker + time.completed |
| `packages/omo-opencode/src/plugin/messages-transform.ts` | Delegate `ensureUserTurnAfterAssistantTail` to the gate |

No changes to provider sets, prefixes, other hooks, or other providers' behavior.
Existing tests untouched (all pinned inject cases are text-only tails without
`time.completed` -> still inject; all pinned no-inject cases are gate-level -> still skip).

## Verification

1. New tests RED before the fix, GREEN after (`bun test` scoped files).
2. Existing `messages-transform*.test.ts` suites stay green.
3. `bun run typecheck` green.
4. Evidence under `.omo/evidence/20260824-prefill-recovery-loop/`.

## PR

Conventional commit `fix(opencode): ...`, push fork branch
`issue/7150-prefill-recovery-loop`, PR into `dev`, body ends `Fixes #7150`.
