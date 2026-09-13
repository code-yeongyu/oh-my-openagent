# Side panel: clickable rows

Branch `feat/senpi-side-panel-usage`, on top of the side panel and its usage section. No PR yet.

## WHAT WAS TESTED

Whether a mouse click on a panel row can reach the extension at all, and then whether clicking a
file row opens that file's diff, driving the REAL `senpi` binary in `--tui-mode fullscreen` and
delivering a real SGR mouse report (`ESC [ < 0 ; col ; row M` / `m`) into the pane's stdin, at the
screen coordinates of a row read back from the rendered frame.

The starting assumption - written into the first panel PR's evidence and into `omo-json.md` - was
that this is impossible without a non-public host seam. That was wrong, and the reconnaissance that
disproved it is the substance of this change:

- `tui-alt-screen.js` sets `this.mouseEnabled = options.mouse ?? true` and senpi passes no `mouse`
  option, so SGR mouse tracking is already on in every fullscreen session. Nothing needed enabling,
  and nothing about text selection needed changing: pi-tui already owns drag-select and
  copy-on-select there.
- The host dispatches a click to the application exactly once, through OSC 8 hyperlink activation:
  on press and release inside one cell with no drag it calls
  `getOsc8LinkAtColumn(previousScreen[event.y], event.x)` - its own rendered buffer, not the
  terminal's - and hands the URL to `openUrl`. The regex accepts any scheme and validates nothing.
- The object a widget factory receives is the proxy from `createInteractiveTuiReference`, whose
  `set` trap forwards to the live renderer, so `openUrl` can be claimed and put back.

## WHAT WAS OBSERVED

1. **The hook is reachable.** A throwaway probe (reverted; not in the diff) painted every row as an
   OSC 8 link and replaced `openUrl`. A click on the `SESSION` row logged
   `click: omo-panel:probe/0`, with the host's own `openBrowser` never invoked.
2. **A file row opens its diff.** Clicking the row `M omo.schema.json  +20/-0` opened the framed
   read-only viewer titled `assets/omo.schema.json  (diff, read-only)` carrying the real diff -
   `capture-file-click-200x50.txt`.
3. **Clicking again does not stack viewers.** A second click on the same row while the viewer was
   open left exactly one frame and one title on screen (border counts before and after: 1/1), so no
   re-entrancy guard was added. This was measured rather than assumed.
4. **Foreign URLs still belong to the host.** Unit-level: a `https://` activation is handed to the
   previous callback untouched, and after `dispose()` even the panel's own scheme goes to the host.
5. **Remounting does not nest the callback.** The renderer proxy wraps every function it hands out,
   so a naive save-and-restore gains one wrapper per mount cycle and the chain grows with the number
   of session switches. The host's callback is therefore parked on the renderer in a plain object
   (handed back unwrapped) under `SIDE_PANEL_PARKED_URL_HOOK`. The test that pins this was checked
   against the unfixed code and fails there, so it is a real guard rather than a passing assertion.

## WHY IT IS ENOUGH

The click path is one function: the host resolves a URL, `host-surface.ts` parses it, and
`index.ts` dispatches. Case 2 drives that whole path end to end on the real binary, including the
part no test can fake - that the panel's OSC 8 escapes survive the layout compositor into the frame
the host hit-tests. What the unit tests add is the branching and the failure modes: foreign URLs,
disposal, a file that has since been committed, the toggle off, and the codec for paths carrying
characters that would otherwise end the escape sequence early.

## WHAT WAS OMITTED

- The agent-row click was not driven live: the QA session had no delegated child, and spawning one
  to click on it would cost a real model turn for a branch selection. It is covered by unit tests
  for both the row's action and the card it opens, and it shares every part of the mouse path with
  the file case - only the `switch` arm differs.
- `usage/credentials.ts` has no test of its own: it is two `readFileSync` calls behind the shared
  `resolveAgentHome`, and the poller tests inject their own credential source.
- Isolation is partial by design: the stand runs its own agent dir (`~/.omo-panel/agent`) but shares
  `auth.json` with the real one by symlink, so a live session there can refresh the real token. The
  real `~/.omo/agent` was otherwise untouched, and backups of both credential files were taken
  before the symlinks were pointed at it.
- No terminal-capability check gates the OSC 8 painting; `side_panel.clickable` is the escape hatch
  for a terminal that mangles hyperlinks. pi-tui exposes no hyperlink capability flag to read.

## GATES

- `bun run test:senpi` - exit 0.
- `bun run typecheck` (root, what CI runs) - exit 0.
- Component suite: 264 tests, 0 fail.

---

## FOLLOW-UP: THE WHEEL, AND WHAT A CLICKED AGENT SHOWS

Two things the first pass got wrong, both reported from the live stand.

### The wheel did nothing in the viewer

`routeWheel` sends a wheel event to whatever scroll view sits under the pointer **in the host's
layout**, and an overlay is composited outside that layout - so the wheel was scrolling the
transcript behind the popup while the popup itself ignored it. The fix uses public API:
`ui.onTerminalInput` (senpi hands the handler straight to pi-tui's `addInputListener`, whose
listeners run BEFORE the renderer's own input handling and whose `{consume: true}` is honoured), so
while a viewer is open every wheel report is decoded, applied to the viewer, and claimed.

Measured live in an isolated repo whose only change was a 200-line rewrite
(`capture-wheel-scroll-200x50.txt`):

| step | viewer position |
|---|---|
| opened | `1-32/405` |
| three notches down | `10-41/405` |
| two notches up | `4-35/405` |

Three rows per notch, exactly as configured, and the transcript line behind the popup was
byte-identical before and after - so nothing scrolled underneath.

### A clicked agent showed only metadata

The card carried status, elapsed, category, turns, tokens, cost and id - not one word of what the
child actually did. It now shows the card as a header followed by the child's whole recorded
transcript, rendered by the task engine itself (`defaultTranscriptReader` + `renderTranscript` with
`mode: "full"`), reached through the `#omo-task-runtime` alias so the entry bundle keeps none of the
task graph.

**Not driven live**, and this is the one gap worth knowing about: the panel lists a child only when
a task record names the running session as its parent, so a live proof needs a real delegated child,
and spawning one to click on it costs a real model turn. What backs it instead is an integration
test that is not a mock - it writes a child's event log into a real state dir, reads it back through
the engine's own reader and renderer, and asserts the rows a click would show, including the
"nothing recorded" case. The dispatch either side of that is unit-tested.
