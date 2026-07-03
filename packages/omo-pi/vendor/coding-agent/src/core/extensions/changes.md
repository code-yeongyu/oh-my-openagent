# Core Extensions Changes

## 2026-07-02 - Extension entry renderer sync

### What changed

- `types.ts`, `runner.ts`, `loader.ts`, and `index.ts`: accepted upstream extension entry-renderer support for persisted
  display-only session entries.
- `agent-session.ts` and interactive rendering now use those renderers so custom entries can render in persisted order
  without being sent back to the model context.

### Why

- Extensions need a typed way to render custom session entries that are display-only, survive persistence, and do not
  mutate the model transcript.

### Why extension system couldn't handle this alone

- This is an extension-system API addition: the runner, loader, exported types, session dispatch, and interactive renderer
  all need matching core support before an extension can provide an entry renderer.

### Expected merge conflict zones

- MEDIUM: `types.ts` around extension API and entry renderer type definitions.
- MEDIUM: `runner.ts` and `loader.ts` around renderer registration/loading.
- LOW: `index.ts` exports if upstream changes extension type re-exports.

## 2026-06-29 - Builtin hooks extension runtime resource plumbing

### What changed

- Added builtin extension id `hooks` before `permission-system` so builtin command hooks can inspect tool calls before permission prompts.
- Added `ResourcesDiscoverResult.hookPaths`, `ResourceExtensionPaths.hookPaths`, `DefaultResourceLoader.getLoadedHookSources()`, and `ExtensionContext.getLoadedHookSources()` for hook config source injection.
- `ExtensionRunner.emitResourcesDiscover()` now collects hook paths, and `AgentSession.extendResourcesFromExtensions()` passes them to the resource loader as runtime hook sources.
- `builtin/hooks/index.ts` now loads settings/default files, pre-session hook paths, and runtime hook paths lazily; malformed hook sources become diagnostics instead of startup failures.
- Registered `/hooks` for command-output diagnostics and basic loaded-hook status.

### Semantics

- Initial `SessionStart` only sees pre-session sources: settings/default hook files and `DefaultResourceLoaderOptions.additionalHookPaths`.
- Runtime `hookPaths` returned from `resources_discover` are late sources. They are visible to later hook events in the current runtime and to reload/next-session `SessionStart`, where `SessionStart` hooks from runtime sources emit the existing caveat diagnostic.
- Malformed user/runtime hook JSON is nonfatal. Managed or builtin hook safety invariant failures remain hard failures at the dispatch layer rather than being trusted silently.

### Expected merge conflict zones

- MEDIUM: `types.ts` public API additions around `ExtensionContext`, `ResourcesDiscoverResult`, and `ExtensionContextActions`.
- MEDIUM: `runner.ts` resource discovery aggregation and context construction.
- MEDIUM: `resource-loader.ts` extension resource plumbing.
- LOW: `agent-session.ts` `extendResourcesFromExtensions()` resource handoff.
- LOW: `builtin/index.ts` registration order near `permission-system`.

## 2026-06-15 - Remove kimi-web-search builtin; fold Kimi search into pi-websearch

### What changed

- Removed `builtin/kimi-web-search/` and its registration in `builtin/index.ts`. The `kimi_search_web` / `kimi_fetch_url` tools no longer exist.
- Kimi search is now a `pi-websearch` provider (`kimi`, vendored at 0.2.0). On a `kimi-coding` model the native auto-route prepends a `kimi` entry (api.kimi.com/coding/v1/search) using the model API key, so `web_search` works zero-config and falls back to the configured chain. URL fetching is handled by the `webfetch` builtin.
- `test/suite/regressions/3592-...test.ts`: dropped `kimi_search_web` / `kimi_fetch_url` from the tool-list expectations.

### Why

- One web-search surface instead of two. Kimi's coding search fits pi-websearch's provider + native-route architecture, so the standalone builtin was redundant.

### Expected merge conflict zones

- LOW: `builtin/index.ts` registration array; `builtin/websearch/` vendored sources (re-vendor from `../pi-extensions/pi-websearch`).

