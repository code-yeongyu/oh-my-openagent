# changes

## Upstream session, auth, and model-resolution sync (2026-07-02)

### What changed

- `auth-storage.ts`: accepted upstream persistence-failure surfacing so `/login` does not report success when `auth.json`
  could not be saved.
- `agent-session.ts`: accepted upstream split-turn serialization and kept fork prompt/compaction settlement behavior.
- `session-manager.ts`: accepted upstream context-building helper splits while preserving fork compaction detail propagation
  through `createCompactionSummaryMessage(entry.details)`.
- `model-resolver.ts`: accepted upstream structured model-resolution diagnostics and public helper behavior while
  preserving the fork's optional warning callback.

### Why

- These upstream fixes improve observable login errors, prevent overlapping summary generations, and expose consistent
  model diagnostics without dropping fork-only compaction metadata or warning behavior.

### Why extension system couldn't handle this

- Auth persistence, session context reconstruction, prompt/compaction scheduling, and model scope resolution are core
  session services that run before extensions can replace them.

### Expected merge conflict zones

- HIGH: `agent-session.ts` around prompt execution, compaction settlement, and split-turn continuation.
- MEDIUM: `session-manager.ts` around `sessionEntryToContextMessages()` and compaction-entry reconstruction.
- MEDIUM: `model-resolver.ts` around `resolveModelScope()` and diagnostics helpers.
- LOW: `auth-storage.ts` around save failure propagation.

## Resident session payload retention (2026-06-08)

### What changed

- `src/core/session-manager.ts`: large in-memory session strings are retained through a resident store while public
  readers, LLM context construction, branching, forking, and JSONL persistence materialize the original content.
- `src/core/session-resident-store.ts`: centralizes resident string references and store statistics for session payloads.

### Why

- Long sessions can retain repeated large message payloads in every session tree/index view. Keeping large resident
  strings behind lightweight refs lowers steady-state session memory pressure without changing persisted sessions.

### Expected merge conflict zones

- MEDIUM: `SessionManager` append, reload, branch, and persistence paths.
- LOW: tests under `test/session-manager/` that assert exact in-memory entry identity.

## Compaction prompt settlement barrier (2026-05-28)

### What changed

- `src/core/agent-session.ts`: normal user prompts now wait for pending session event processing and in-flight
  compaction work before starting a fresh provider request.
- `src/core/agent-session.ts`: overflow retry and user-visible queued follow-up/steering recovery now await the
  post-compaction continuation instead of scheduling an unobserved delayed `continue()`.
- `src/core/agent-session.ts`: agent-level custom-only queues also use the awaited post-compaction continuation path.
- `src/core/session-work-barrier.ts`: centralizes nested session-work barriers used by compaction settlement.

### Why

- `Agent` can become idle before `AgentSession` finishes `agent_end` compaction work. A prompt submitted in that window
  could race ahead of the compaction boundary or overflow recovery, making queued messages appear out of order or miss the
  compacted context.

### Why extension system couldn't handle this

- Extensions can provide compaction results, but only `AgentSession` can serialize fresh prompts against session event
  processing, compaction mutation, and retry/queue continuation.

### Expected merge conflict zones

- MEDIUM: `AgentSession.prompt()` around the pre-prompt settlement and post-prompt wait.
- MEDIUM: `_executeCompaction()` and `_runAutoCompaction()` around compaction lifecycle and continuation handling.

## Compaction cancellation across abort and model changes (2026-05-23)

### What changed

- `src/core/agent-session.ts`: `abort()` and `dispose()` now cancel in-flight manual/auto compaction and branch
  summarization controllers along with retry/agent cleanup.
- `src/core/agent-session.ts`: `setModel()` and favorite model cycling invalidate compaction state and bump the
  message revision whenever the selected model identity or context window changes.
- `src/core/agent-session.ts`: `model_select` now emits for same provider/model-id selections that change the effective
  context window, so extensions can drop stale model-bound work.

### Why

