# changes

## custom entry renderer display order sync (2026-07-02)

### What changed

- `interactive-mode.ts`: accepted upstream rendering for extension custom entry renderers and kept fork-specific
  hook/system-prompt UI behavior.
- `components/custom-entry.ts`: added the display component for custom session entries rendered by extension entry
  renderers.

### Why

- Display-only custom entries appended during assistant streaming must render in persisted session order and before the
  live assistant message, matching replayed sessions.

### Why extension system couldn't handle this

- Extensions provide renderer implementations, but the built-in interactive mode owns session-entry ordering and the
  default component host where persisted custom entries are displayed.

### Expected merge conflict zones

- MEDIUM: `interactive-mode.ts` around session entry rendering, live assistant message ordering, and extension renderer
  dispatch.
- LOW: `components/custom-entry.ts` if upstream changes custom-entry component shape.

## abort queue restoration during retry (2026-06-18)

### What changed

- `interactive-mode.ts`: Escape during streaming or retry now aborts the active operation, clears queued steering/follow-up
  rows, and restores the queued text to the editor instead of auto-submitting it as a fresh prompt.

### Why

- Auto-submitting restored queue text could race the abort barrier and surface `Agent is already processing` after the user
  had already aborted. It also made an aborted retry appear to keep working on queued input.

### Why extension system couldn't handle this

- The default Escape handler and pending-message display are owned by `InteractiveMode`; extensions can request aborts but
  cannot change the built-in queue restoration path.

### Expected merge conflict zones

- HIGH: `interactive-mode.ts` around `abortAndFireQueuedMessages()` and the default Escape handler.

## normal Working animation and packaged TUI runtime (2026-05-20)

### What changed

- `interactive-mode.ts`: the default normal TUI Working indicator uses two visible frames, `•` and `◦`, plus the
  animated `Working (Xs • esc to interrupt)` message formatter.
