# senpi-desktop engine protocol

<!-- GENERATED from `src/methods.rs` by the `protocol_doc_is_fresh` test. Do not edit; regenerate with `SENPI_DESKTOP_UPDATE_SCHEMA=1 cargo test -p senpi-desktop-core`. -->

Protocol version `1`, ABI `senpi-desktop/1`. JSON-RPC 2.0, one JSON message per line (NDJSON) on stdio or a local socket. Requests carry a number or string `id` that the reply echoes verbatim; replies may arrive out of order. `$/cancel` is sent as a notification (no `id`). The machine-readable contract is [`schema/engine.schema.json`](../schema/engine.schema.json).

## Methods

`read` observes or only narrows what the engine may do; `exec` acts on the desktop or widens what the engine may do. Host-only methods are rejected by bridges such as `--oneshot`.

| Method | Effect | hostOnly | testOnly | Params | Result | Errors |
|---|---|---|---|---|---|---|
| `engine.hello` | read | no | no | `EmptyParams` | `HelloResult` | `ErrorCode` |
| `session.open` | exec | yes | no | `DesktopSessionOptions` | `SessionOpenResult` | `ErrorCode`; `-32601` hostOnly via a bridge |
| `session.close` | exec | yes | no | `EmptyParams` | `null` | `ErrorCode`; `-32601` hostOnly via a bridge |
| `capabilities` | read | no | no | `EmptyParams` | `DesktopCapabilities` | `ErrorCode` |
| `displays` | read | no | no | `EmptyParams` | `Vec<DesktopDisplay>` | `ErrorCode` |
| `windows` | read | no | no | `EmptyParams` | `Vec<DesktopWindow>` | `ErrorCode` |
| `capture` | read | no | no | `CaptureParams` | `CaptureResult` | `ErrorCode` |
| `click` | exec | no | no | `PointParams` | `null` | `ErrorCode` |
| `moveMouse` | exec | no | no | `PointParams` | `null` | `ErrorCode` |
| `drag` | exec | no | no | `DragParams` | `null` | `ErrorCode` |
| `scroll` | exec | no | no | `ScrollParams` | `null` | `ErrorCode` |
| `typeText` | exec | no | no | `TypeTextParams` | `null` | `ErrorCode` |
| `keyChord` | exec | no | no | `KeyChordParams` | `null` | `ErrorCode` |
| `raiseWindow` | exec | no | no | `RaiseWindowParams` | `null` | `ErrorCode` |
| `clipboard.read` | read | no | no | `EmptyParams` | `ClipboardText` | `ErrorCode` |
| `clipboard.write` | exec | no | no | `ClipboardText` | `null` | `ErrorCode` |
| `ax.snapshot` | read | no | no | `AxSnapshotParams` | `AxSnapshot` | `ErrorCode` |
| `ax.query` | read | no | no | `AxQueryParams` | `Vec<AxNode>` | `ErrorCode` |
| `ax.elementAt` | read | no | no | `AxElementAtParams` | `Option<AxNode>` | `ErrorCode` |
| `ax.focused` | read | no | no | `EmptyParams` | `Option<AxNode>` | `ErrorCode` |
| `ax.node` | read | no | no | `AxRefParams` | `AxNode` | `ErrorCode` |
| `ax.attributes` | read | no | no | `AxRefParams` | `Vec<(String, String)>` | `ErrorCode` |
| `ax.children` | read | no | no | `AxRefParams` | `Vec<AxNode>` | `ErrorCode` |
| `ax.parent` | read | no | no | `AxRefParams` | `Option<AxNode>` | `ErrorCode` |
| `ax.perform` | exec | no | no | `AxPerformParams` | `null` | `ErrorCode` |
| `ax.setValue` | exec | no | no | `AxSetValueParams` | `null` | `ErrorCode` |
| `ax.focus` | exec | no | no | `AxRefParams` | `null` | `ErrorCode` |
| `ax.click` | exec | no | no | `AxClickParams` | `null` | `ErrorCode` |
| `stopPath.start` | exec | yes | no | `StopPathStartParams` | `StopPathStatus` | `ErrorCode`; `-32601` hostOnly via a bridge |
| `stopPath.status` | read | no | no | `EmptyParams` | `StopPathStatus` | `ErrorCode` |
| `stopPath.heartbeat` | read | yes | no | `EmptyParams` | `null` | `ErrorCode`; `-32601` hostOnly via a bridge |
| `stopPath.stop` | read | no | no | `StopPathStopParams` | `StopPathStatus` | `ErrorCode` |
| `stopPath.resume` | exec | yes | no | `StopPathResumeParams` | `StopPathStatus` | `ErrorCode`; `-32601` hostOnly via a bridge |
| `$/cancel` | read | no | no | `CancelParams` | `null` | `ErrorCode` |
| `$/test.advanceClock` | exec | no | yes | `AdvanceClockParams` | `null` | `ErrorCode`; `-32601` testOnly without `SENPI_DESKTOP_FAKE_CLOCK=1` |

## Notifications

| Notification | Params |
|---|---|
| `audit` | `AuditEvent` |
| `stopPath.changed` | `StopPathStatus` |
| `engine.log` | `EngineLog` |

## Errors

An engine error is `{code, message, data: {code: <ErrorCode>, hint}}`. A method-level rejection is the standard `-32601 Method not found` with `data: {reason: "unknown" | "hostOnly" | "testOnly"}`. Malformed input uses the standard `-32700`, `-32600`, and `-32602`.

| ErrorCode | JSON-RPC code |
|---|---|
| `PermissionDenied` | `-32000` |
| `CaptureFailed` | `-32001` |
| `InputFailed` | `-32002` |
| `BackgroundUnavailable` | `-32003` |
| `WindowNotFound` | `-32004` |
| `InvalidTarget` | `-32005` |
| `InvalidKey` | `-32006` |
| `InvalidCoordinateFrame` | `-32007` |
| `StaleRef` | `-32008` |
| `AxUnsupported` | `-32009` |
| `AxFailed` | `-32010` |
| `Timeout` | `-32011` |
| `Closed` | `-32012` |
| `Internal` | `-32013` |
| `StopPathUnavailable` | `-32014` |
| `Suspended` | `-32015` |
| `ScreenLocked` | `-32016` |
| `Cancelled` | `-32017` |
| `CursorRestoreFailed` | `-32018` |
| `FocusRestoreFailed` | `-32019` |
| `TransactionFailed` | `-32020` |

## Conformance corpus

`fixtures/conformance/*.json` hold ordered steps replayed against the engine over the fake backend: `{description, scenario, env, steps: [{send, expect: [{message, variable}]}]}`. `scenario` is the fake-backend scenario path (`SENPI_DESKTOP_BACKEND=fake:<scenario>`), `env` the extra engine environment. Each step sends one message; `expect` lists every message the engine emits for that step, in any order. `variable` holds JSON pointers into `message` whose values are not compared (versions, tokens, paths, image bytes, prose). The `conformance_fixtures_match_schema` test validates every message against the schema.
