# omo-computer engine protocol

Generated from `crates/omo-computer-core/src/methods/table.rs`; do not edit by hand.
Regenerate with `OMO_COMPUTER_UPDATE_SCHEMA=1 cargo test -p omo-computer-core`.

JSON-RPC 2.0, one object per line (NDJSON), UTF-8. Protocol version `"1"`, ABI `omo-computer/1` (compared by major).
`engine.hello` is the first frame on every connection. Schema: `schema/engine.schema.json`.

A one-shot call names a method with the `desktop.` prefix (`desktop.click` calls `click`).
The one-shot `desktop.stop` calls `stopPath.stop`.

## Methods

| method | effect | exposure | params | result |
|---|---|---|---|---|
| `engine.hello` | read | public | `EmptyParams` | `Hello` |
| `session.open` | read | hostOnly(session) | `SessionOpenParams` | `SessionOpened` |
| `session.close` | read | hostOnly(session) | `EmptyParams` | `()` |
| `capabilities` | read | public | `EmptyParams` | `CapabilitiesReply` |
| `displays` | read | public | `EmptyParams` | `Vec<DisplayInfo>` |
| `windows` | read | public | `WindowsParams` | `WindowsReply` |
| `apps.list` | read | public | `EmptyParams` | `Vec<AppInfo>` |
| `pointer` | read | public | `EmptyParams` | `PointerPosition` |
| `diagnose` | read | public | `EmptyParams` | `Diagnosis` |
| `capture` | read | public | `CaptureParams` | `CaptureReply` |
| `zoom` | read | public | `ZoomParams` | `Frame` |
| `observe` | read | public | `ObserveParams` | `ObserveReply` |
| `ax.snapshot` | read | public | `AxTargetParams` | `AxSnapshotText` |
| `ax.drill` | read | public | `DrillParams` | `Observation` |
| `ax.node` | read | public | `AxRefParams` | `AxNode` |
| `ax.children` | read | public | `AxRefParams` | `Vec<AxNode>` |
| `ax.focused` | read | public | `EmptyParams` | `Option<AxNode>` |
| `elementAt` | read | public | `ElementAtParams` | `Option<ElementInfo>` |
| `waitFor` | read | public | `WaitForParams` | `WaitResult` |
| `clipboard.read` | read | public | `EmptyParams` | `ClipboardContent` |
| `menu.items` | read | public | `MenuItemsParams` | `MenuItems` |
| `surface` | read | public | `SurfaceParams` | `Surface` |
| `click` | exec | public | `ClickParams` | `ExecReply` |
| `move` | exec | public | `MoveParams` | `ExecReply` |
| `mouse.down` | exec | public | `MouseDownParams` | `ExecReply` |
| `mouse.up` | exec | public | `MouseUpParams` | `ExecReply` |
| `key.down` | exec | public | `KeyDownParams` | `ExecReply` |
| `key.up` | exec | public | `KeyUpParams` | `ExecReply` |
| `drag` | exec | public | `DragParams` | `ExecReply` |
| `type` | exec | public | `TypeParams` | `ExecReply` |
| `press` | exec | public | `PressParams` | `ExecReply` |
| `paste` | exec | public | `PasteParams` | `ExecReply` |
| `scroll` | exec | public | `ScrollParams` | `ExecReply` |
| `typeText` | exec | public | `TypeTextParams` | `ExecReply` |
| `keyChord` | exec | public | `KeyChordParams` | `ExecReply` |
| `holdKeys` | exec | public | `HoldKeysParams` | `ExecReply` |
| `holdMouse` | exec | public | `HoldMouseParams` | `ExecReply` |
| `raiseWindow` | exec | public | `RaiseWindowParams` | `ExecReply` |
| `ax.setValue` | exec | public | `AxSetValueParams` | `ExecReply` |
| `ax.perform` | exec | public | `AxPerformParams` | `ExecReply` |
| `ax.focus` | exec | public | `AxRefParams` | `ExecReply` |
| `ax.typeText` | exec | public | `AxTypeTextParams` | `AxTypeTextReply` |
| `ax.selectText` | exec | public | `SelectTextParams` | `ExecReply` |
| `menu.select` | exec | public | `MenuSelectParams` | `ExecReply` |
| `apps.open` | exec | public | `AppsOpenParams` | `ExecReply` |
| `apps.quit` | exec | public | `AppsQuitParams` | `ExecReply` |
| `window.raise` | exec | public | `WindowParams` | `ExecReply` |
| `window.activate` | exec | public | `WindowParams` | `ExecReply` |
| `window.setFrame` | exec | public | `WindowFrameParams` | `ExecReply` |
| `window.minimize` | exec | public | `WindowParams` | `ExecReply` |
| `window.restore` | exec | public | `WindowParams` | `ExecReply` |
| `clipboard.write` | exec | public | `ClipboardWriteParams` | `ExecReply` |
| `openSystemSurface` | exec | public | `OpenSystemSurfaceParams` | `ExecReply` |
| `control.grant` | exec | hostOnly(authority) | `ControlGrantParams` | `ControlState` |
| `control.revoke` | exec | hostOnly(authority) | `EmptyParams` | `()` |
| `control.acquire` | exec | hostOnly(authority) | `EmptyParams` | `ControlState` |
| `control.release` | read | hostOnly(session) | `EmptyParams` | `()` |
| `display.release` | exec | hostOnly(session) | `EmptyParams` | `()` |
| `display.resume` | exec | hostOnly(session) | `EmptyParams` | `()` |
| `preview.subscribe` | read | hostOnly(session) | `EmptyParams` | `()` |
| `stopPath.start` | exec | hostOnly(authority) | `StopPathStartParams` | `StopPathStatus` |
| `stopPath.status` | read | public | `EmptyParams` | `StopPathStatus` |
| `stopPath.heartbeat` | read | hostOnly(session) | `EmptyParams` | `()` |
| `stopPath.stop` | read | public | `StopPathStopParams` | `StopPathStatus` |
| `stopPath.resume` | exec | hostOnly(authority) | `StopPathResumeParams` | `StopPathStatus` |
| `desktop.shutdown` | exec | hostOnly(authority) | `EmptyParams` | `()` |
| `$/cancel` | read | public | `CancelParams` | `()` |
| `$/test.advanceClock` | exec | testOnly | `AdvanceClockParams` | `()` |