- An aborted over-context turn could leave a compaction request alive. If the user then switched to a larger-context
  model, stale compaction could finish beside the next normal assistant response and surface duplicate Working/status
  state.

### Why extension system couldn't handle this

- Extensions can observe model and compaction events, but the session owns the abort controllers and the monotonic
  message revision that guards precomputed compaction snapshots.

### Expected merge conflict zones

- MEDIUM: `AgentSession.abort()`, `setModel()`, and `_cycleFavoriteModel()` lifecycle paths.
- LOW: `AgentSession.dispose()` cleanup path and `_emitModelSelect()` early-return logic.

## Tool hook lifecycle status events (2026-05-19)

### What changed

- `src/core/extensions/runner.ts`: `tool_call` and `tool_result` handlers now emit internal start/end lifecycle
  observations with `PreToolUse` / `PostToolUse` labels, bounded status messages, elapsed-time anchors, and completed,
  blocked, or failed end statuses.
- `src/core/agent-session.ts`: the session relays those internal observations to mode listeners as
  `tool_hook_status` events without exposing a new extension author API.

### Why

- The interactive TUI needs to show when extension hook work is happening, including permission-rule matching and
  post-tool result processing, instead of leaving users with only a generic Working indicator.

### Why extension system couldn't handle this

- Extensions can show their own UI, but only the runner knows when each individual hook handler starts, ends, blocks, or
  fails. The session must relay that host-owned lifecycle to the TUI.

### Expected merge conflict zones

- MEDIUM: `extensions/runner.ts` around `emitToolCall()` and `emitToolResult()`.
- LOW: `agent-session.ts` around `_applyExtensionBindings()` and `AgentSessionEvent`.

## User abort prompt settlement barrier (2026-05-17)

### What changed

- `src/core/agent-session.ts`: `abort()` now creates a shared user-abort settlement promise before waiting for the
  active agent run to become idle.
- `src/core/agent-session.ts`: `prompt()` waits for that user-abort promise before classifying submitted input as
  streaming steering/follow-up or a normal fresh prompt.

### Why

- Pressing Esc while a tool call was active started abort asynchronously. A message submitted before the old run settled
  still saw `isStreaming === true`, so it was queued into the aborting run and could remain stuck after abort completed.

### Why extension system couldn't handle this

- The stale queue classification happens inside `AgentSession.prompt()` before extension commands or input handlers can
  reliably distinguish "streaming" from "currently aborting and about to become idle".

### Expected merge conflict zones

- MEDIUM: `AgentSession.prompt()` around the streaming queue branch.
- MEDIUM: `AgentSession.abort()` around agent abort and idle waiting.

## Provider-supplied retry delay handling (2026-05-15)

### What changed

- `src/core/agent-session.ts`: auto-retry now uses provider-supplied retry-after hints from assistant error messages when present, while refusing waits above `retry.provider.maxRetryDelayMs`.

### Why

- Rate-limit and overload responses can include an explicit wait period. Ignoring that hint caused senpi to retry too early with the local exponential base delay, often hitting the same provider throttle again.

### Why extension system couldn't handle this

- Retry scheduling is core `AgentSession` lifecycle behavior. Extensions can observe retry events, but they cannot replace the internal abortable sleep or resolve the prompt-level retry promise.

### Expected merge conflict zones

- MEDIUM: `AgentSession._handleRetryableError()` and retry event emission.

## Avoid duplicate compaction summary message augmentation (2026-05-15)

### What changed

- `messages.ts`: removed the coding-agent-side `CustomAgentMessages.compactionSummary` declaration merge entry.

### Why

- `@earendil-works/pi-agent-core` now declares the shared harness compaction summary message type. Keeping a second
  coding-agent declaration for the same `compactionSummary` slot made `tsgo` reject the package build because the two
  declarations used distinct local interface symbols.

### Why extension system couldn't handle this

- This is TypeScript declaration metadata for core message unions, evaluated at package build time before extensions run.

### Expected merge conflict zones

- LOW: `messages.ts` around the `CustomAgentMessages` declaration merge block.

## Compaction detail propagation (2026-05-15)

### What changed

