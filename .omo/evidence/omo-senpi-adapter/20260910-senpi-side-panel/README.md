# Live QA - senpi side panel (M1 host surface)

Change under test: the opt-in `side-panel` component in `packages/omo-senpi` plus the `side_panel`
block in `packages/omo-config-core`. Worktree `~/_code/omo-side-panel`, branch
`feat/senpi-side-panel`, base `826d819`.

## WHAT WAS TESTED

The real `senpi` binary (`node_modules/.bin/senpi`, 2026.9.9-2) driven in a tmux PTY against the
built plugin from this worktree (`packages/omo-senpi/plugin`, staged by `bun run build:senpi-plugin`).
Isolation follows the pattern of `packages/omo-senpi/scripts/qa/drive.mjs`: a `/tmp` sandbox with its
own `agent/settings.json` (`packages: [<worktree>/packages/omo-senpi/plugin]`, `tuiMode`), its own
`trust.json`, and `OMO_/SENPI_/PI_CODING_AGENT_DIR`, `HOME`, `XDG_*` all pinned inside it. The panel
was enabled through the real config surface: `<sandbox>/project/.omo/omo.jsonc` containing
`{ "side_panel": { "enabled": true } }`.

Four questions:

1. Does the reflowing column actually appear in fullscreen mode, and does the transcript reflow
   rather than get covered?
2. Does the column drop out below `min_columns`?
3. What happens in the default regular TUI mode, where no layout root exists to wrap?
4. Do the CLI flag forms behave as the component's description and the docs claim?

## WHAT WAS OBSERVED

