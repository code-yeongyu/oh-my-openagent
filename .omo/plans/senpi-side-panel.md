# senpi-side-panel - Work Plan

## TL;DR (For humans)

**What you'll get:** an opt-in right-hand column in the Senpi TUI. The transcript reflows into the
left column instead of being covered, and the panel shows what the session is actually doing:
subagents with live timers, tool activity, context split, subscription usage, changed files from
real `git status`, and memory state. Off by default; one config key or one CLI flag turns it on.

**Why this approach:** the reflowing column is built on public pi-tui layout API
(`ViewportTUI.setLayoutRoot`, the `LAYOUT_NODE` hstack contract with per-entry
`basis/grow/shrink/minSize/visible`), reached through the sanctioned senpi seam that already hands
a component the live `tui` (`ui.setWidget(key, (tui, theme) => Component)`). Exactly two facts are
not public - reading the current layout root (`private layoutRoot`) and mouse-click routing (the
SGR parser is private) - so both are isolated in one file behind runtime guards, and the feature
degrades instead of breaking when they are absent.

**What it will NOT do:** it will not touch the built-in footer, the task widget, or any existing
component's rendering. It will not become the default. It will not add a second usage poller for
users who never enable it. It will not ship click-only affordances - every action also has a
keyboard route.

**Effort:** Large
**Risk:** Medium - two non-public seams, both probed at runtime with a documented fallback ladder.
**Decisions to sanity-check:** the config block name (`side_panel`), the default width (26%) and
`min_columns` (120), and whether the widget-block fallback ships in this PR or lands as follow-up.

Your next move: review, then execution proceeds milestone by milestone with the gates listed per step.

---

> TL;DR (machine): new opt-in `packages/omo-senpi/src/components/side-panel/` component rendering a
> reflowing right column via public pi-tui layout API captured through `ui.setWidget`; new typed
> `side_panel` omo.json block + `omo-side-panel` CLI flag; data from first-party task/memory/context
> seams and `pi.exec` git; three-tier degradation (column -> widget block -> dark); no changes to
> existing components' behavior.

## Scope

### Must have

- `packages/omo-senpi/src/components/side-panel/` following the repo's module rules: `index.ts`
  barrel + factory, `types.ts`, `constants.ts`, concern-split files, no catch-all module.
- Registration in `src/extension/component-list.ts` via `createSidePanelComponent()`.
- Feature toggle, two layers: typed `side_panel` block in `omo.json`
  (`packages/omo-config-core/src/schema/side-panel.ts`, wired into `OmoConfigSchema` and
  `OmoTypedHarnessConfigSchema`, with `resolveOmoSidePanelSettings()`), plus a
  `omo-side-panel` CLI flag registered with `pi.registerFlag` that overrides the config.
  **Default off.**
- Host coupling isolated in `host-surface.ts`: capture `tui`/`ui`, probe `VIEWPORT_TUI` +
  `setLayoutRoot` + a readable root, wrap into an hstack, restore the original root on dispose.
  Access to undeclared runtime members goes through local structural port interfaces plus runtime
  guards (the `CapturedUi` / `uiFromContext` precedent), never `as any` / `@ts-ignore`.
- Degradation ladder: (1) reflowing column when the probe succeeds; (2) `ui.setWidget` block above
  the editor when it fails; (3) nothing at all when `mode() !== "tui"` / `hasUI === false`, with a
  single debug-level log.
- Sections, each a pure `build*Rows(state, width)`: session, context split, usage, agents, tools,
  files (git), memory. Collapsible, cwd + branch pinned at the bottom.
- Data from first-party seams: task manager port (`list`, `subscribeChild`, `runStatsSnapshot`) for
  agents, `ctx.getContextUsage()` / `sessionManager` for context and cost, `pi.getAllTools()` plus
  `tool_execution_*` for tools, `pi.exec("git", ...)` for status and diff, the memory component's
  state for memory. No RPC eavesdropping.
- Git layer via the CLI: `status --porcelain=v1 -z`, `diff --numstat -z` (+ `--cached`),
  `diff HEAD -M -- <from> <to>` (both paths, or a rename renders as a whole new file),
  `diff --no-index -- /dev/null <path>` for untracked (exit code 1 is normal).
- Popups through `ui.custom(factory, { overlay: true, overlayOptions })` with the height budget
  owned in exactly one place: the overlay cap slices from the bottom, so painting more than
  `floor(rows * ratio)` lines silently eats the closing border.
- Keyboard parity: a `/side-panel` command and shortcuts registered with `pi.registerShortcut` for
  every action reachable by click.