- `messages.ts`: `CompactionSummaryMessage` can now carry opaque `details` from the accepted compaction result.
- `session-manager.ts`: reconstructed compaction summary messages preserve those details when rebuilding context from
  session entries.

### Why

- The OpenAI remote compact API returns provider-native retained input, counts, and route metadata that should remain
  visible after compaction and across context reconstruction without hard-coding provider behavior into core.

### Why extension system couldn't handle this

- Extensions can create the compaction result, but core owns conversion from persisted `compaction` entries into
  `CompactionSummaryMessage` objects.

### Expected merge conflict zones

- LOW: `messages.ts` around `CompactionSummaryMessage` and `createCompactionSummaryMessage()`.
- LOW: `session-manager.ts` around compaction-entry reconstruction.

## Export tilde paths (2026-05-13)

### What changed

- `src/core/export-html/index.ts` and `src/core/agent-session.ts`: `/export` output paths now expand leading `~` before writing HTML or JSONL exports.

### Why

- A user-facing `/export ~/asdf.jsonl` could create `./~/asdf.jsonl` instead of writing to the home directory.

### Why extension system couldn't handle this

- Export path resolution lives in the core export/session methods before extension command handlers see the final file write.

### Expected merge conflict zones

- LOW: `export-html/index.ts` and `AgentSession.exportToJsonl()` path handling.

## Overflow alias recovery (2026-05-13)

### What changed

- `src/core/agent-session.ts`: context-window overflow errors now trigger overflow compaction with automatic retry when the saved assistant provider differs from the current provider alias but the current context is also at the compaction limit.

### Why

- Imported or resumed sessions can contain OpenAI provider aliases from a previous run. When such a near-limit session overflows, treating the error as threshold compaction leaves the user with an empty error turn and no automatic retry.

### Why extension system couldn't handle this

- Overflow retry policy is core agent-loop recovery behavior; extensions can request compaction but cannot reliably remove the error turn and restart the agent turn.

### Expected merge conflict zones

- MEDIUM: `AgentSession._checkCompaction()` around overflow-vs-threshold recovery.

## Extension duplicate resource conflict policy (2026-05-12)

### What changed

- `src/core/resource-loader.ts`: Extension paths are deduped by nearest `package.json` package name plus relative extension entry before loading, so the same package installed from both a git package checkout and `~/.senpi/agent/extensions/` loads once without dropping multi-extension packages.
- Builtin extensions now precede disk-loaded extensions in the runtime array, and builtin-vs-external tool/flag name collisions no longer surface as startup errors.
- Extension flag defaults and CLI flag validation now follow that final builtin-first order, so an external duplicate flag cannot override builtin metadata by registering earlier during disk discovery.

### Why

- Users with both installed and manually cloned `code-yeongyu/pi-*` extensions saw noisy duplicate tool/flag conflict errors at startup, even when the duplicates represented the same logical extension or a builtin vendored copy.

### Why extension system couldn't handle this

- Extension factories only run after resource discovery and conflict diagnostics. Deduping package paths and classifying builtin/external conflicts has to happen in the core resource loader before the TUI renders startup diagnostics.

### Expected merge conflict zones

- LOW: `resource-loader.ts` around extension path assembly, rebuilt flag defaults, and `detectExtensionConflicts()` if upstream changes resource precedence or conflict diagnostics.
- LOW: `agent-session-services.ts` around extension CLI flag validation if upstream changes extension flag parsing.

## models.json per-model prompt preset metadata (2026-05-12)

### What changed

- `src/core/model-registry.ts`: Custom `models.json` model entries and built-in `modelOverrides` can now carry a `promptPreset` string.
- The registry preserves this value as model metadata for extensions instead of interpreting preset names in core code.

### Why

- Provider-specific model IDs can be too new or too aliased for automatic prompt-preset detection. Putting `promptPreset` next to the model definition keeps the routing metadata with the model catalog entry that needs it.

### Why extension system couldn't handle this

- The prompt-preset extension can consume model metadata, but `models.json` schema validation and model merging live in the core registry. Core needs to preserve the metadata before extensions see the selected model.

