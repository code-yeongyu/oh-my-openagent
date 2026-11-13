# Baseline: the shipped computer tool

The subject is the released OmO Native (`omo-ai`) with its current `computer` tool at default settings. The release is installed from the public npm registry on a hosted runner. Its own computer-use bundle is driven through `run.ts --driver legacy` (`../drivers/legacy.ts`). No model is called and no credential is used. Nothing in the shipped runtime is changed to make a cell pass: a cell it fails, refuses or disturbs is a finding of this baseline.

Release measured: **5.1.69**. Its default settings come from the `v5.1.69` tag's own resolver.

## What this baseline can and cannot show

The release is driven in its own process: the harness loads the release's computer-use bundle and calls its `computer` tool directly, with the release tag's own default settings, no model, no credential, no host interface and no foreground grant. Two consequences, so no number here is read for more than it says:

- A foreground action can only be refused. The release asks a person to approve foreground control, and there is no person, so `ControlRequired` on a foreground cell is the shipped answer to this harness, not a judgement of foreground delivery.
- Disturbance is **not measured** wherever the cells read `unobserved`. No recorder exists for Linux or Windows yet, so every signal there reads `not_observed`. A `disturbed` count of 0 beside a non-zero `unobserved` count means nothing was watched, never that nothing was disturbed.

The sentinel leg (the background scenario set, run inside the sentinel) is **not run**: the sentinel records on macOS only. macOS has only the scoped accessibility leg below, because its live tier has no machine. So the one gap the baseline was meant to show on macOS, a background click raising the clicked window, is not shown here.

## What the shipped tool reports about each runner

These are the shipped tool's own `capabilities` answers, taken before any cell runs. They describe what the release believes about the session. They are not a measurement of what it can do.

| Field | x11 (ubuntu-26.04, Xorg with the dummy driver) | windows (windows-latest) |
| --- | --- | --- |
| backend | `x11` | `win32` |
| capture / input | granted / granted | granted / granted |
| accessibility | `ax: false`, `axPermission: toolkits-silent`, although the accessibility registry daemon was running | `ax: true`, granted |
| background window input | true | true |
| stop path | global | global |
| focus guard | true | true |
| integrity level | not reported | `high` (the runner runs elevated) |
| displays | 1 | 1 |

On both runners the released tool reached its own engine with no model and no credential. The engine binary is fetched from the release's public assets.

## Cells and tasks

Measured on the hosted runners at branch head `dff46ef3e3`, release 5.1.69. Per-cell records: `legacy-5.1.69-x11.json`, `legacy-5.1.69-windows.json`.

| | x11 (Xorg, GTK fixture) | windows (WinForms fixture) |
| --- | --- | --- |
| cells | 66 | 66 |
| met their declared outcome | 5 | 10 |
| reported delivered | 12 | 11 |
| refused by the release | 32 | 11 |
| the release answered an error | 22 | 22 |
| no fixture app | 0 | 22 (no web-view app on Windows) |
| disturbed | not measured (no recorder) | not measured (no recorder) |

The counting is the report's: a cell that meets its oracle while no observer watched is counted `unobserved`, never as passing, so the `delivered` column of the report line reads 0 on both.

Task set, replayed with no model: windows 1 of 12 (choosing a menu item by title), x11 0 of 12. Every other task fails on a step whose cell also fails above.

### What works in the background, verified by the fixture's own state

- **Windows, native:** a click (by accessibility and by pixel), typing by pixel, a scroll (both), the accessibility value write, an accessibility press, and selecting a menu item by title.
- **x11, native:** the accessibility value write, an accessibility press, and selecting a menu item by title.
- **Both, foreground:** the accessibility value write and the accessibility press, which need no foreground grant.

### macOS: the accessibility routes on a hosted runner

Measured on hosted macOS 15.8.2 (run 43363704791), native AppKit fixture only. Per-cell record: `legacy-5.1.69-macos.json`. The row stays open: this is not the macOS baseline, only the part a hosted runner can show.