- Docs: `### side_panel (Senpi harness)` section in `docs/reference/omo-json.md`, regenerated
  `assets/omo.schema.json` via `bun run build:omo-schema`.
- Tests colocated per module, hermetic, passing in one `bun test` run; injected timers; no sleeps.
- Live QA with the `senpi-qa` skill, evidence under `.omo/evidence/omo-senpi-adapter/<slug>/`.

### Must NOT have (guardrails, anti-slop, scope boundaries)

- No change to the built-in footer, the task status widget, or any existing component's output.
- No default-on behavior, and no work performed when the toggle is off: the component must return
  from `register()` before allocating pollers, watchers, or timers.
- No `as any`, `@ts-ignore`, `@ts-expect-error` anywhere - undeclared host members are reached
  through `unknown` + runtime guards only.
- No static value import of the `@earendil-works/pi-tui` barrel from omo-senpi (it strands the lazy
  boundary in the bundled output). `import type` is fine, it erases; the two layout symbols come
  from `Symbol.for(...)`, which is what makes duplicated pi-tui copies work.
- No polling loop for git: watch `.git/index` plus a lazy staleness refresh. No recursive
  `fs.watch` - it errors `ENXIO` on some trees and burns scarce inotify instances.
- No throwing per frame: a render fault is caught, reported once, and the panel goes dark rather
  than killing the session (an uncaught render error takes the whole process down).
- No new usage endpoint traffic beyond the existing per-provider TTL, and no per-session polling -
  the cache is shared on disk with a single backoff.
- No `packages/omo-opencode/` or `packages/omo-codex/` changes. No `packages/telemetry-core/` changes.
- No prose-pinning tests (no asserting what a comment or doc says).
- No scope growth: anything not in this plan is a follow-up.

## Milestones

### M1 - skeleton, toggle, host surface

| Step | Change | Verification |
| --- | --- | --- |
| 1.1 | `schema/side-panel.ts` in omo-config-core: `OmoSidePanelSettingsSchema` + layer schema + `resolveOmoSidePanelSettings()` | unit: defaults, layer merge, strict rejection of unknown keys |
| 1.2 | Wire the block into `OmoConfigSchema` + `OmoTypedHarnessConfigSchema`; regenerate the JSON schema | `bun run build:omo-schema`; assert the generated file contains the block |
| 1.3 | `components/side-panel/{types,constants}.ts` | `tsgo --noEmit -p packages/omo-senpi/tsconfig.json` |
| 1.4 | `host-surface.ts`: probe, wrap, restore, input-listener install/remove | unit with a fake tui: wrap installs an hstack, dispose restores the exact original root, probe failure returns `"widget"`, non-viewport renderer returns `"dark"` |
| 1.5 | `index.ts`: flag + config gate, registration, dispose; add to `component-list.ts` | unit: gate off does nothing at all (no widget set, no timers); gate on installs; `component-list` includes it |

Gate for M1: `tsgo --noEmit -p packages/omo-senpi/tsconfig.json` and `bun test packages/omo-senpi`.

### M2 - state and sections

Store with child/tool/file/usage/memory state and pure transitions; the seven section builders and
the shared formatters (`bars`, `units`, `truncate`). Tests are table-driven per section; store tests
cover spawn -> running -> finished, the row cap, and "a running child is never evicted".

### M3 - git, popups, keyboard

Git status/diff through `pi.exec` with the five-state fixture repo (`M `, ` M`, `R `, ` D`, `??`,
plus a filename containing a space); popups with the height-budget test at 24/30/50/80 rows;
`/side-panel` command and shortcuts.

### M4 - docs, schema, live QA, PR

`docs/reference/omo-json.md` section, regenerated `assets/omo.schema.json`, full gates
(`bun run typecheck`, `bun test`, `bun run build`, `bun run test:senpi`), `senpi-qa` live evidence
including a narrow-terminal capture proving the column drops out, then the PR against `dev`.

## Residual risk

1. `layoutRoot` is `private` in pi-tui's declarations. Reading it is a runtime-guarded structural
   access; if a future release renames it, the probe fails and the panel falls back to the widget
   block. Detected, not crashed.
2. Mouse routing depends on the private SGR path. If input never reaches the listener, clicks stop
   working and every action remains available from the keyboard.
3. The repo declares pi-tui `0.84.2` while the shipped host currently runs `2026.9.9`. Nothing is
   imported for value, and the layout symbols are registry symbols, so the skew is tolerated by
   construction rather than by pinning.