### Expected merge conflict zones

- LOW: `ModelDefinitionSchema`, `ModelOverrideSchema`, and `applyModelOverride()` in `src/core/model-registry.ts` if upstream adds more per-model metadata fields.

## Packaged thinking-tier helpers stay local (2026-05-12)

### What changed
- Added `src/core/thinking-levels.ts` so coding-agent owns the senpi-specific `xhigh` / `max` tier detection and supported-level expansion.
- Updated `src/core/agent-session.ts` and `src/core/sdk.ts` to import these helpers locally instead of from `@earendil-works/pi-ai`.

### Why
- The published `@code-yeongyu/senpi` package currently installs the registry `@earendil-works/pi-ai@0.74.0`, whose public exports do not include the fork-only `supportsXhigh` / `supportsMax` helpers.
- Importing those names directly from `pi-ai` makes packaged senpi fail during module loading before any CLI command runs.

### Why extension system couldn't handle this
- Thinking-tier availability is consumed by core session/model logic (`AgentSession`, SDK helpers) during startup and model switching, before extensions can replace those imports.

### Expected merge conflict zones on next upstream sync
- LOW: `agent-session.ts` / `sdk.ts` import blocks and any future upstream move of thinking-level helpers.

## Configured upstream model id and service tier (2026-05-09)

### What changed

- `src/core/model-registry.ts`: Custom `models.json` model entries can now set `upstreamModelId` and per-model `serviceTier`.
- `src/core/sdk.ts`: Provider requests use the configured upstream model id while preserving the configured catalog id for model selection.

### Why

- Users need both a normal catalog entry and a priority catalog entry, such as `gpt-5.5` and `gpt-5.5-fast`, while sending the upstream request as `model: "gpt-5.5"` with `service_tier: "priority"` for only the priority entry.

### Why extension system couldn't handle this

- The model id is embedded by the provider payload builder before `before_provider_request` hooks run, and `service_tier` is a provider-managed field. The registry has to carry the configured wire id and tier into the stream call before payload construction.

### Expected merge conflict zones on next upstream sync

- MEDIUM: `model-registry.ts` schema/request-auth metadata and `sdk.ts` stream option composition.

## Generated default extension fast path (2026-05-08)

### What changed

- `src/core/resource-loader.ts`: Unchanged generated global default extension shims are now recognized by path and exact generated content, then resolved to the known in-process extension factory before the generic jiti loader runs.
- `src/core/resource-loader.ts`: User-edited or replacement files with the same default names still load through the normal extension import path.

### Why

- Clean-profile startup was spending several seconds loading deterministic generated shim files through jiti even though core already knows the matching default extension factories.

### Why extension system couldn't handle this

- Generated default shims are discovered and loaded by core resource bootstrap before extension code can run. Extensions cannot replace the loader's import strategy for their own files.

### Expected merge conflict zones on next upstream sync

- LOW: `resource-loader.ts` around generated global default extension path/content checks and the `loadExtensions()` call.

## Dist-backed default extension shims (2026-05-08)

### What changed

- `src/core/resource-loader.ts`: Default generated global extension shims now point at `dist` files when senpi itself is running from `dist`, even in a linked workspace that also has `src`.

### Why

- Linked CLI startup was re-transpiling default global extension TypeScript files through jiti before the first frame.

### Why extension system couldn't handle this

- Generated default global extension shims are created by core resource loading before extension code runs.

### Expected merge conflict zones on next upstream sync

- LOW: `resource-loader.ts` around `getGlobalDefaultExtensionModulePath()` and default shim generation.

## Model config controls (2026-05-08)

### What changed

- `src/core/model-registry.ts`: `models.json` can disable providers with top-level `disabledProviders` or per-provider `disabled`, filter provider models with `whitelist` / `blacklist`, and replace built-in thinking-level mappings with `thinkingLevelMapMode: "replace"`.
- `src/core/settings-manager.ts` and `src/core/sdk.ts`: added `favoriteModels` settings support and kept `enabledModels` as global model-catalog narrowing.
- `src/core/agent-session.ts`: reload refreshes the model registry, global model narrowing, and favorite models; Ctrl+P cycling only uses the configured favorite models, and available thinking levels honor model-level mapping overrides.

