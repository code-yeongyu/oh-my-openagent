# src/hooks/compaction-context-injector/ -- Post-Compaction Context Recovery

**Generated:** 2026-05-18

## OVERVIEW

Continuation Tier hook. Fires on `session.compacted` to re-inject critical context lost during context-window compaction. Prevents the agent from losing its bearings after OpenCode trims session history.

## TIER + EVENT

- **Tier:** Continuation
- **Event:** `session.compacted` (primary), `session.idle`, `session.deleted`, `message.updated`, `message.part.delta`, `message.part.updated`

## KEY FILES

| File | Purpose |
|------|---------|
| `hook.ts` | `createCompactionContextInjector()` -- composes capture, restore, inject, event |
| `recovery.ts` | `createRecoveryLogic()` -- rebuilds agent/model/tools after compaction |
| `tail-monitor.ts` | Tracks assistant output to detect no-text tails |
| `session-prompt-config-resolver.ts` | Walks session messages to resolve current agent/model/tools |
| `validated-model.ts` | `validateCheckpointModel()` -- model validation |
| `session-id.ts` | `resolveSessionID()`, `isCompactionAgent()` |
| `recovery-prompt-config.ts` | `createExpectedRecoveryPromptConfig()`, `isPromptConfigRecovered()` |
| `constants.ts` | `RECOVERY_COOLDOWN_MS`, `NO_TEXT_TAIL_THRESHOLD`, `RECENT_COMPACTION_WINDOW_MS` |
| `types.ts` | `CompactionContextInjector` interface |
| `compaction-context-prompt.ts` | `COMPACTION_CONTEXT_PROMPT` -- 8-section summary template |
| `index.ts` / `index.test.ts` | Barrel export + tests |
| `recovery.test.ts` / `session-prompt-config-resolver.test.ts` | Unit tests |

## HOW IT WORKS

1. **Capture:** Before compaction, saves agent/model/tools checkpoint via `setCompactionAgentConfigCheckpoint()`
2. **Inject:** Returns `COMPACTION_CONTEXT_PROMPT` with active delegated session history
3. **Recover:** On `session.compacted`, dispatches internal prompt to restore checkpointed config
4. **Tail monitor:** Detects consecutive assistant messages with no text output; triggers recovery if recent compaction

## INTEGRATION

Registered in `create-continuation-hooks.ts` as `compactionContextInjector`.

## DISTINCTION

- **`compactionTodoPreserver`:** Preserves todos only (sibling Continuation hook)
- **`anthropicContextWindowLimitRecovery`:** Prevents the limit preemptively (Session Tier)
