# Plan: issue #7226 - main TUI session ignores per-agent fallback_models

Worktree: /home/viprix/projects/oom-wt-7226 (branch issue/7226-fallback-models-main-session, base dev @8833800ae)

## Root cause (verified by reading source)

Per-agent `fallback_models` from omo config are consumed in exactly two places:

1. **Delegate/subagent dispatch (proactive):** `packages/omo-opencode/src/tools/delegate-task/subagent-model-resolution.ts:39-60` feeds `flattenToFallbackModelStrings(normalizeFallbackModels(agentOverride.fallback_models))` into `resolveModelForDelegateTask`, which promotes the first reachable fallback entry when the user primary model is unreachable (`packages/delegate-core/src/model-selection.ts:88-118`, log line "user primary model unreachable; promoting user fallback_models entry").
2. **Reactive runtime-fallback:** `packages/omo-opencode/src/hooks/runtime-fallback/fallback-models.ts:39-99` resolves the same chains, but (a) it is gated behind `runtime_fallback.enabled` which defaults to false (`packages/omo-opencode/src/plugin/chat-message.ts:42-53`), and (b) it only fires AFTER a retryable provider error (`hooks/runtime-fallback/event-handler.ts:251-268`). It never runs at startup.

The main/interactive session's `chat.message` path (`packages/omo-opencode/src/plugin/chat-message.ts:91-140`) applies only the stored-session-model replay (`chat-message/session-model.ts:22-48`). Nothing walks the agent's `fallback_models` for the main session. Result: at startup with an unreachable primary, the user must manually re-pick a model, while delegated task() calls sail through the same outage via their proactive chain walk.

## Changes

1. NEW `packages/omo-opencode/src/plugin/chat-message/main-session-fallback.ts`
   - `resolveMainSessionFallbackModel(params)`: pure resolver. Given sessionID, agent name, requested model descriptor {providerID, modelID}, pluginConfig, and an availableModels set:
     - returns undefined for subagent sessions (delegate path already owns them),
     - returns undefined when the agent has no `fallback_models` (own or via its category),
     - reuses `resolveModelForDelegateTask` (userModel + flattened userFallbackModels) so main-session behavior is literally the delegate code path, not a reimplementation,
     - returns the promoted `{providerID, modelID, variant?}` only when `matchedFallback` is true and availability data was warm; empty/cold availability data yields undefined (never guess).
   - `applyMainSessionFallbackOverride(args)`: async wiring for chat-message.ts. Builds availableModels via `getAvailableModelsForDelegateTask(ctx.client)` (cache-first), calls the resolver, mutates `output.message.model` (+variant from the promoted entry, deleting variant when the entry has none - mirrors runtime-fallback `applyRuntimeModel`), logs, and shows one toast per session/model-key change (dedupe map + `_resetMainSessionFallbackStateForTesting`).
2. EDIT `packages/omo-opencode/src/plugin/chat-message.ts`: invoke `applyMainSessionFallbackOverride` after the `getStoredMainSessionModel` block and before `runChatMessageHooks`, so `recordSessionModel` records the promoted model (self-healing on later messages) and downstream hooks see the final model.
3. NEW co-located test `packages/omo-opencode/src/plugin/chat-message/main-session-fallback.test.ts` (given/when/then style) - WRITTEN FIRST, proven RED against a stub resolver that reproduces current (no-promotion) behavior, then GREEN after implementation.

## Non-goals

- No changes to reactive runtime-fallback gating or semantics.
- No hardcoded-chain consultation for primary agents (that is the separate default-off model-fallback system); this fix only honors explicitly user-configured `fallback_models`.
- No schema changes.

## Verification

- RED: new tests against stub -> assertion failures proving they detect the regression.
- GREEN: same tests after implementation.
- Scoped suites: `bun test packages/omo-opencode/src/plugin/chat-message packages/omo-opencode/src/hooks/runtime-fallback packages/omo-opencode/src/tools/delegate-task`.
- Typecheck: `tsgo --noEmit -p packages/omo-opencode/tsconfig.json`.
- Evidence: `.omo/evidence/20260824-7226-main-fallback/` (force-added; .omo is gitignored).
