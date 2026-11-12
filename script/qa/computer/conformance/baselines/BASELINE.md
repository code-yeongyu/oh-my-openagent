# Baseline: the shipped computer tool

The subject is the released OmO Native (`omo-ai`) with its current `computer` tool at default settings. The release is installed from the public npm registry on a hosted runner. Its own computer-use bundle is driven through `run.ts --driver legacy` (`../drivers/legacy.ts`). No model is called and no credential is used. Nothing in the shipped runtime is changed to make a cell pass: a cell it fails, refuses or disturbs is a finding of this baseline.

Release measured: **5.1.69**. Its default settings come from the `v5.1.69` tag's own resolver.

## What this baseline can and cannot show

The release is driven in its own process: the harness loads the release's computer-use bundle and calls its `computer` tool directly, with the release tag's own default settings, no model, no credential, no host interface and no foreground grant. Two consequences, so no number here is read for more than it says:

- A foreground action can only be refused. The release asks a person to approve foreground control, and there is no person, so `ControlRequired` on a foreground cell is the shipped answer to this harness, not a judgement of foreground delivery.
- Disturbance is **not measured** wherever the cells read `unobserved`. No recorder exists for Linux or Windows yet, so every signal there reads `not_observed`. A `disturbed` count of 0 beside a non-zero `unobserved` count means nothing was watched, never that nothing was disturbed.

The sentinel leg (the background scenario set, run inside the sentinel) is **not run**: the sentinel records on macOS only. macOS has no leg at all yet, because its live tier has no machine. So the one gap the baseline was meant to show on macOS, a background click raising the clicked window, is not shown here.

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

Measured on the hosted runners at branch head `0d26faac3b`, release 5.1.69. Per-cell records: `legacy-5.1.69-x11.json`, `legacy-5.1.69-windows.json`.

| | x11 (Xorg, GTK fixture) | windows (WinForms fixture) |
| --- | --- | --- |
| cells | 66 | 66 |
| met their declared outcome | 3 | 7 |
| refused by the release | 35 | 13 |
| the release answered an error | 22 | 22 |
| no fixture app | 0 | 22 (no web-view app on Windows) |
| disturbed | not measured (no recorder) | not measured (no recorder) |

The counting is the report's: a cell that meets its oracle while no observer watched is counted `unobserved`, never as passing, so the `delivered` column of the report line reads 0 on both.

Task set, replayed with no model: windows 1 of 12 (choosing a menu item by title), x11 0 of 12. Every other task fails on a step whose cell also fails above.

### What works in the background, verified by the fixture's own state

- **Windows, native:** a click (by accessibility and by pixel), a scroll (both), an accessibility press, and selecting a menu item by title. The fixture recorded the press, the scroll distance and the menu choice.
- **x11, native:** an accessibility press and selecting a menu item by title.

## Findings so far

- The shipped runtime never reports whether input was sent with a refusal, so every refusal is recorded with `nothingSent: false`.
- **x11, native, VERIFIED BY CONTROL: background pointer delivery is reported delivered and is not received.** Five background cells (click by accessibility, click by pixel, scroll both ways, pixel drag) report delivery while the fixture's state does not change, after a 3-second wait for it to settle. On the same element in the same run, an accessibility press is delivered and the fixture does record it, and on Windows the same click is delivered and recorded. The element, the fixture and the oracle work. The control (hosted run at `86138ba30b`) settles it on two elements of different kinds: at the same global point the release used, an independent `xdotool` click on the Press button raised `pressCount` to 1 and three wheel clicks on the Scroll target raised `scrollSteps` to 3, while the release's own background click and scroll at that point were reported `delivered` and left both at 0. The point and the element bounds are right; the release's background delivery is what was lost. Scope: the independent actions ran after the window was raised, so this verifies the background route, not foreground delivery. Typing by pixel is not in this class: it aimed at the field's caption (see the Value-field entry below).
- **Windows, native, key chord: VERIFIED BY CONTROL.** The background key chord reports delivery while the fixture records no keys. In the control (hosted run at `2a52285478`) the release's own focus call left keyboard focus on the Value field, `SendInput` then sent all 4 events and the fixture recorded `ctrl+k`; the release's chord, reported `delivered`, left it empty. The focus was right; the release's background key delivery was lost.
- **Windows, native, typing by pixel: not controlled, and its target is suspect.** It reports delivery while the fixture records no text. The control's own reading shows why it cannot be settled yet: the release aimed at a static text element titled `Value` (the field's label), not at the editable field, and an independent click at that point left the focus on the `Press` button. The cell looks up its element by name alone, and on Windows that finds the label first, so this cell may be a harness finding rather than the release's. It stays unclassified until the cell targets the field itself.
- **Windows, native:** a background pixel drag in the list is refused with `InputFailed`.
- **Harness target suspect, re-measured in RUN 8i: every cell that targets the Value field, on both OSes.** Both fixture apps put a caption named `Value` beside the field, and the driver looked elements up by name alone, so it could resolve the caption. Measured on Windows: typing by pixel aimed at `statictext` `Value`, and the window lists both `statictext:Value` and `textfield:Value`. On x11 the GTK fixture has the same caption, and typing by pixel aimed at x=49, a narrow element at the start of the row, while the Press button's centre in the same 640-pixel window is x=321, so it hit the caption too. These cells are not facts about 5.1.69 until re-measured: typing by pixel and through accessibility, the accessibility value write (Windows `AxFailed`; x11 `AxFailed`), background typing through accessibility (`AxUnsupported` on both), and the x11 key chord (`AxFailed`). The Windows key chord is the exception: its control logged the keyboard focus on the field itself before the independent chord, so its verdict stands.
- **Foreground, both:** every foreground cell except the accessibility press is refused with `ControlRequired` (8 on x11, 9 on Windows), which is the shipped answer when no person can approve foreground control.
- **Electron and web-view content is not reachable.** On x11 every Electron cell is refused `AxFailed`; on Windows the Electron window lists only its frame and a `Chrome Legacy Window`, and the x11 web-view window lists only its menu bar. The web content is absent from the accessibility tree in all three. Whether the fixture apps must turn renderer accessibility on, or the release cannot read it, is open and is being asked of the fixture apps' owner.