## 2026-05-15 - OpenAI native web search endpoint compatibility

### What changed

- `builtin/openai-web-search/index.ts`: The extension now passes the full selected model into OpenAI native web search handling and only injects `web_search_preview` for Azure Responses, official `api.openai.com` OpenAI Responses, or custom Responses models with `compat.supportsWebSearchPreview: true`.
- Custom OpenAI Responses endpoints now strip OpenAI native `web_search_preview` / `web_search_preview_*`, matching `tool_choice`, and `web_search_call.action.sources` includes by default while preserving ordinary function tools such as a configurable `web_search`.
- `model-registry.ts`: Added `compat.supportsWebSearchPreview` to the models.json schema so users can opt custom OpenAI-compatible providers into native web search support.
- `test/suite/openai-web-search-extension.test.ts`: Added regression coverage for default custom-endpoint stripping and explicit opt-in preservation.

### Why

- The failing GPT-5.5 session used an `openai-responses` model pointed at a custom proxy endpoint. The old extension keyed only on `api`, injected OpenAI-native `web_search_preview`, and the downstream endpoint rejected the tool schema. Matching the `../ai` and `../opencode` pattern means provider-native tools are only sent when the endpoint explicitly supports that provider's native tool dialect.

### Why extension system couldn't handle this alone

- The extension can prevent its own automatic injection, but the selected model's endpoint capability is the real decision point. The companion `pi-ai` provider guard still handles later hook mutations after this extension runs.

### Expected merge conflict zones

- LOW: `builtin/openai-web-search/index.ts` around `addOpenAiWebSearchToPayload()` and `before_agent_start`.
- LOW: `model-registry.ts` provider compat schema if upstream adds more Responses compatibility fields.

## 2026-05-15 - OpenAI native web_search_preview strip for non-OpenAI-Responses payloads

### What changed

- `builtin/openai-web-search/index.ts`: When `ctx.model.api` is not an OpenAI Responses variant, the extension now also scans `payload.tools` for OpenAI native `web_search_preview` / `web_search_preview_*` entries and strips them before the request leaves senpi. The OpenAI Responses path (inject + Anthropic-tool sanitize) is unchanged.
- `test/suite/openai-web-search-extension.test.ts`: Added regression coverage for stripping `web_search_preview`, the versioned `web_search_preview_2025_03_11` variant, the `openai-completions` case, the disabled-via-env case, and a no-op assertion guaranteeing Anthropic-native `web_search_*` / `web_fetch_*` entries are left intact on anthropic-messages payloads.

### Why

- Anthropic rejects requests whose `tools[]` contains `type: "web_search_preview"` with `tools.N: Input tag 'web_search_preview' found using 'type' does not match any of the expected tags`. The leak shows up for users whose `openai` provider is wired to a proxy that translates `openai-responses` → `anthropic-messages` (e.g., ccapi / quotio when routing claude-* models) and forwards `web_search_preview` verbatim. Defense-in-depth stripping ensures senpi never lets the OpenAI-only tool reach Anthropic-format backends regardless of how it ended up in the payload.

### Why extension system couldn't handle this alone

- The fix is entirely inside the existing `openai-web-search` builtin extension via `before_provider_request`. No core or pi-ai change required.

### Expected merge conflict zones

- LOW: `builtin/openai-web-search/index.ts` early-return branch in `addOpenAiWebSearchToPayload` if upstream restructures the non-OpenAI-Responses fall-through path.

## 2026-05-15 - OpenAI Chat Completions Tool Pair Guard

### What changed

- `builtin/tool-pair-guard/index.ts`: Extended the provider request guard to run an OpenAI Chat Completions payload sanitizer after the Anthropic and OpenAI Responses sanitizers.
- `builtin/tool-pair-guard/sanitize-openai-chat-completions-payload.ts`: Added Chat Completions request message repair that drops orphan or duplicate `role: "tool"` messages and inserts synthetic `role: "tool"` results for interrupted assistant `tool_calls`.
- `test/tool-pair-guard/sanitize-openai-chat-completions-payload.test.ts`: Added regression coverage for valid-pair no-op behavior, orphan output removal, duplicate output removal, and missing output synthesis before transcript advance or payload end.