- **What ran:** the 8 accessibility cells on the native fixture. The 42 pointer cells are `not_run`: pid-routed input is unavailable on a hosted runner (#13227). The 16 Electron and web-view cells are `not_run`: no macOS fixture app is mapped yet; #13298 adds them, and they are re-recorded after it merges.
- **Delivered and received in the background:** typing by accessibility, the accessibility value write, an accessibility press, and selecting a menu item by title. Typing by accessibility in the background is refused `AxUnsupported` on x11 and Windows; on macOS the fixture received the text.
- **Foreground:** the value write and the press are delivered and received; typing and the menu are refused `ControlRequired`, the same answer as on the other runners.
- **Permissions:** the run measured the same cells twice. Plain launch: the runner's own agent is the responsible process and is already trusted, so the release reports every permission granted (inherited trust). Own responsible process: the release first reported capture, input and accessibility denied; after a run-time grant to the vendor-signed `bun` binary by path and designated requirement, it reported all three granted, and the grant was removed afterwards (0 rows left). The grant covered four services, wider than these cells need. Both launches gave the same outcome on every cell.
- Disturbance is not measured here either.

## Findings

Each finding below is the release's own answer. Its class says how it was settled: **verified by control** means an independent input path, outside the tool, acted on the same target and the fixture recorded it while the release's own action did not.

- **x11, background pointer and key delivery is reported delivered and is not received. VERIFIED BY CONTROL for the click, the scroll and the key chord; typing by pixel and the pixel drag show the same shape and were not controlled themselves.** Seven background cells: a click (by accessibility and by pixel), typing by pixel, a scroll (both), a pixel drag in the list, and the key chord. Each reports `delivered` while the fixture's state does not change after a 3-second settle. Controls: at the same global point the release used, an independent `xdotool` click raised `pressCount` to 1 and three wheel clicks raised `scrollSteps` to 3, while the release left both at 0 (hosted runs at `86138ba30b`, `da4030732a` and `dff46ef3e3`); with the fixture window holding keyboard focus, an independent `xdotool` `ctrl+k` was recorded while the release's chord left the fixture empty (`dff46ef3e3`). Reported on #9109, which describes this defect and had not reproduced it against a real application.
- **Windows, the background key chord is reported delivered and is not received. VERIFIED BY CONTROL.** The fixture records no keys. The catalog declares no effect for this cell, so the declared outcome is a refusal and the release instead reports delivery. Control (hosted runs at `2a52285478` and `da4030732a`): with keyboard focus on the Value field, `SendInput` sent all 4 events and the fixture recorded `ctrl+k`.
- **x11, the release's hit-test returns the window's root filler everywhere.** A finding of its own, separate from delivery. `elementAt` at the centre of the Press button, the Value field, the Scroll target and a list row returns `filler` with no title, before and after the window was raised. Every x11 pointer cell logs `hit_test="filler:null" hit_test_matches_target=false`; on Windows every pointer cell logs `hit_test_matches_target=true`.
- **Background typing through accessibility is refused `AxUnsupported` on both OSes**, on the resolved text field. This is the release's own answer.
- **Windows, a background pixel drag in the list is refused `InputFailed`.**
- **Foreground: every foreground cell except the accessibility value write and press is refused `ControlRequired`** (9 on each OS), which is the shipped answer when no person can approve foreground control.
- **Electron and web-view content is not reachable.** On x11 every Electron cell is refused `AxFailed`; on Windows the Electron window lists only its frame and a `Chrome Legacy Window`, and the x11 web-view window lists only its menu bar. The web content is absent from the accessibility tree in all three. Whether the fixture apps must turn renderer accessibility on, or the release cannot read it, is open with the fixture apps' owner.
- **Pending re-record: the 22 x11 Electron cells.** Their committed value (`AxFailed`) predates the x11 job setting `ACCESSIBILITY_ENABLED=1`. With it set, the same cells find the window but no page content (run 43358622643). They are re-recorded once the fixture app exposes its page.
- **Run 43358622643's Windows job is not a finding.** It failed in this harness's own step that builds the Windows web-view fixture, before the release was installed; that step now runs only once the fixture app is in the tree.
- The shipped runtime never reports whether input was sent with a refusal, so every refusal is recorded with `nothingSent: false`.

### Corrected by re-measurement

An earlier version of this baseline recorded three findings that were the harness's. Both fixture apps put a caption named `Value` beside the field, and the driver then looked elements up by name alone, so cells aimed at the caption. With the lookup skipping captions (hosted runs from `da4030732a`), the accessibility value write on both OSes (earlier: refused `AxFailed`), the x11 key chord (earlier: refused `AxFailed`) and Windows typing by pixel (earlier: delivered and not received) were measured again; the results above replace them.

### How a cell is aimed

A cell finds its element in the tree the release itself returns, skipping captions, and logs the resolved role, bounds and candidates. The fixture apps do not report their widgets' screen geometry yet, so a pixel cell's point is the centre of that resolved element, and the cell is sent only when the point is inside the window and inside the element's bounds: the aim rests on the tree the release itself returns. On both OSes an independent input sent to such a point registered in the fixture (the controls below), so the aim was on the element. The release's hit-test answer never stops a cell; it is recorded. A typing cell that resolves to a caption is refused by the driver and sends nothing.

### The controls (rules fixed before their runs)

Each leg runs on a fresh fixture. The release sends its background action first; then an input path outside the tool acts on the same target, and the fixture is read after each. The verdict rules were written here before each control's first run:

- **x11 click and scroll:** `xdotool` raises the window and acts at the same global point the release used; the window geometry `xdotool` reads is logged beside the bounds the release reported. It registers: the release's delivery was lost (verified by control). It does not: the bounds are off (unclassified).
- **x11 key chord:** `xdotool` raises the fixture window, logs the window holding keyboard focus, and presses `ctrl+k`. It registers with the fixture's window focused: verified by control. The fixture's window is focused and nothing registers: a harness finding. Otherwise: not controlled.
- **Windows typing and key chord:** `send-input.ps1` sends input through `SendInput`, logging the foreground window and the focused control before each step. It registers, every event is sent and the focus is the Value field: verified by control. Everything is sent to the Value field and nothing registers: a harness finding. Fewer events sent or a different focus: not controlled.

Results: x11 click 1 vs 0 and scroll 3 vs 0, x11 key chord `ctrl+k` vs empty, Windows key chord `ctrl+k` vs empty. The Windows typing leg showed the release's own typing received (`conformance`), so that cell is not a finding. In the run at `dff46ef3e3` the Windows control stopped after its typing leg: reading the fixture's report file failed with `EBUSY` while the fixture was rewriting it, so the Windows key-chord leg did not run there; its verdict rests on the runs at `2a52285478` and `da4030732a`. The driver now reads a busy report again within the same settle budget.

Only the release's own answers about actions it attempted are recorded here. Failures caused by the test harness are not, nor are results that are still being checked.