### Why

- The user requested opencode-style provider disable/filtering, favorite-model-only Ctrl+P cycling, and configurable replacement of reasoning variants with reload support.

### Why extension system couldn't handle this

- Model discovery, startup model resolution, persisted settings, and Ctrl+P cycling are core session/model-registry responsibilities. Extensions can add providers or shortcuts, but cannot reliably replace the built-in model registry, default catalog narrowing, or internal cycling semantics before the TUI starts.

### Expected merge conflict zones on next upstream sync

- HIGH: `model-registry.ts` schema/loading and model filtering.
- MEDIUM: `sdk.ts` startup model narrowing resolution and `agent-session.ts` reload/cycle paths.

### Migration notes

- `enabledModels` remains readable as global model narrowing, but Ctrl+P favorites are persisted through `favoriteModels`.

## Favorite model filter hardening (2026-05-11)

### What changed

- `src/core/agent-session.ts`: favorite models now act as a filter over the current available model list and current global narrowing before being exposed or cycled, so stale cached model objects cannot be selected after a provider/model leaves the registry.
- `src/core/model-resolver.ts`: slash-qualified glob patterns now match canonical `provider/model` ids only, preventing patterns like `openai/*` from also matching raw model ids such as `openai/gpt-*` under another provider.

### Why

- Favorite cycling should only choose models that are still present in the current model catalog. This matches opencode's validity filter behavior and avoids switching to stale favorites after provider/model changes.

### Why extension system couldn't handle this

- Favorite model resolution and Ctrl+P cycling are core `AgentSession` behavior, and glob pattern matching is shared by core startup/reload model resolution before extensions can safely override it.

### Expected merge conflict zones on next upstream sync

- `src/core/agent-session.ts` around favorite model getters and `cycleModel()`.
- `src/core/model-resolver.ts` around glob pattern matching in `resolveModelScope()`.

## Favorite model toggle keybinding (2026-05-12)

### What changed

- `src/core/keybindings.ts`: added configurable `app.models.toggleFavorite`, defaulting to `Ctrl+F`, for model selector favorite toggles.

### Why

- Users need the `/model` and `/favorite-models` selectors to select models normally while still being able to toggle favorite status for the highlighted row.

### Why extension system couldn't handle this

- Selector key handling uses the built-in keybinding registry before extension UI code can attach row-local actions, so the built-in selector action needs a first-class keybinding id.

### Expected merge conflict zones on next upstream sync

- LOW: `keybindings.ts` around model selector keybinding definitions.

## Git package dependency repair on update (2026-05-02)

### What changed

- `src/core/package-manager.ts`: `updateGit()` now runs the package dependency install step even when the fetched git target already matches the local checkout.

### Why

- `senpi update` previously returned early for current git packages. If an extension checkout's `node_modules` was damaged or incomplete, the update command reported success but left runtime imports broken.

### Why extension system couldn't handle this

- Git package update and dependency installation are core package-manager responsibilities that run before extension loading.

### Expected merge conflict zones on next upstream sync

- LOW: `DefaultPackageManager.updateGit()` around the post-fetch current-HEAD branch.

## Model Switch System Prompt Change (2026-04-30)

### What changed

- `src/core/agent-session.ts`: Applies `model_select` system prompt results immediately, emits `system_prompt_change` only when the active prompt string changes, and returns the change from `setModel()` / `cycleModel()`.
- `src/core/extensions/types.ts`: Added typed `system_prompt_change` event and model-select prompt-change result.
- `src/core/extensions/runner.ts`: Added `emitModelSelect()` to collect prompt-change results from `model_select` handlers.
- `src/modes/interactive/interactive-mode.ts`: Includes the changed prompt name in model-switch status messages and shows standalone prompt-change status for extension-driven switches.
- `src/core/extensions/builtin/prompt-preset/index.ts`: Resolves prompt presets during `model_select` so mid-session model changes update the active prompt immediately.