### Why

- OpenAI-compatible Chat Completions providers reject `role: "tool"` messages whose `tool_call_id` has no preceding assistant `tool_calls` entry. Persisted or compacted sessions with stale tool outputs can otherwise keep replaying the same invalid payload and fail with HTTP 400.

### Why extension system couldn't handle this alone

- The fix does use the extension system: `tool-pair-guard` is a builtin extension that repairs provider payloads through `before_provider_request`. No core provider or agent loop change was required.

### Expected merge conflict zones

- LOW: `builtin/tool-pair-guard/index.ts` if upstream changes provider-request hook wiring.
- LOW: `builtin/tool-pair-guard/sanitize-openai-chat-completions-payload.ts` if upstream adds an equivalent Chat Completions pairing normalizer.

## 2026-05-15 - OpenAI Responses Tool Pair Guard

### What changed

- `builtin/tool-pair-guard/index.ts`: Extended the existing provider request guard to run both Anthropic and OpenAI Responses payload sanitizers.
- `builtin/tool-pair-guard/sanitize-openai-responses-payload.ts`: Added OpenAI Responses request input repair that drops orphan `function_call_output` / `custom_tool_call_output` items and inserts synthetic outputs for interrupted calls that have no result.
- `test/tool-pair-guard/sanitize-openai-responses-payload.test.ts`: Added regression coverage for orphan output removal, missing output synthesis, valid-pair no-op behavior, and `previous_response_id` delta preservation.

### Why

- OpenAI Responses rejects requests with `No tool call found for function call output with call_id ...` when a stale tool output survives without its matching call. Once such history is persisted, follow-up prompts can repeatedly send the same invalid output and leave the session stuck.

### Why extension system couldn't handle this alone

- The fix does use the extension system: `tool-pair-guard` is a builtin extension that repairs provider payloads through `before_provider_request`. No core provider or agent loop change was required.

### Expected merge conflict zones

- LOW: `builtin/tool-pair-guard/index.ts` if upstream changes provider-request hook wiring.
- LOW: `builtin/tool-pair-guard/sanitize-openai-responses-payload.ts` if upstream adds an equivalent OpenAI Responses pairing normalizer.

## 2026-05-15 - Normalize remaining senpi internal names

### What changed

- `builtin/system-messages.ts`: Renamed the exported conversation constants, event type names, and helper function names to the `SENPI_*` / `Senpi*` spelling, and changed the emitted conversation event name to `senpi:conversation`.
- `builtin/todotools/system-messages.ts`: Applied the same event-name and constant-name cleanup to the vendored todotools helper.
- `builtin/todotools/state.ts`: Changed the todo state custom entry type to `senpi.todo-state`.
- `test/suite/senpi-conversation.test.ts`: Renamed the regression test file and assertions to match the senpi runtime naming.

### Why

- The fork identity is `senpi`, and the remaining internal directive/event/state/env names should carry the same identity instead of preserving an earlier spelling.

### Why extension system couldn't handle this alone

- These names are builtin extension wire constants and session custom-entry identifiers. They must be emitted correctly by the bundled implementation before user or external extensions can observe them.

### Expected merge conflict zones

- LOW: `builtin/system-messages.ts`, `builtin/todotools/system-messages.ts`, and `builtin/todotools/state.ts` if upstream or vendored builtins rename these helper surfaces.
## 2026-05-14 - Add kimi-web-search builtin extension

### What changed

- Added `builtin/kimi-web-search/index.ts`: New builtin extension that registers `SearchWeb` and `FetchURL` tools for Kimi Code platform.
- Registers tools via `pi.registerTool()` (not provider-native injection like anthropic-web-search/openai-web-search).
- Calls Kimi Code service endpoints:
  - Search: `POST https://api.kimi.com/coding/v1/search` with `{text_query, limit, enable_page_crawling, timeout_seconds}`
  - Fetch: `POST https://api.kimi.com/coding/v1/fetch` with `{url}`
