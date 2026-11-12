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
- **x11, native: a delivered pointer action the application never received.** Six background cells (click by accessibility, click by pixel, type by pixel, scroll both ways, pixel drag) report delivery while the fixture's state does not change, after a 3-second wait for it to settle. On the same element in the same run, an accessibility press is delivered and the fixture does record it, and on Windows the same click is delivered and recorded. So the element, the fixture and the oracle all work: on X11 the release reports delivery of synthetic pointer input the application did not receive.
- **Windows, native: two more of the same.** Typing by pixel and a key chord report delivery while the fixture records no text and no keys.
- **Windows, native:** a background pixel drag in the list is refused with `InputFailed`; the accessibility value write is refused with `AxFailed`; background typing through accessibility is refused with `AxUnsupported`.
- **x11, native:** the accessibility value write and the key chord are refused with `AxFailed`; background typing through accessibility is refused with `AxUnsupported`.
- **Foreground, both:** every foreground cell except the accessibility press is refused with `ControlRequired` (8 on x11, 9 on Windows), which is the shipped answer when no person can approve foreground control.
- **Electron and web-view content is not reachable.** On x11 every Electron cell is refused `AxFailed`; on Windows the Electron window lists only its frame and a `Chrome Legacy Window`, and the x11 web-view window lists only its menu bar. The web content is absent from the accessibility tree in all three. Whether the fixture apps must turn renderer accessibility on, or the release cannot read it, is open and is being asked of the fixture apps' owner.

Only the release's own answers about actions it attempted are recorded here. Failures caused by the test harness are not, nor are results that are still being checked.