- **x11, its own finding class: the release's hit-test returns the root filler everywhere.** `elementAt` at the centre of the Press button, the Value field, the Scroll target and a list row returns the window's root `filler` with no title, before and after the window was raised (aim check of the hosted run at `bfdec3c9a9`, and every x11 pointer cell since). On X11 the release cannot resolve a point inside the GTK window to the element under it. This is separate from the delivery finding above. Every pointer cell now logs the answer as `hit_test=` and `hit_test_matches_target=`.
- **How a pixel cell is aimed.** The fixture apps do not report their widgets' screen geometry, so a pixel cell's point is the centre of the element the driver resolved from the tree the release itself returned, and the cell is sent only when that point is inside the window and inside the element's bounds. The release's hit-test answer never stops a cell; it is recorded.

### Control for the x11 "delivered but not received" class (rule fixed before its run)

Two elements of different kinds, each on a fresh fixture: the Press button (a click) and the Scroll target (a scroll). The release sends its element-routed background action; then `xdotool`, outside the tool, raises the window and acts at the same global point the element's bounds give; the bounds the release reported are logged beside the window geometry `xdotool` reads.

- `xdotool`'s action registers in the fixture: the point is right and the release's reported delivery was lost. The class becomes **verified by control**.
- `xdotool`'s action does not register: the bounds are off. The class stays **unclassified**.

Result: **verified by control** (both legs: independent 1 and 3, release 0 and 0). Reported on #9109, which describes this defect and had not reproduced it against a real application.

### Control for the Windows "delivered but not received" cells (rule fixed before its run)

Two legs, each on a fresh fixture: typing by pixel into the Value field, and the key chord `ctrl+k` to the Value field. The release sends its background action. Then `send-input.ps1`, outside the tool, sends input through `SendInput`: for typing it clicks the point the release aimed at and types `conformance`; for the chord it focuses the Value field by its accessible name and presses `ctrl+k`. The foreground window and the control holding keyboard focus are logged before the release acts and before each independent step, because a typed key goes to the focused control.

- The independent input registers in the fixture, `SendInput` reports every event sent, and the focus logged before it is the Value field in the fixture window: the input reached the control the release addressed, and the release's reported delivery was lost. The cell becomes **verified by control**.
- `SendInput` reports every event sent, the focus is the Value field, and the fixture still records nothing: the fixture does not take this input, so the cell is a **harness** finding, not the release's.
- `SendInput` sends fewer events than asked, or the focus is not the Value field: the control did not run as designed, and the cell stays **not controlled**.

### Control for the x11 key chord (rule fixed before its run)

One leg on a fresh fixture: the release focuses the Value field and sends its background chord `ctrl+k`. Then `xdotool`, outside the tool, raises the fixture window, logs the window that holds keyboard focus, and presses `ctrl+k`. The GTK fixture records chords at the window, so the input reaches the receiver the release addressed when the focused window is the fixture's.

- The independent chord registers and the focused window is the fixture's: the release's reported delivery was lost. The cell becomes **verified by control**.
- The focused window is the fixture's and the fixture still records nothing: the fixture does not take this input, a **harness** finding.
- The focused window is not the fixture's, or `xdotool` fails: the cell stays **not controlled**.

Result: not yet run.

### Windows control result

Result (hosted run at `2a52285478`): key chord **verified by control** (focus on the Value field, `SendInput` 4/4, independent `ctrl+k` recorded, release empty). Typing by pixel **not controlled**: the focus before the independent typing was the `Press` button, because the release's aim point is on the field's label.

Only the release's own answers about actions it attempted are recorded here. Failures caused by the test harness are not, nor are results that are still being checked.