## Environment seams

No other `OMO_COMPUTER_*` variable is read; a fake-only seam with a real backend refuses the launch.

| variable | read | fake only | purpose |
|---|---|---|---|
| `OMO_COMPUTER_BACKEND` | launch | no | selects the backend; `fake` admits the fake-only seams |
| `OMO_COMPUTER_FAKE_CLOCK` | launch | yes | installs the fake clock |
| `OMO_COMPUTER_FAKE_STOP_PATH` | launch | yes | scripts the fake stop listener |
| `OMO_COMPUTER_FAKE_SCENARIO` | launch | yes | selects the fake backend's scenario file |
| `OMO_COMPUTER_RUNTIME_DIR` | launch | yes | moves the marker and stop files into a test directory |
| `OMO_COMPUTER_DISABLE_SKYLIGHT` | launch | no | turns the macOS SkyLight capture route off |
| `OMO_COMPUTER_UPDATE_SCHEMA` | test | no | rewrites the generated schema and protocol doc |
| `OMO_COMPUTER_CONFORMANCE_DIR` | test | no | points the conformance replay at a fixture directory |
| `OMO_COMPUTER_BUILD_SHA` | build-time | no | the commit the engine was built from |

## Settings (`session.open{settings}`)

| key | status | reader | admission key |
|---|---|---|---|
| `computer.enabled` | keep | tool registration | no |
| `computer.display` | keep | session.open: display selector | no |
| `computer.stop_hotkey` | keep | session.open: stop listener chord | yes |
| `computer.allow_host_relay_only_stop` | keep | session.open: StopPolicy.allowHostRelayOnly | yes |
| `computer.audit_log` | keep | session audit writer | no |
| `computer.screenshot_gc` | keep | artifact GC | no |
| `computer.engine_path` | keep | engine locator (acquire source, identity-checked) | no |
| `computer.send_on_enter` | new | session.open: send-on-enter composer guard | yes |
| `computer.url_policy` | new | session.open: Consequential gate URL read | yes |
| `computer.run_limits` | new | QuickJS run cell ceilings | no |
| `computer.record` | new | per-run recording writer | yes |
| `computer.pause_ceiling_ms` | new | mutate admission: deadline pause | no |
| `computer.display_awake_grace_ms` | new | session.open: display-awake hold | no |
| `computer.display_awake_session_cap_ms` | new | session.open: display-awake hold | no |
| `computer.x11_keymap_remap` | new | session.open: X11 backend keymap remap | yes |
| `computer.background_indicator` | new | hand host presence surface | yes |
| `computer.max_width` | keep | capture policy | no |
| `computer.max_height` | keep | capture policy | no |
| `computer.screenshot_max_bytes` | keep | capture policy | no |
| `computer.cua_adapter` | keep | tool registration: CUA adapter | no |
| `computer.default_hand` | new | tool dispatcher: hand selector | no |
| `computer.mcp.tier` | new | --mcp host adapter consent view | no |
| `computer.intervention` | keep | session.open: intervention policy | yes |
| `computer.macos_key_priming` | keep | session.open: macOS key priming | no |
| `computer.trace` | keep | session.open: trace writer | no |
| `computer.remote_commands` | new | hand host admission | yes |
| `computer.foreground_input_lock` | new | presence surface: input lock | yes |
| `computer.x11_mpx` | new | session.open: X11 MPX route | yes |
| `computer.wayland_persist_consent` | new | Wayland backend: portal token | no |
| `computer.capture_on_open` | new | session.open: Wayland capture open | no |
| `computer.ssh_hosts` | new | brain-side SDK: ssh pipe | no |
| `computer.fleet.maxInFlight` | new | brain-side SDK: fanout concurrency | no |
| `computer.fleet.frameBytesPerMin` | new | brain-side SDK: fanout frame budget | no |
| `computer.fleet.perHandFramesPerSec` | new | brain-side SDK: fanout frame rate | no |
| `computer.fleet.maxImagePartsPerResult` | new | brain-side SDK: fanout image parts | no |
| `computer.wayland_lease_end_chord` | new | session.open: Wayland lease-end chord | yes |
| `computer.linux_display_server` | new | session.open: Linux backend selection | no |
| `computer.toolkit_routes` | new | session.open: route table loader | yes |
| `computer.artifact_max_bytes` | new | session.open: artifact GC cap | no |
| `computer.artifact_max_files` | new | session.open: artifact GC cap | no |
| `computer.artifact_release_after_fetch` | new | brain-side SDK: artifact release | no |
| `computer.capture_policy` | new | SDK capture policy | no |
| `computer.app_scope` | new | session.open: per-app scope | yes |
| `computer.preview` | new | host preview consumer | no |
| `computer.runtime` | migration-only | runtime loader (legacy \| v3) | no |
| `computer.operation_timeout_ms` | moved-from-env | session.open: operation deadline | no |
| `computer.close_timeout_ms` | moved-from-env | session.open: close budget | no |
| `computer.capture_helper_signed` | moved-from-env | session.open: macOS capture helper trust | no |
