# Conformance fixture apps

The apps the conformance catalog (`../catalog.ts`) and the model-free task set (`../taskset/tasks.ts`) run against: a
native toolkit app, an Electron app and a web-view app on each of Linux, Windows and macOS. Each holds the widgets every catalog action needs, in the window
"Conformance Document"; File > New Window opens "Conformance Document 2". A window is selected by TITLE, never by the
app display name, so the title carries the app's name and the display name does not matter.

| directory | toolkit | built with | hosted job |
|---|---|---|---|
| `native-linux/` | GTK 3 through PyGObject, AT-SPI on | `apt-get install python3-gi gir1.2-gtk-3.0 at-spi2-core` | `fixture native-linux (ubuntu-26.04)` |
| `native-windows/` | WinForms | the in-box .NET Framework C# compiler (`build.ps1`) | `fixture native-windows (windows-latest)` |
| `native-macos/` | AppKit app bundle | the image's `swiftc` (`build.sh`) | `fixture native-macos (macos-15)` |
| `electron/` | Electron 45.3.1 around `web/` | one pinned release fetched by the job | `fixture electron (ubuntu-26.04)`, `fixture electron (windows-latest)`, `fixture electron (macos-15)` |
| `webview/` | WebKitGTK 4.1 in a GTK 3 window around `web/` | `apt-get install gir1.2-webkit2-4.1` | `fixture webview (ubuntu-26.04)` |
| `webview-macos/` | WKWebView around `web/`, app bundle | the image's `swiftc` (`build.sh`) | `fixture webview (macos-15)` |
| `webview-windows/` | WebView2 around `web/` | the in-box C# compiler with the WebView2 SDK 1.0.4314.35 (NuGet, checked by digest; it ships only as a package) | `fixture webview (windows-latest)` |

The Linux image carries Xvfb and Tk but no GTK bindings, and Tk exports no AT-SPI tree, so the accessibility cells
could not be delivered on it; that is why the Linux apps install GTK. Every install retries three times and a failure is
reported as an ENVIRONMENT failure in the job summary, never as a fixture failure.

## App keys

A task that targets an app reads `windows()`, matches the app key and selects the window by id. Each app has one stable
key, the same string on every OS, and reports it in `appKey`:

| app | key | macOS (bundle id) | X11 (WM_CLASS class) and Wayland (app_id) | Windows (AUMID) |
|---|---|---|---|---|
| native | `dev.omo.conformance-fixture.native` | `Info.plist`, read back from the bundle | `Gdk.set_program_class` and `GLib.set_prgname`, class read back | `SetCurrentProcessExplicitAppUserModelID`, read back |
| electron | `dev.omo.conformance-fixture.electron` | the job copies `Electron.app`, sets the id and re-signs it ad hoc; read back from `Info.plist` | Chromium's `--class` switch; Electron cannot read it back, so the set value is reported | `app.setAppUserModelId`; reported as set |
| webview | `dev.omo.conformance-fixture.webview` | `Info.plist`, read back from the bundle | as native | as native |

The self-test takes the expected key (`--app-key`) and fails when the report differs.

## Report

Each app writes its state to the path given by `--report <path>` after every change, by a write to a temporary file and
a rename. The shape is the same on every OS (`fixture-report.ts`, schema `omo-conformance-fixture/1`):

- `windows`: the title of every open window, read from the toolkit itself.
- `fields`: the catalog oracle fields (`value`, `receivedKeys`, `pressCount`, `scrollSteps`, `dragOrder`,
  `menuSelection`), read live from the window "Conformance Document".
- `saved`: the task-set oracle fields at the last File > Save of that window, plus `savedDocuments`, the number of
  windows saved.

The app never judges itself. A driver copies the reported field into `oracle.observed`, and `../report.ts` compares it.

| catalog action | widget |
|---|---|
| `click`, `ax.perform` | button "Press" |
| `typeText`, `ax.setValue` | text field "Value" |
| `keyChord` | the window (a chord with Ctrl, Alt or Super) |
| `scroll` | region "Scroll target" (one wheel notch is one step) |
| `drag` | list "Order" with rows a, b, c |
| `menu.select` | menu item Test > Conformance |

## Self-test

`self-test.ts` starts an app and drives it through its stdin control lines (`poke <action>`, `set <label> <text>`,
`menu <A>/<B>`, `quit`), which apply each change through the toolkit itself and need no engine. Each catalog action must
change exactly its own field, File > Save must record the document, two identical runs must write the same report, and
the app must report the windows it opened and the app key given by `--app-key`.

The web-hosting apps (Electron and the web views) also get `--a11y <probe command with {pid}>`, which adds two legs:

- `a11y:controls-visible` runs the probe against the app's pid and fails when the page's controls are missing from the
  OS accessibility tree.
- `hermetic:no-profile-data-left` runs last. It fails when any leg of the run left fixture or Electron data in a user
  profile or temp location (`.config`, `.local/share`, `.cache`, `~/Library/{Application Support,WebKit,Caches,
  HTTPStorages,Saved Application State,Preferences}`, `%APPDATA%`, `%LOCALAPPDATA%`, the temp directory), counted
  against a snapshot taken before the first leg, so a folder with the same name on every run is caught too.

The driver passes `CONFORMANCE_FIXTURE_DATA_DIR`, a directory inside the run's own folder that it removes with the run;
the Electron app keeps its profile there. Without it the Electron app makes its own temporary profile and removes it on
quit.

With `--sabotage <target>` the self-test passes only if it turns red on that target's checks and nowhere else. A
report field as the target makes the app pin that field to its initial value; the target `a11y` makes the page hide its
controls from assistive technology, so the probe must go red. The hermetic leg does not run under a sabotage.

```sh
bun script/qa/computer/conformance/fixtures/self-test.ts --fixture <name> --app-key <key> [--sabotage <target>] \
  [--a11y <probe command with {pid}>] -- <app command>
```

GUI code runs only on hosted runners or owned guests, never in a person's session.

## macOS

The hosted `macos-15` job is the build and self-test proof: the fixture posts no events, so it needs no grant there. The
live cells, which drive the app through the engine, run on the owned macOS 15 and macOS 26 guests, because a pid-routed
click does nothing on hosted macOS runners. No such guest exists yet, so until one does the macOS live cells are recorded
as drops, not as passes or failures.