### Why

- The prompt-preset builtin only changed the effective prompt at the next `before_agent_start`. The user requested mid-session model changes to switch the system prompt immediately, emit a `pi.on` event, and show the TUI notice only when the prompt actually changes.

### Why extension system couldn't handle this

- The existing extension event runner ignored `model_select` return values and had no core-owned typed event for active system prompt changes. TUI status also needs core session feedback from `setModel()` / `cycleModel()`.

### Expected merge conflict zones on next upstream sync

- HIGH: `agent-session.ts` around model switching and event emission.
- HIGH: `extensions/types.ts` and `extensions/runner.ts` around model events.
- MEDIUM: `interactive-mode.ts` model status rendering.

### Migration notes

- Keep `system_prompt_change` gated by actual string inequality. Same-preset model switches must not spam the event or TUI.

## Seam 3: Compaction Apply ExtensionContext API (2026-04-27)

### What changed

- `src/core/agent-session.ts`: Added in-memory monotonic message revision counter. Added `getMessageRevision()` and `applyCompaction(precomputed, { reason, expectedRevision })` for compare-and-apply speculative compaction.
- `src/core/agent-session.ts`: Extended `_executeCompaction()` to accept a precomputed `CompactionResult`.
- `src/core/extensions/types.ts`: Added `ApplyCompactionOptions`, `ApplyCompactionResult`, `ExtensionContext.getMessageRevision()`, `ExtensionContext.applyCompaction()`.
- `src/core/extensions/runner.ts`: Wired new context actions through `bindCore()` and `createContext()`.
- `src/modes/interactive/interactive-mode.ts`: Added same methods to inline shortcut `ExtensionContext` literal.

### Why

- Speculative/v2 compaction needs a stable compare-and-apply seam: extensions can prepare a compaction summary against revision N and only apply it if no context-affecting message mutation has happened since.
- `getMessageRevision()` is intentionally monotonic and in-memory only; it is a staleness guard, not persisted session data.
- `applyCompaction()` returns explicit `ok`, `stale`, or `rejected` outcomes so extensions can avoid racing the live session.

### Why extension system couldn't handle this

Extensions can observe hooks and return summaries during a core-driven compaction, but they cannot append a compaction entry, rebuild agent context, emit core compaction events, or atomically guard against stale session context without a typed core API.

### Expected merge conflict zones on next upstream sync

- HIGH: `agent-session.ts` around message revision and `applyCompaction()` implementation.
- HIGH: `extensions/types.ts` and `extensions/runner.ts` around `ExtensionContext`/`ExtensionContextActions` definitions.
- MEDIUM: `interactive-mode.ts` shortcut context literals must retain parity with `ExtensionRunner.createContext()`.

### Migration notes

If upstream adds new `ExtensionContext` methods or changes `AgentSession` message mutation logic, preserve the monotonic revision counter and the `applyCompaction()` compare-and-apply semantics. The revision guard must remain in-memory and advance on every context-affecting mutation. Do not let upstream's `ExtensionContext` additions shadow the new methods.

## Seam 3b: Extension Compaction Feedback Scope (2026-05-15)

### What changed

- `src/core/agent-session.ts`: Added core-owned begin/end helpers for extension-driven compaction feedback and wired them into `ExtensionContext`.
- `src/core/agent-session.ts`: `applyCompaction()` now reuses an already-open compaction abort controller so an extension can show `compaction_start` before it has a precomputed summary without emitting duplicate start events.
- `src/core/extensions/types.ts` and `src/core/extensions/runner.ts`: Added optional `beginCompaction()` and `endCompaction()` context methods.

### Why

- The fork's speculative/blocking compaction extension can spend time generating or awaiting a summary before `applyCompaction()` is called.
- Without a core-owned feedback scope, the TUI has no compaction loader, Esc cancellation signal, or `isCompacting` input queueing during that wait.

### Why extension system couldn't handle this