- Passes `Authorization: Bearer <api_key>` and `X-Msh-Tool-Call-Id` headers matching Kimi CLI behavior.
- Fallback to local HTTP fetch when Kimi fetch service returns error.
- Configurable via env vars: `PI_KIMI_WEB_SEARCH`, `PI_KIMI_SEARCH_BASE_URL`, `PI_KIMI_FETCH_BASE_URL`.
- Registered in `builtin/index.ts` as builtin extension id `kimi-web-search`.

### Why

- Kimi Code platform provides official SearchWeb/FetchURL services (`moonshot_search`/`moonshot_fetch`), but senpi had no integration.
- The existing `anthropic-web-search` extension incorrectly injected Anthropic-native `web_search_20250305` into kimi-coding requests (because both use `api: "anthropic-messages"`), which Kimi API does not support.

### Why extension system couldn't handle this alone

- While this *could* be a user extension, it requires deep integration with:
  - `ctx.modelRegistry.getApiKeyAndHeaders()` for auth resolution
  - Knowledge of Kimi Code service URL conventions
  - Proper `X-Msh-Tool-Call-Id` header passing
- As a builtin, it stays consistent with anthropic-web-search/openai-web-search and can be maintained alongside provider updates.

### Expected merge conflict zones

- LOW: `builtin/index.ts` extension registration list.
- LOW: `builtin/kimi-web-search/index.ts` if Kimi Code service API changes.

## 2026-05-14 - Native Web Tool UI Cleanup Hooks

### What changed

- `builtin/anthropic-web-search/index.ts`: Added session/model UI cleanup for Anthropic native `web_search` so older startup widgets are cleared.
- `builtin/openai-web-search/index.ts`: Added session/model UI cleanup for OpenAI Responses native `web_search_preview` so older startup widgets are cleared.
- `test/suite/anthropic-web-search-extension.test.ts` and `test/suite/openai-web-search-extension.test.ts`: Added regression coverage that native web tool extensions do not leave startup/footer widgets behind.

### Why

- Native provider web search is injected below the function-tool layer, but always-on footer widgets for that availability are too noisy. The UI should stay quiet until an actual tool execution or provider response needs rendering.

### Why extension system couldn't handle this alone

- These are already builtin extensions responsible for native provider payload mutation; the useful UI state belongs beside that injection logic.

### Expected merge conflict zones

- LOW: `builtin/anthropic-web-search/index.ts` and `builtin/openai-web-search/index.ts` if native web tool payload handling changes upstream.

## 2026-05-13 - Rename injected system prefix to senpi

### What changed

- `builtin/system-messages.ts`: Changed the injected builtin system-message prefix to `[system:senpi]`.
- `builtin/todotools/system-messages.ts`: Applied the same prefix change to the vendored todotools helper.
- `test/suite/senpi-conversation.test.ts`: Added regression coverage that both helpers emit the `senpi` marker.

### Why

- The runtime identity is `senpi`, so internally injected reminder/follow-up messages should use the matching `[system:senpi]` marker.

### Why extension system couldn't handle this alone

- The marker is emitted by bundled helper modules used by builtin extensions before handing messages to the agent runtime.

### Expected merge conflict zones

- LOW: `builtin/system-messages.ts` and `builtin/todotools/system-messages.ts` if the helper modules are renamed or consolidated.

## 2026-05-12 - Externalize todotools vendored builtin source

### What changed

- Added `pi-todotools` to the vendored builtin sync manifest and `sync-builtin-extensions.mjs` mapping.
- Refreshed `builtin/todotools/` from the standalone `../pi-extensions/pi-todotools` source while preserving the `todowrite` builtin id and tool names.
- Added local `todotools/settings.ts` and `todotools/system-messages.ts` helpers so the extracted extension uses only public package APIs externally.
- Updated sync coverage to pin the `pi-todotools` package version.

