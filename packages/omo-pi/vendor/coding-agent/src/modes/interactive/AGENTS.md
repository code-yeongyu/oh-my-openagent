# packages/coding-agent/src/modes/interactive

The TUI mode. `interactive-mode.ts` is the orchestrator; `components/` holds the 37 in-tree TUI modules. Most fork-modified UI changes live here.

## STRUCTURE

```
interactive/
├── interactive-mode.ts          # InteractiveMode class — startup, key dispatch, status, command bar
├── startup-tools.ts             # fd/rg presence probe (non-blocking startup; fork-introduced)
├── working-status.ts            # Working row text frames (shimmer animation, active-tool label)
├── session-info-format.ts       # formatSessionInfo() — session name/cost/token stats text
├── theme/                       # JSON theme files (copied to dist/theme/ on build)
├── assets/                      # PNG splash/branding (copied to dist/assets/ on build)
├── components/                  # 37 modules — see below
└── changes.md                   # Fork-tracked: non-blocking tool discovery, favorite-model cycling, builtin display paths, disabled startup update checks
```

## COMPONENTS

```
components/
├── armin.ts, daxnuts.ts, earendil-announcement.ts  # Branded ASCII / mascot frames
├── assistant-message.ts                # Streaming assistant message render — has memoization cache (TUI flicker budget)
├── tool-execution.ts                   # Tool-execution streaming render — has memoization cache
├── bash-execution.ts                   # Bash-tool dedicated render (real-time stdout panel)
├── user-message.ts / user-message-selector.ts  # User input render + history selector
├── compaction-summary-message.ts       # Inline compaction summary card
├── branch-summary-message.ts           # Branch-summarization output card
├── skill-invocation-message.ts         # Skill-call render
├── custom-message.ts                   # Extension-injected message renderer
├── diff.ts                             # In-line diff viewer
├── footer.ts                          # Status footer (model, cost, tokens, mode); tests in test/footer-*.test.ts
├── countdown-timer.ts                  # Compaction / startup timer
├── bordered-loader.ts / dynamic-border.ts  # Animated borders
├── keybinding-hints.ts                 # Inline cheat-sheet
├── login-dialog.ts / oauth-selector.ts # Auth flows
├── model-selector.ts                   # Ctrl+P / `/model`
├── model-favorites.ts                  # Favorite-model id helpers (toggle/filter) used by the model selectors
├── favorite-models-selector.ts         # `/favorite-models` (fork-introduced)
├── thinking-selector.ts                # Thinking level toggle
├── trust-selector.ts                   # Project trust prompt (trust level + auto-updates options)
├── extension-selector.ts / extension-editor.ts / extension-input.ts  # `/extensions` UI
├── settings-selector.ts                # `/settings`
├── theme-selector.ts                   # `/theme`
├── show-images-selector.ts             # Image attachment toggle
├── session-selector.ts / session-selector-search.ts  # `/sessions`
├── config-selector.ts                  # Config picker (used during onboarding)
├── tree-selector.ts                    # File-tree picker (Tab completion)
├── custom-editor.ts                    # Multi-line editor (wraps tui editor-component)
├── visual-truncate.ts                  # Visual width truncation helpers
└── index.ts                            # Component index
```

## WHERE TO LOOK

| Task | File |
|------|------|
| Startup behavior | `interactive-mode.ts` `init()` (fork: `startup-tools.ts` instead of awaiting fd/rg downloads) |
| Streaming render perf | `components/assistant-message.ts` + `components/tool-execution.ts` memoization caches |
| Working row animation | `interactive-mode.ts` `getWorkingIndicatorOptions()` + `working-status.ts`; default normal TUI uses `•/◦` frames and animated text |
| Add a slash-command UI | corresponding component + `pi.registerCommand()` from a builtin extension |
| Footer field | `components/footer.ts` (token format / width tested) |
| Theme | `theme/<name>.json` + `theme-selector.ts` |
| Favorite-model cycling (Ctrl+P) | `interactive-mode.ts` (cycles only `favoriteModels` setting; reports missing) |
| Show extensions in startup banner | `interactive-mode.ts` `formatDisplayPath()` (renders `builtin/<name>`) |

## CONVENTIONS

- **Component memoization for streaming**: `assistant-message.ts` and `tool-execution.ts` cache rendered trees keyed by stream state. Bypassing this causes the TUI flicker-budget test (`packages/tui/test/tui-render.test.ts`) to fail.
- **All keybindings via `core/keybindings.ts`** — no inline keystroke literals.
- **Theme files**: name them `<theme>.json` under `theme/`; `copy-assets` copies them into `dist/`.
- **Working row**: preserve the default `•/◦` frames and `messageFormatter` suffix `Working (Xs • esc to interrupt)`. Plain `• Working` in a global install means the packaged `pi-tui` runtime is stale.
- **Component file naming**: `<kebab-name>.ts`. Class default-exported; tag exported.
- **Selectors return `Promise<T | null>`** — null = canceled.

## ANTI-PATTERNS

- Removing the fork's non-blocking startup probe in `startup-tools.ts` — re-introduces several seconds of "fd/rg downloading…" before the first frame.
- Re-enabling startup version checks (npm registry / package updates) — fork-disabled per `changes.md` to keep startup deterministic.
- Collapsing the normal TUI Working row to a static bullet or publishing against upstream `@earendil-works/pi-tui` — removes the visible working animation in global installs.
- Bypassing component memoization for streaming renderers — measurable flicker regression.
- Embedding ANSI escapes directly — use `core/tools/render-utils.ts`.

## NOTES

- The fork's `changes.md` lists interactive TUI deltas including normal Working animation, non-blocking startup tools, favorite-model cycling, builtin display paths, and disabled startup update checks. Preserve them on upstream rebases.
- Splash assets (`assets/*.png`) are copied to dist by `copy-assets` script; do not symlink.
- The `armin`, `daxnuts`, and `earendil-announcement` components are branded greeters — keep them harmlessly hidden behind branded settings.