Extensions can call UI methods, but they cannot set `AgentSession.isCompacting`, own the session abort controller, or emit canonical `compaction_start`/`compaction_end` events without a core context action.

### Expected merge conflict zones on next upstream sync

- HIGH: `agent-session.ts` around `applyCompaction()`, compaction abort controllers, and extension context binding.
- HIGH: `extensions/types.ts` and `extensions/runner.ts` around `ExtensionContext`/`ExtensionContextActions`.

### Migration notes

If upstream adds a native progress or cancellation API for compaction, map the builtin compaction extension to that API while preserving the invariant that visible feedback starts before extension summary generation begins and ends exactly once.

## Seam 4: Unified Compaction Pipeline (2026-04-27)

### What changed

- `src/core/agent-session.ts`: Consolidated manual, threshold, overflow, pre-prompt, and extension-triggered compaction routes into a single private `_executeCompaction()` pipeline.
- The unified pipeline covers: preparation, extension hook execution (`session_before_compact`), summary generation, pre-append token simulation, session append, context rebuild, and completion event emission (`session_compact`).
- Route-specific metadata (reason, custom instructions, thinking/max-token behavior), error handling, retry handling, token estimation before append, and abort handling now flow through one seam.

### Why

- The user identified 9 route inconsistencies caused by duplicated compaction code paths across manual `/compact`, threshold-triggered, overflow-recovery, pre-prompt, and extension-triggered compaction.
- Without unification, each route handled metadata, error recovery, token estimation, and event emission differently, causing observable behavioral differences for extensions consuming compaction events.

### Why extension system couldn't handle this

The duplicated route control flow lives inside `AgentSession`. Extensions can customize compaction content via `session_before_compact` hooks, but they cannot unify internal caller behavior, append semantics, context rebuilds, or core event ordering from outside the session.

### Expected merge conflict zones on next upstream sync

- HIGH: `agent-session.ts` is the highest-churn upstream file. Rebase conflict resolution must preserve the `_executeCompaction()` pipeline and keep branch summarization outside this helper.

### Migration notes

If upstream modifies any compaction route (manual, threshold, overflow, pre-prompt), resolve conflicts by routing the modified logic through `_executeCompaction()` rather than restoring inline duplication. Preserve the 6-route coverage: manual, threshold, overflow-recovery, pre-prompt, extension-triggered, and branch summarization (which routes through the hook but remains a separate caller). Keep the pre-append token simulation step to prevent post-compaction overflow.

## builtin extension labels

- Changed `src/core/extensions/builtin/index.ts` and `src/core/resource-loader.ts` so builtin extensions keep stable synthetic ids like `<builtin:todowrite>` instead of being loaded as numbered inline factories.
- This was changed in core because the startup Extensions list is sourced from extension metadata produced by `DefaultResourceLoader`; the extension API cannot rename builtin factory identities after load.
- Expected merge-conflict zone on upstream sync: builtin extension registration in `src/core/extensions/builtin/index.ts` and builtin factory loading in `src/core/resource-loader.ts`.

## move selected defaults to global extensions

- Changed `src/core/extensions/builtin/index.ts` and `src/core/resource-loader.ts` so `diff`, `files`, `prompt-url-widget`, and `tps` are no longer registered as builtin factories.
- `DefaultResourceLoader` now seeds generated shim files for those four defaults into the real global `agentDir/extensions/` directory, so they load through normal global extension discovery instead of builtin registration.
- `DefaultResourceLoader` now rewrites previously generated shim files when their absolute builtin module paths become stale after the checkout/package directory moves or is renamed.
- This had to be done in core because builtin-vs-global extension ownership is determined during resource bootstrap, before any extension code runs.
- Expected merge-conflict zone on upstream sync: builtin extension registration and early resource bootstrap in `src/core/resource-loader.ts`.

## disable builtin extensions from settings