### Why

- Todo tools are now maintained as a public sibling extension like other vendored builtins, while senpi continues shipping the feature in the binary.

### Why extension system couldn't handle this alone

- senpi's builtin list is assembled by core resource loading; shipping a sibling extension as a builtin still requires vendored source and the builtin sync manifest.

### Expected merge conflict zones

- `builtin/todotools/` if upstream adds its own todo tooling.
- `builtin/external-versions.json` and `scripts/sync-builtin-extensions.mjs` if more vendored packages are added.

## 2026-05-11 - GPT apply_patch Realtime Progress Rendering

### What changed

- `builtin/gpt-apply-patch/types.ts`: Added progress metadata for partial apply_patch updates.
- `builtin/gpt-apply-patch/apply.ts`: Added an optional progress callback emitted after each patch operation.
- `builtin/gpt-apply-patch/preview.ts` and `tool.ts`: Render pending updates as `Applying patch (done/total)` while preserving rich diff previews.
- `test/suite/gpt-apply-patch-extension.test.ts` and `gpt-apply-patch-rich-render.test.ts`: Added regression coverage for realtime progress updates and pending widget titles.

### Why

- Multi-file apply_patch calls previously showed a single pending diff preview and did not update the TUI as individual operations completed.

### Why extension system couldn't handle this alone

- `gpt-apply-patch` is already the builtin extension; progress has to be emitted from its apply loop and rendered by its tool result renderer.

### Files modified

- `builtin/gpt-apply-patch/types.ts`
- `builtin/gpt-apply-patch/apply.ts`
- `builtin/gpt-apply-patch/preview.ts`
- `builtin/gpt-apply-patch/tool.ts`
- `builtin/gpt-apply-patch/index.ts`
- `../../test/suite/gpt-apply-patch-extension.test.ts`
- `../../test/suite/gpt-apply-patch-rich-render.test.ts`

### Expected merge conflict zones on next upstream sync

- LOW: `builtin/gpt-apply-patch/apply.ts` apply loop callback wiring.
- LOW: `builtin/gpt-apply-patch/tool.ts` pending update render title.

## 2026-05-11 - GPT apply_patch OpenCode-style Diff Rendering

### What changed

- `builtin/gpt-apply-patch/preview-format.ts`: Reworked expanded patch previews to render OpenCode-like diff rows with colored signs, muted line numbers, added/removed row backgrounds, syntax highlighting when a TUI theme is available, and inverse inline word highlights for paired edits.
- `builtin/gpt-apply-patch/types.ts`: Added `toolErrorBg` to the local theme background type used by apply_patch row rendering.
- `test/suite/gpt-apply-patch-rich-render.test.ts`: Added regression coverage for row background colors and inline added/removed highlights.
- `builtin/external-versions.json`: Bumped the vendored `pi-apply-patch` snapshot metadata to `0.1.1`.

### Why

- The previous rich preview only colored whole `+` / `-` lines and did not match OpenCode's edit/apply_patch diff visual hierarchy closely enough.

### Why extension system couldn't handle this alone

- `gpt-apply-patch` is already the builtin extension; the change is inside its own TUI render path.

### Files modified

- `builtin/gpt-apply-patch/preview-format.ts`
- `builtin/gpt-apply-patch/types.ts`
- `builtin/gpt-apply-patch/index.ts`
- `builtin/external-versions.json`
- `../../test/suite/gpt-apply-patch-rich-render.test.ts`

### Expected merge conflict zones on next upstream sync

- LOW: `builtin/gpt-apply-patch/preview-format.ts` render helpers.
- LOW: `builtin/gpt-apply-patch/types.ts` local theme background union.

## 2026-05-11 - GPT apply_patch External Path Support

### What changed

- `builtin/gpt-apply-patch/workspace.ts`: Removed workspace-boundary and realpath validation from path resolution.
- `builtin/gpt-apply-patch/apply.ts` and `preview.ts`: Resolve patch paths with Node `path.resolve(cwd, filePath)` and allow absolute, parent-escaping, and symlink-escaping targets.
- `test/suite/gpt-apply-patch-backport.test.ts`: Added regression coverage for absolute paths outside the current workspace and symlink paths resolving outside it.

