# packages/tui

`@earendil-works/pi-tui` — terminal UI library with three-strategy differential rendering and synchronized output (DECSET 2026). Standalone (no agent dependency); senpi's interactive mode is the largest consumer.

## STRUCTURE

```
src/
├── tui.ts                # TUI class. doRender() — the differential render core
├── terminal.ts           # Terminal abstraction (writes, capabilities, mouse, paste)
├── editor-component.ts   # Multi-line text editor primitive
├── components/           # Built-in components (text, loader, box, markdown, select-list, input, image, ...)
├── autocomplete.ts       # Generic autocomplete engine (used by editor)
├── fuzzy.ts              # Fuzzy match used by autocomplete
├── keybindings.ts / keys.ts  # Key parsing, binding registry
├── kill-ring.ts          # Emacs-style cut buffer
├── stdin-buffer.ts       # Decoupled stdin reader (handles bracketed paste)
├── undo-stack.ts         # Editor undo/redo
├── terminal-image.ts     # iTerm2 / Kitty image protocol adapters
├── utils.ts              # ANSI/widths/east-asian width
├── index.ts              # Public exports
└── changes.md            # Fork-tracked: doRender() flicker-budget tightening
```

## WHERE TO LOOK

| Task | File |
|------|------|
| Reduce flicker / re-render | `src/tui.ts` `doRender()` — three branches: viewport-shift / line-diff / fullRender |
| Loader / Working animation | `src/components/loader.ts` — indicator frames and independent `messageFormatter` animation |
| Add a new key / chord | `src/keys.ts` (parsing) + `src/keybindings.ts` (binding) |
| Image rendering issue | `src/terminal-image.ts` (per-protocol path) |
| Paste handling | `src/stdin-buffer.ts` bracketed-paste sequence handler |
| Width / wrap regressions | `src/utils.ts` East-Asian width handling |
| Test rendering invariants | `test/tui-render.test.ts` flicker-budget assertions |

## RENDERING CONTRACT (DO NOT BREAK)

- `doRender()` MUST stay on the differential path whenever viewport rows are stable.
- Every `DECSET 2026` (synchronized output begin) MUST have a matching end. The flicker-budget test counts them.
- `fullRender(true)` (full clear) is allowed at most once — at init. Any post-init full clear is a regression.
- Component memoization for high-frequency streaming updates is the consumer's responsibility (see senpi `assistant-message.ts` / `tool-execution.ts` caches).
- `Loader` MUST preserve `messageFormatter` and `messageIntervalMs`. Senpi normal TUI uses them for animated `Working (Xs • esc to interrupt)` text; indicator-only animation is a regression.

## CONVENTIONS

- Test runner is `node --test --import tsx`, NOT vitest. Tests are flat in `test/*.test.ts`.
- Headless terminal under test uses `@xterm/headless` to read back what the TUI wrote.
- Windows console hijacking and macOS modifier detection use vendored native prebuilds (`native/win32/prebuilds/*.node` loaded in `src/terminal.ts`, `native/darwin/prebuilds/*.node` loaded in `src/native-modifiers.ts`), loaded lazily via `createRequire` — never add a required native dependency.

## ANTI-PATTERNS

- Replacing `doRender()` with a redraw-everything path "to fix a corner case" — breaks flicker budget.
- Using `console.log` / `process.stdout.write` directly inside components — bypasses synchronized output.
- Hand-tracking cursor position outside `tui.ts` private state.
- Adding test files outside `test/` — `npm test` glob is `test/*.test.ts`.

## NOTES

- This package is consumed by `packages/coding-agent` (TUI mode).
- Authored by Mario Zechner (upstream). Fork changes include `doRender()` differential paths and `Loader` message animation; see `src/changes.md`.
