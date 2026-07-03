# Builtin compaction extension changes

## Speculative compaction invalidation on abort and model switch (2026-05-23)

- `index.ts` now invalidates the in-memory speculative compaction job on `model_select` and on assistant
  `message_end` events with `stopReason: "aborted"`.
- This prevents a summary generated under the old context-window assumptions from being reused by the next blocking
  compaction route after the user aborts or switches models.
- This stays in the builtin extension because speculative generation ownership lives in the extension closure; core only
  owns the visible compaction abort controllers and message revision.

Expected upstream conflict zones: `builtin/compaction/index.ts` around speculative job lifecycle events and
`message_end` degradation-monitor wiring.

## OpenAI remote compaction timeout fallback (2026-05-19)

- Added a bounded timeout around both OpenAI Responses WebSocket compaction and `/responses/compact` remote compaction.
- When the remote route does not respond, the extension emits a `remote_fallback` event with `remote-compaction-timeout` and lets normal local compaction proceed.
- This stays in `openai-remote.ts` because endpoint selection, timeout, and fallback are provider-native compaction policy, not core session lifecycle.

Expected upstream conflict zones: `builtin/compaction/openai-remote.ts` around remote route execution and fallback events.

## OpenAI remote compact API path (2026-05-15)

- Added `openai-remote.ts` as a builtin-extension module that can compact with OpenAI provider-native history when the
  current session branch is entirely representable as OpenAI Responses input.
- WebSocket-capable OpenAI Responses models use the Codex-style `context_compaction` streaming route first. The
  `/v1/responses/compact` endpoint remains the fallback for non-WebSocket models or failed WebSocket compaction attempts.
- The extension stores the returned native compacted input on `CompactionResult.details`, then rewrites later OpenAI
  Responses provider payloads so the compacted session can continue from the provider-native history.
- The extension emits `senpi:compaction` events for remote start, completion, fallback, and payload rewrite points so other
  extensions can observe which compaction route was used.
- This remains in the builtin extension because provider compatibility, endpoint selection, fallback, and provider-payload
  rewriting are all extension-hookable. Core only needs to carry opaque compaction details to the renderer.

Expected upstream conflict zones: `builtin/compaction/openai-remote.ts`, `builtin/compaction/index.ts` around
`session_before_compact`, and `before_provider_request` hook wiring if upstream changes compaction extension policy,
remote compaction protocol, or provider request events.

## Blocking compaction feedback scope

- Changed `index.ts` so blocking extension compaction calls `ctx.beginCompaction()` before awaiting an in-flight speculative job or generating a fresh summary.
- The feedback signal is linked to speculative generation aborts, and `ctx.endCompaction()` is used only when no compaction entry is applied.
- This remains in the builtin extension because the policy deciding when to await speculative work or generate a fresh summary is extension-owned; the core only provides the visible feedback/cancellation scope.

Expected upstream conflict zones: `builtin/compaction/index.ts` around `applyBlockingCompaction()` and `core/agent-session.ts` around extension compaction context actions.

## 2026-05-12 - Local tool-pair repair for packaged senpi

### What changed
- Added `repair-tool-pairs.ts` to keep compaction's tool-call/tool-result repair logic inside the coding-agent package.
- Switched `builtin/compaction/index.ts` and the compaction repair tests to use the local helper instead of importing `repairOrphanedToolResults` from `@earendil-works/pi-ai`.

### Why
- The published `@code-yeongyu/senpi` package depends on the registry `@earendil-works/pi-ai@^0.74.0`, but the fork-only `repairOrphanedToolResults` export is not present in that published dependency.
- That mismatch makes `senpi` crash during module loading with `SyntaxError: The requested module '@earendil-works/pi-ai' does not provide an export named 'repairOrphanedToolResults'` before any command can run.

### Why extension system couldn't handle this
- The failure happens at ESM module evaluation time while loading a builtin extension, before runtime hooks or settings can intervene.

### Expected merge conflict zones
- LOW: `builtin/compaction/index.ts` import block and any future attempt to re-share this helper from `pi-ai`.

## Post-compact restoration tracker

- Added `restoration-tracker.ts` as a builtin-extension module so file and skill context can be restored without modifying core session flow.
- Added compaction extension hooks for `tool_call`, accepted `session_compact`, and one-shot `before_agent_start` injection.
- Added optional restoration settings to `CompactionSettings` and state storage for the tracker.
- Extension system is sufficient because the feature only needs tool-call observation, compaction lifecycle events, and custom-message injection.

Expected upstream conflict zones: `builtin/compaction/index.ts`, `builtin/compaction/state.ts`, and `core/compaction/compaction.ts` if upstream changes compaction settings or extension hook wiring.