### Why

- Codex-style patch payloads can legitimately target files outside the session cwd, for example adjacent worktrees or debug journals. The previous guard rejected those paths with `File references must stay within the current workspace.`

### Why extension system couldn't handle this alone

- `gpt-apply-patch` is a builtin extension and the path policy lives inside its vendored implementation.

### Files modified

- `builtin/gpt-apply-patch/workspace.ts`
- `builtin/gpt-apply-patch/apply.ts`
- `builtin/gpt-apply-patch/preview.ts`
- `../../test/suite/gpt-apply-patch-backport.test.ts`

### Expected merge conflict zones on next upstream sync

- LOW: `builtin/gpt-apply-patch/workspace.ts` path resolution helpers.
- LOW: `builtin/gpt-apply-patch/apply.ts` and `preview.ts` imports/call sites for the path resolver.

## 2026-05-08 - Generated Default Extension Factory Resolver

### What changed

- `loader.ts`: `loadExtensions()` now accepts an optional factory resolver and creates the jiti importer lazily only when an extension path is not resolved to a known factory.
- `builtin/index.ts`: Exposes a keyed map for the four global default extension factories used by generated shims.

### Why

- The default global extension shim files are deterministic. Letting core resolve those shims to known factories avoids the jiti import path without changing extension order, source paths, or behavior for custom extension files.

### Why extension system couldn't handle this alone

- Extension loading is core infrastructure; extensions cannot intercept the module importer before their factories have been loaded.

### Files modified

- `loader.ts`
- `builtin/index.ts`

### Expected merge conflict zones on next upstream sync

- MEDIUM: `loader.ts` around `loadExtension()` and `loadExtensions()` signatures/importer construction.
- LOW: `builtin/index.ts` around global default extension registration.

## 2026-05-08 - Shared Jiti Extension Importer

### What changed

- `loader.ts`: Reuses one `jiti` importer across each `loadExtensions()` batch while keeping `moduleCache: false` for reload freshness.
- `loader.ts`: Aliases upstream `@mariozechner/pi-*` peer imports to the already-loaded senpi workspace packages.

### Why

- Startup was spending several seconds creating a fresh `jiti` instance for every configured extension, causing repeated TypeScript/dependency resolution work before the first TUI frame.
- Installed pi extensions still import upstream `@mariozechner/pi-coding-agent`, `pi-ai`, and `pi-tui` peer names. Without aliases, jiti can fall through to each extension's own `node_modules` and load a duplicate pi runtime.

### Why extension system couldn't handle this alone

- Extension loading is core infrastructure; extensions cannot change how the core loader imports extension modules.

### Files modified

- `loader.ts`

### Expected merge conflict zones on next upstream sync

- MEDIUM: `loader.ts` around `loadExtensionModule()`, `loadExtension()`, and `loadExtensions()` importer construction.

## 2026-04-30 - Model Switch System Prompt Change Event

### What changed

- `types.ts`: Added `ModelSelectEventResult` and `SystemPromptChangeEvent`, plus `pi.on("system_prompt_change", ...)` typing.
- `runner.ts`: Added `emitModelSelect()` so `model_select` handlers can request an active system prompt replacement.
- `builtin/prompt-preset/index.ts`: Returns the resolved prompt preset during `model_select`, including fallback reset when no preset applies.

### Why

- Prompt presets previously updated the system prompt only at `before_agent_start`, so a mid-session model switch did not immediately update the active prompt or expose a typed event for observers.

### Why extension system couldn't handle this alone

- Extensions could listen to `model_select`, but the runner ignored handler return values and there was no typed `pi.on` event for the resulting system prompt change.

### Files modified

- `types.ts`
- `runner.ts`
- `builtin/prompt-preset/index.ts`

### Expected merge conflict zones on next upstream sync

