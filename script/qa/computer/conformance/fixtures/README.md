# Conformance fixture apps

The apps the conformance catalog (`../catalog.ts`) and the model-free task set (`../taskset/tasks.ts`) run against: a
native toolkit app per OS, an Electron app and a web-view app. Each is the app "Conformance Fixture" with the window
"Document", and each holds the widgets every catalog action needs.

| directory | toolkit | built with | hosted job |
|---|---|---|---|
| `native-linux/` | GTK 3 through PyGObject, AT-SPI on | `apt-get install python3-gi gir1.2-gtk-3.0 at-spi2-core` | `fixture native-linux (ubuntu-26.04)` |
| `native-windows/` | WinForms | the in-box .NET Framework C# compiler (`build.ps1`) | `fixture native-windows (windows-latest)` |
| `native-macos/` | AppKit app bundle | the image's `swiftc` (`build.sh`) | `fixture native-macos (macos-15)` |
| `electron/` | Electron 45.3.1 around `web/` | one pinned release fetched by the job | `fixture electron (ubuntu-26.04)`, `fixture electron (windows-latest)` |
| `webview/` | WebKitGTK 4.1 in a GTK 3 window around `web/` | `apt-get install gir1.2-webkit2-4.1` | `fixture webview (ubuntu-26.04)` |

The Linux image carries Xvfb and Tk but no GTK bindings, and Tk exports no AT-SPI tree, so the accessibility cells
could not be delivered on it; that is why the Linux apps install GTK. Every install retries three times and a failure is
reported as an ENVIRONMENT failure in the job summary, never as a fixture failure.

## Report

Each app writes its state to the path given by `--report <path>` after every change, by a write to a temporary file and
a rename. The shape is the same on every OS (`fixture-report.ts`, schema `omo-conformance-fixture/1`):

- `fields`: the catalog oracle fields (`value`, `receivedKeys`, `pressCount`, `scrollSteps`, `dragOrder`,
  `menuSelection`), read live from the window "Document".
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
change exactly its own field, File > Save must record the document, and two identical runs must write the same report.
With `--sabotage <field>` the app pins that field to its initial value, and the self-test passes only if it turns red on
that field's checks and nowhere else.

```sh
bun script/qa/computer/conformance/fixtures/self-test.ts --fixture <name> [--sabotage <field>] -- <app command>
```

GUI code runs only on hosted runners or owned guests, never in a person's session.

## macOS

The hosted `macos-15` job is the build and self-test proof: the fixture posts no events, so it needs no grant there. The
live cells, which drive the app through the engine, run on the owned macOS 15 and macOS 26 guests, because a pid-routed
click does nothing on hosted macOS runners. No such guest exists yet, so until one does the macOS live cells are recorded
as drops, not as passes or failures.