| Run | Artifact | Result |
| --- | --- | --- |
| fullscreen, 200x50, `enabled: true` | `capture-fullscreen-200x50.txt` | **Column present.** The panel's location row renders at row 0, **column 148** - exactly `200 - 52`, where 52 is the resolved width (`26%` of 200). A transcript line in the same frame is 145 characters long and its text ends near x=145, so the transcript **reflowed into the left column** instead of being overlapped. |
| fullscreen, 100x44, `enabled: true` | `capture-narrow-100x44.txt` | **No panel.** `min_columns` is 120, so the `visible(viewport)` gate drops the column; the only occurrence of the project path is senpi's own footer at column 0. |
| regular mode, 200x44, `enabled: true` | `capture-regular-200x44.txt` | **Widget-block fallback.** The same row renders full-width above the editor (column 0, directly above the editor's top border), which is the documented degradation when the renderer exposes no layout root. |
| CLI flag forms | `flag-probes.txt` | `--omo-side-panel` accepted (exit 0). `--no-omo-side-panel` **fatal**: `Error: Unknown option`. `--omo-side-panel=false` accepted but the panel stays **on**. |
| Isolation | `isolation.txt` | Nothing under `~/.senpi` changed during the smoke window. All agent-dir variables pointed into the sandbox. |

Row positions for all three captures are recorded machine-readably in `row-positions.json`.

## WHAT THIS CHANGED IN THE CHANGE ITSELF

The flag probe found a real defect that unit tests could not: senpi's
`applyExtensionFlagValues` sets a **boolean** extension flag to `true` regardless of the value
parsed, and rejects a `--no-` form as an unknown option (`cli/args.js` +
`core/agent-session-services.js`). The component's flag description, the `omo.json` reference and
the package AGENTS.md all promised `--no-omo-side-panel`, which errors out. All three were corrected
to state what the host can actually do: the flag forces the panel **on**, and `side_panel.enabled`
is the switch that can say no. The `false` branch in the component is kept, and now says why: the
SDK carries flag values across session reloads (`core/agent-session.js`, `options.flagValues`), so a
`false` can still arrive in-process even though the CLI cannot produce one.

Noted, not touched: the shipped `omo-task` flag advertises `--no-omo-task` in its own description,
and that form fails the same way on this senpi version.

## M2 ADDENDUM - the sections, live (same sandbox)

After the section builders landed, the same fullscreen run was repeated to see real rows rather
than the location line alone. Artifact: `capture-m2-sections-200x50.txt`.

```
SESSION
model   mock-1
elapsed 0s
CONTEXT  0/200K
used    ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 0%
/tmp/omo-panel-smoke-<id>/project
```

Two things were fixed **because** this was looked at rather than only asserted: the heading read
`SESSION  $0 · 0` and a `tokens  in 0 · out 0` row sat under it on a session that had not spoken
yet. Both now stay silent until there is a number worth showing, which is also covered by a unit
test. The agents and tools sections are absent here because this run has neither - their rendering
is covered end to end in `index.test.ts`, which drives the real layout node and reads the painted
column.

## M3 ADDENDUM - git, the viewer, and the keyboard route (same sandbox, now a real repository)

The sandbox project was turned into a git repository holding all five interesting states at once
(unstaged delete, staged rename, unstaged modify, staged modify whose path contains a space,
untracked file), and the fullscreen run was repeated. Artifacts:
`capture-m3-diff-popup-200x50.txt`.

The column, live:

```
FILES  5 changed
 D gone.txt  +0/-1
R  renamed-new.txt  +0/-0
 M tracked.txt  +2/-1
M  with space.txt  +1/-0
?? brand-new.txt
/tmp/omo-panel-smoke-<id>/project · main
```

Every row matches `git status --porcelain=v1` for that tree: both status columns, the summed
staged+unstaged line deltas, the space inside `with space.txt` intact (thanks to `-z`), the rename
shown under its destination path, and the branch taken from `.git/HEAD` without spawning anything.

The keyboard route was then driven end to end: typing `/side-panel-diff` opened the host selector
titled "Show the diff of" listing all five files; choosing the modified one opened the framed
viewer:

```
┌──────────────────────────────────────────────
│ tracked.txt  (diff, read-only)
│ diff --git a/tracked.txt b/tracked.txt
│ index de98044..dcaf2c1 100644
│ --- a/tracked.txt
│ +++ b/tracked.txt
│ @@ -1,3 +1,4 @@
│  a
│ -b
│ +B-EDIT
│  c
│ +d
└──────────────────────────────────────────────
```

Escape closed it and the column survived underneath. The closing border is present, which is the
regression this design guards: the host clamps an overlay by slicing rows off the END, so the popup
owns its height alone (`popups/viewport.ts`) and the overlay is given `maxHeight: "100%"`. That
invariant is also pinned by a unit test across five terminal heights.

## AFTER REBASING ONTO dev (senpi 2026.9.10)

`dev` moved nine commits ahead while this was being written, including a senpi bump from 2026.9.9-2
to 2026.9.10 and a refresh of the same generated bundles. The branch was rebased, the bundle
conflict was resolved by **regenerating** rather than merging (with `bun install` first, so the
artifact is built against the new engine), and the whole thing was re-verified:

- `bun run test:senpi` on the rebased tree: **exit 0**, 3,359 tests, 0 fail.
- The host surfaces this component relies on all still exist in pi-tui/senpi 2026.9.10:
  `setLayoutRoot`, the `VIEWPORT_TUI` and `LAYOUT_NODE` registry symbols, the hstack layout node,
  `exec` on the extension API, and `ui.setWidget`.
- Live capture on the new engine, same sandbox:
  `capture-rebased-senpi-2026.9.10-200x50.txt` - the column renders session, context, all five git
  states and the branch exactly as before.

## WHAT THE LIVE RUN CAUGHT

Running the built branch against a real session (real provider, real repository) found a defect the
hostless tests could not: the `cache` row printed `9811% hit` while the host footer showed `CH98.1%`
for the same session. `UsageTotals.latestCacheHitRate` is **already a percentage** - the host
computes `(cacheRead / latestPromptTokens) * 100` and renders it with `toFixed(1)` - and the panel
multiplied by 100 a second time. The unit tests agreed with the bug because the fixture encoded the
same wrong assumption (`0.923` as a ratio).

Fixed in `sections/session.ts` (no second scaling), the unit is now documented on the field, and both
fixtures were moved to host units so a ratio-shaped value can no longer look correct.

## WHY IT IS ENOUGH

Every branch of the surface decision was exercised against the real binary, not a fake: the column,
the narrow-terminal hide, and the widget fallback. The column's geometry was verified numerically
(start column equals terminal width minus resolved panel width) rather than by eyeballing a
screenshot, and the reflow was verified by measuring transcript line length in the same frame.

## WHAT WAS OMITTED

- No model traffic: the runs use the repo's offline mock provider and `PI_OFFLINE=1`, so this proves
  startup, layout and teardown - not behaviour during a live turn. The panel renders no
  turn-dependent data yet (M1 ships the location row only).
- Mouse interaction is not covered because it is not implemented yet (M3, and it depends on a
  non-public seam).
- The `write EIO` lines in the sandbox's `senpi-debug.log` are this driver killing the tmux session
  under a running TUI, not a panel fault; their timestamps match the `tmux kill-session` calls.