- HIGH: `types.ts` around model/agent event unions and `ExtensionAPI.on` overloads.
- HIGH: `runner.ts` around event emission helpers.

### Migration notes

- Preserve the invariant that `system_prompt_change` fires only after the active prompt string actually changes.

## 2026-04-28 - Compaction Settings Context API

### What changed

- `types.ts`: Added `ExtensionContext.getCompactionSettings()` and matching `ExtensionContextActions.getCompactionSettings`.
- `runner.ts`: Wired the new context action through `bindCore()` and `createContext()`.
- `agent-session.ts`: Bound the context action to `settingsManager.getCompactionSettings()`.
- `interactive-mode.ts`: Added the same method to inline shortcut `ExtensionContext` construction.

### Why

- The builtin compaction extension previously used `DEFAULT_COMPACTION_SETTINGS`, which bypassed user/project settings such as `compaction.enabled: false`.
- Plugsuit-style threshold realignment needs resolved settings for speculative toggles, cooldowns, keep-recent caps, and restoration budgets.

### Why extension system couldn't handle this alone

- Extensions receive `ExtensionContext`, not the core `SettingsManager`; without a typed context method, builtin extensions cannot read the already-merged global/project/user compaction settings.

### Files modified

- `types.ts`
- `runner.ts`
- `agent-session.ts`
- `interactive-mode.ts`

### Expected merge conflict zones on next upstream sync

- HIGH: `types.ts` and `runner.ts` around `ExtensionContext`/`ExtensionContextActions` definitions and context construction.
- HIGH: `interactive-mode.ts` shortcut context literals must retain parity with `ExtensionRunner.createContext()`.

### Migration notes

- If upstream adds settings access to `ExtensionContext`, keep this method or map the builtin compaction extension to the upstream equivalent. The required invariant is that compaction policy uses resolved settings, never hardcoded defaults.

## 2026-04-27 - Seam 3: Compaction Apply Context API

### What changed

- `types.ts`: Added `ApplyCompactionOptions`, `ApplyCompactionResult`, `ExtensionContext.getMessageRevision()`, and `ExtensionContext.applyCompaction()`.
- `runner.ts`: Wired the new context actions through `bindCore()` and `createContext()` so extensions can read the current message revision and apply a precomputed compaction result.
- `interactive-mode.ts`: Added the same methods to the inline shortcut `ExtensionContext` literal.

### Why

- Speculative/v2 compaction needs a stable compare-and-apply seam: extensions can prepare a compaction summary against revision N and only apply it if no context-affecting message mutation has happened since.
- `getMessageRevision()` is intentionally monotonic and in-memory only; it is a staleness guard, not persisted session data.
- `applyCompaction()` returns explicit `ok`, `stale`, or `rejected` outcomes so extensions can avoid racing the live session.

### Why extension system couldn't handle this alone

Extensions can observe hooks and return summaries during a core-driven compaction, but they cannot append a compaction entry, rebuild agent context, emit core compaction events, or atomically guard against stale session context without a typed core API.

### Files modified

- `types.ts`
- `runner.ts`
- `interactive-mode.ts`
- `agent-session.ts`

### Expected merge conflict zones on next upstream sync

- HIGH: `types.ts` and `runner.ts` around `ExtensionContext`/`ExtensionContextActions` definitions and context construction.
- HIGH: `interactive-mode.ts` shortcut context literals must retain parity with `ExtensionRunner.createContext()`.

### Migration notes

If upstream adds new `ExtensionContext` methods or changes `AgentSession` message mutation logic, preserve the monotonic revision counter and the `applyCompaction()` compare-and-apply semantics. The revision guard must remain in-memory and advance on every context-affecting mutation. Do not let upstream's `ExtensionContext` additions shadow the new methods.

## 2026-05-15 - Compaction Feedback Context API

### What changed

- `types.ts`: Added optional `ExtensionContext.beginCompaction()` and `ExtensionContext.endCompaction()` methods.
- `runner.ts`: Wired the new optional context actions through `bindCore()` and `createContext()`.
- `agent-session.ts`: Supplies the context actions with the same abort controller and canonical compaction events used by core compaction routes.