- Changed `src/core/settings-manager.ts` and `src/core/resource-loader.ts` so `settings.json` can disable selected builtin extensions with `disabledBuiltinExtensions`.
- `DefaultResourceLoader` now skips builtin factories whose ids are listed in settings.
- This had to be done in core because builtin extensions are instantiated during early resource bootstrap, before project extensions can intercept or unregister them.
- Expected merge-conflict zone on upstream sync: settings schema/getters in `src/core/settings-manager.ts` and builtin factory loading in `src/core/resource-loader.ts`.

## steering default mode to all

- Changed `src/core/settings-manager.ts` so `getSteeringMode()` now defaults to `"all"` instead of `"one-at-a-time"` when no explicit setting is present.
- Added `test/settings-manager.test.ts` coverage to lock the new default behavior.
- This was changed in core because the default steering mode is injected into `Agent` during session creation via `SettingsManager`, so an extension cannot change the built-in default before the session runtime is constructed.
- Expected merge-conflict zone on upstream sync: `src/core/settings-manager.ts` default getter behavior.

## builtin openai service tier setting

- Changed `src/core/settings-manager.ts`, `src/core/extensions/builtin/index.ts`, and added `src/core/extensions/builtin/service-tier.ts` so `settings.json` can set `openai.serviceTier` and automatically inject `service_tier` into OpenAI Responses payloads.
- Added test coverage in `test/suite/service-tier-extension.test.ts`, `test/suite/service-tier-settings.test.ts`, and updated builtin extension registration coverage in `test/resource-loader.test.ts`.
- This was changed in core because builtin extension registration and settings schema/getter wiring happen before extension code can discover a new builtin id or read typed settings from the existing settings manager.
- Expected merge-conflict zone on upstream sync: builtin extension registration in `src/core/extensions/builtin/index.ts` and settings schema/getter additions in `src/core/settings-manager.ts`.

## synced builtin extensions and webfetch

- Changed `src/core/extensions/builtin/index.ts`, `src/core/resource-loader.ts`, and `src/core/settings-manager.ts` so builtin extensions can be allowlisted with `enabledBuiltinExtensions` while preserving `disabledBuiltinExtensions` as an override.
- Added `src/core/extensions/builtin/webfetch/` as a builtin extension synced from `../pi-extensions/pi-webfetch`, and moved `bash-timeout` and `openai-api-parallel-tool-calls` to synced `../pi-extensions` layouts.
- Added `scripts/sync-builtin-extensions.mjs`, wired into the package build, so local builds refresh the vendored builtin snapshots from `SENPI_BUILTIN_EXTENSIONS_SOURCE` or `../pi-extensions` when that source checkout exists. `external-versions.json` records the source package names and versions included in the snapshot.
- This had to be done in core because builtin extension registration and builtin settings filtering happen before any user extension can affect resource discovery.
- Expected merge-conflict zone on upstream sync: builtin extension registration in `src/core/extensions/builtin/index.ts`, builtin factory filtering in `src/core/resource-loader.ts`, and settings schema/getters in `src/core/settings-manager.ts`.

## Anthropic "max" thinking level and provider/model extraBody config

- Widened the `"max"` thinking level through the coding agent surface: CLI `--thinking max`, `/settings` selector, Shift+Tab cycle, `settings.json` `defaultThinkingLevel`, thinking border color mapping.
- Extended `packages/coding-agent/src/core/model-registry.ts` so `models.json` (and `pi.registerProvider()`) accepts `extraBody` at both provider and per-model level. `getApiKeyAndHeaders` now resolves `extraBody`, and `sdk.ts` merges provider/model extraBody with any call-site `extraBody` before invoking `streamSimple`.
- This had to be done in core because `ThinkingLevel` is exported from `@mariozechner/pi-agent-core` and every UI/CLI/settings surface needed to be widened, and because `getApiKeyAndHeaders` + stream option composition live in core `ModelRegistry`/`sdk.ts`.
- Expected merge-conflict zone on upstream sync: `model-registry.ts` schemas + `getApiKeyAndHeaders`, `sdk.ts` stream option composition, `cli/args.ts` validator, `settings-manager.ts` thinking level type, `agent-session.ts` thinking cycle list, interactive TUI thinking selector and border color map.