- `packages/coding-agent/package.json`: the public `@code-yeongyu/senpi` package bundles the private forked
  `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, and `@earendil-works/pi-tui` workspaces.
- `scripts/release.mjs`: release no longer rewrites those dependencies to upstream npm `0.x` packages before publish.

### Why

- The normal TUI looked static after `@code-yeongyu/senpi` installed an upstream `@earendil-works/pi-tui` package whose
  `Loader` ignored `messageFormatter`, so the installed CLI rendered only `• Working`.
- The source tree already had richer Working text animation; the npm tarball must carry the forked TUI runtime that
  implements it.

### Why extension system couldn't handle this

- `InteractiveMode` owns the built-in Working row and the default `LoaderIndicatorOptions`.
- Extensions can override the row, but they cannot repair the packaged runtime dependency used by global npm installs.

### Expected merge conflict zones

- HIGH: `interactive-mode.ts` around `getWorkingIndicatorOptions()`; preserve two default frames plus message formatter.
- HIGH: release/package files around bundled workspace dependencies; do not pin `@earendil-works/pi-*` to upstream npm
  versions for `@code-yeongyu/senpi` publishing.
- MEDIUM: `packages/tui/src/components/loader.ts`; preserve `messageFormatter` and independent message animation.

## live tool hook status rows (2026-05-19)

### What changed

- `interactive-mode.ts`: active `tool_hook_status` events render in a dedicated status lane below the normal Working
  loader, with Codex-like `Running PreToolUse hook: ...` and `Running PostToolUse hook: ...` wording.
- `working-status.ts`: hook rows reuse the existing Working shimmer treatment and append live elapsed time without
  adding an interrupt hint.

### Why

- Extension hooks can perform visible work before and after tool execution. Showing the specific hook and elapsed time
  makes the TUI more informative than a generic Working row.

### Why extension system couldn't handle this

- The built-in interactive renderer owns the live status layout and shimmer styling. Extensions can inject widgets, but
  they cannot reliably render host-managed lifecycle rows beside the existing Working indicator.

### Expected merge conflict zones

- MEDIUM: `interactive-mode.ts` around status containers, Working loader helpers, and `handleEvent()`.
- LOW: `working-status.ts` around the shared shimmer formatting helpers.

## OpenAI remote compaction details (2026-05-15)

### What changed

- `interactive-mode.ts`: synthetic post-compaction summary messages now preserve `CompactionResult.details`.
- `components/compaction-summary-message.ts`: the compact summary card shows when OpenAI remote compaction was used,
  including requested input count, retained item count, original token pressure, and whether the route was Responses
  WebSocket compaction or the compact endpoint.

### Why

- Users need to tell whether a turn used the extension fallback summary route or OpenAI's provider-native compact API.

### Why extension system couldn't handle this

- The visible summary card is built by the interactive renderer, and the synthetic message is created by the built-in
  `compaction_end` event handler.

### Expected merge conflict zones

- LOW: `interactive-mode.ts` around the `compaction_end` handler.
- LOW: `components/compaction-summary-message.ts` around collapsed and expanded summary rendering.

## compaction feedback labels (2026-05-15)

### What changed

- `interactive-mode.ts`: `compaction_start` now renders clearer loader text for extension and pre-prompt compaction instead of labeling every non-manual route as auto-compaction.

### Why

- The fork's builtin compaction extension can run a blocking summary before the next turn. Once that route emits canonical compaction events, the TUI should say it is compacting context rather than implying an automatic threshold compaction.

### Why extension system couldn't handle this

- The loader label is produced by the built-in `InteractiveMode` handler for core session events.

### Expected merge conflict zones

- LOW: `interactive-mode.ts` around the `compaction_start` event handler.

## compact provider-native web search rendering (2026-05-14)

### What changed

- `components/assistant-message.ts`: provider-native web-search blocks render through the shared formatter in `../provider-native-rendering.ts` instead of dumping raw provider JSON.
- Recognized Anthropic, OpenAI, and Google native web-search metadata now show compact query/status/source summaries while unknown provider-native blocks keep the generic JSON fallback.

### Why

- The raw provider-native JSON exposed implementation fields such as `encrypted_content` and made native web search blocks visually inconsistent with normal tool widgets.

### Why extension system couldn't handle this

- Provider-native assistant content is rendered by the built-in assistant message component before extension tool renderers are involved.

### Expected merge conflict zones

- LOW: the provider-native branch in `components/assistant-message.ts` and shared formatting behavior in `../provider-native-rendering.ts`.

## Slash command path tilde expansion (2026-05-13)

### What changed

- `interactive-mode.ts`: `/export ~/...` and `/import ~/...` expand leading `~` to the user's home directory before invoking session import/export.

### Why

- Built-in slash commands previously treated `~` as a literal path segment, which could create or read files under `./~/...`.

### Why extension system couldn't handle this

- Slash-command path parsing is internal to `InteractiveMode`; extensions cannot normalize the built-in command argument after parsing.

### Expected merge conflict zones

- LOW: `getPathCommandArgument()` in `interactive-mode.ts`.

## bash execution command syntax highlighting

- Changed `src/modes/interactive/components/bash-execution.ts` so the command header for interactive/user shell execution highlights bash syntax with the existing TUI syntax palette instead of coloring the whole command as a single bash-mode string.
- This was changed in core UI because the live bash execution component owns the command header render path; extensions cannot intercept that component without replacing the built-in interactive renderer.
- Expected merge-conflict zone on upstream sync: the `BashExecutionComponent` command header setup and `updateDisplay()` rebuild path.

## non-blocking startup tool discovery

- Changed `src/modes/interactive/interactive-mode.ts` so interactive startup only probes an already-installed `fd` path for autocomplete instead of awaiting `fd`/`rg` downloads before showing the UI.
- Added `src/modes/interactive/startup-tools.ts` to keep the startup-only tool resolution behavior small and directly testable.
- This was changed in core UI because the blocking call happens inside `InteractiveMode.init()` before extension startup hooks can run, so a builtin extension cannot prevent the first-launch wait.
- Expected merge-conflict zone on upstream sync: tool setup in `InteractiveMode.init()` near the startup changelog/header initialization.

## favorite model cycling

- Changed `src/modes/interactive/interactive-mode.ts` so Ctrl+P reports missing favorite models instead of cycling through every available model, and `/favorite-models` saves selections to the new `favoriteModels` settings field.
- Changed `src/modes/interactive/components/model-selector.ts` and `favorite-models-selector.ts` so favorite rows can also select the active model, while `Ctrl+F` toggles the selected row's favorite state from either `/model` or `/favorite-models`; `/model` toggles persist immediately because that selector has no separate save command.
- This was changed in core UI because the built-in status text and favorite-model selector wiring are internal `InteractiveMode` behavior; extensions cannot replace the default Ctrl+P command semantics without racing the built-in binding.
- Expected merge-conflict zone on upstream sync: model cycling status, `/model` favorite toggle wiring, and `/favorite-models` selector wiring in `src/modes/interactive/interactive-mode.ts` plus the two model selector components.

## builtin extension display paths

- Changed `src/modes/interactive/interactive-mode.ts` so synthetic builtin extension ids render as `builtin/<name>` in the startup Extensions section.
- Changed `src/modes/interactive/interactive-mode.ts` so builtin extensions render in their own `builtin` group and `todowrite` is labeled as `todo` in the startup Extensions section.
- This was changed in core UI because the display formatting lives in `InteractiveMode.formatDisplayPath()`; the extension system cannot intercept that built-in startup formatter.
- Expected merge-conflict zone on upstream sync: `showLoadedResources()` helpers in `src/modes/interactive/interactive-mode.ts`.

## disable startup update checks

- Changed `src/modes/interactive/interactive-mode.ts` so startup no longer checks upstream npm registry version/package updates before entering the interactive loop.
- This was changed in core UI because those startup checks are internal `InteractiveMode` methods and there is no extension hook that can reliably suppress them before they run.
- Expected merge-conflict zone on upstream sync: startup helpers around `checkForNewVersion()` and `checkForPackageUpdates()` in `src/modes/interactive/interactive-mode.ts`.