### Why

- Builtin speculative compaction can generate or await a summary before it calls `applyCompaction()`.
- That wait must still surface as a normal compaction to TUI/RPC consumers so loaders, cancellation, and input queueing work while the summary is in flight.

### Why extension system couldn't handle this alone

UI notifications alone cannot update `AgentSession.isCompacting`, participate in `abortCompaction()`, or emit the canonical compaction event pair.

### Files modified

- `types.ts`
- `runner.ts`
- `agent-session.ts`
- `builtin/compaction/index.ts`
- `modes/interactive/interactive-mode.ts`

### Expected merge conflict zones on next upstream sync

- HIGH: `types.ts` and `runner.ts` around `ExtensionContext`/`ExtensionContextActions` definitions and context construction.
- HIGH: `agent-session.ts` around compaction abort-controller ownership and `applyCompaction()` event emission.

### Migration notes

Keep `beginCompaction()`/`endCompaction()` optional for third-party context mocks, but preserve runner support so builtin extensions receive the real core-backed implementation.

## 2026-04-27 - Seam 1: Compaction Event Metadata

### What changed

- `types.ts` line ~85: Added `CompactionReason` and `CompactionRejectionCause` exported literal-union aliases.
- `types.ts` lines ~541-554: Added `reason`, `willRetry`, and `requestId` metadata to `SessionBeforeCompactEvent`.
- `types.ts` lines ~549-554: Added `reason`, `requestId`, `accepted`, and optional `rejectionCause` metadata to `SessionCompactEvent`.
- `agent-session.ts` lines ~1651, ~1713, ~1910, and ~1986: Populated the 4 existing compaction event construction sites with the new required metadata fields. T15 will refactor these construction sites into the unified `_executeCompaction()` pipeline. T13 only populates the new required fields with minimal correct values to keep tsgo passing.

### Why

- Extensions cannot safely apply route-specific policies such as cooldown scope or circuit-breaker counters without knowing the compaction source.
- The user explicitly required consistency across the 6 compaction routes; this metadata is the prerequisite.
- `reason` always preserves the route source, while `rejectionCause` explains why a compaction was rejected when `accepted` is false.

### Why extension system couldn't handle this alone

Event payloads are core-defined types. Extensions can consume compaction events, but they cannot add typed fields to those events from outside the core extension API.

### Files modified

- `types.ts`
- `agent-session.ts`

### Expected merge conflict zones on next upstream sync

- HIGH: `types.ts` is high-churn upstream, especially around extension event definitions. Resolution: preserve additive compaction metadata and keep `reason` semantically separate from `rejectionCause`.

### Migration notes

If upstream modifies compaction event definitions in `types.ts`, preserve the additive metadata fields (`reason`, `willRetry`, `requestId`, `accepted`, `rejectionCause`) and keep them semantically separate from upstream's existing fields. Update the 4 event construction sites in `agent-session.ts` to populate the new fields with the correct route-specific values.

## 2026-04-13 - GPT apply_patch builtin support

### What changed and why

- Added builtin `gpt-apply-patch` extension support so OpenAI GPT sessions can swap `write`/`edit` for a Codex-style `apply_patch` tool and react to mid-session model changes.
- Extended extension/tool plumbing to carry OpenAI Responses freeform grammar metadata. This core change was necessary because the existing extension API only modeled JSON-schema function tools, which made exact Codex GPT `apply_patch` parity impossible from an extension alone.

### Files modified

- `types.ts`
- `builtin/index.ts`
- `builtin/gpt-apply-patch/index.ts` (vendored from `pi-apply-patch`)

### Why the extension system couldn't handle this alone

- `ToolDefinition` had no way to express freeform grammar tools, only JSON-schema parameters.
- Wrapper plumbing dropped any provider-specific tool metadata before requests reached `pi-ai`.

### Expected merge conflict zones

- `types.ts` around `ToolDefinition`
- `builtin/index.ts` builtin registration ordering
