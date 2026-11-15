# The `computer` tool

The OmO Native computer-use component registers a search-exposed `computer` tool and, after activation, a `computer` global in JavaScript and Python eval kernels. For setup, stop paths, platform limits and permissions, see [Computer use](../guide/computer-use.md).

> **Experimental.** Computer use is experimental support. The tool contract below may change between releases.

## Source of the contract

- Component registration, session lifecycle and resource discovery: `packages/omo-senpi/src/components/computer-use/index.ts`
- Typed native-only configuration: `packages/omo-config-core/src/schema/computer.ts`
- Tool actions and validation: `packages/senpi-desktop-tool/src/tool.ts`, `packages/senpi-desktop-tool/src/params.ts`
- Size caps, action reports and failure codes: `packages/senpi-desktop-tool/src/payload-caps.ts`, `packages/senpi-desktop-tool/src/action-reports.ts`, `packages/senpi-desktop-tool/src/cua-errors.ts`
- User command and permission tiers: `packages/senpi-desktop-tool/src/command.ts`, `packages/senpi-desktop-tool/src/permission.ts`
- Eval facade and model-facing guidance: `packages/senpi-desktop-prelude/src/prelude.js`, `packages/senpi-desktop-prelude/src/prelude.py`
- Engine client, call budget and protocol: `packages/senpi-desktop-service/src`, `packages/senpi-desktop-protocol/src`
- Standalone SDK: `packages/senpi-desktop-sdk/src`
- Engine and platform backends: `crates/senpi-desktop-engine`, `crates/senpi-desktop-backend-macos`, `crates/senpi-desktop-backend-x11`, `crates/senpi-desktop-backend-wayland`, `crates/senpi-desktop-backend-win32`

## Actions

| `action` | Parameters | Result |
|----------|------------|--------|
| `call` | `chain`: a desktop helper `{ method, args? }`, optionally followed by one window or element method | The helper's result; a screenshot also returns image content |
| `capabilities` | None | Backend, capture/input/AX permissions, stop path and focus guard |
| `close` | None | Ends the desktop session |

For example, `{ "action": "call", "chain": [{ "method": "screenshot" }] }` captures the desktop, and a later `call` of `click` uses a coordinate from that frame. Screenshots are limited to a coordinate-safe size when passed to a model; a stale frame is rejected with `InvalidCoordinateFrame`.

## Eval helpers

Computer use has no code cell of its own. Desktop control is a set of functions on the `computer` global of the JavaScript and Python eval kernels, and each helper is one `computer` tool call (`action: "call"`, or `capabilities` / `close`). A multi-step task is an eval cell that awaits one helper per step, so each step gets its own permission check, its own audit records and its own result. In Python the helpers are synchronous and take the same names; keyword arguments become the trailing options object.

A helper that only reads (a screenshot, a window list, an accessibility tree, a clipboard read) resolves to its value. A helper whose call sent input resolves to an object:

| Field | Meaning |
|-------|---------|
| `value` | The helper's own return value (`undefined` for most input helpers) |
| `report` | The action report of the last input action the call sent (see [Action reports](#action-reports)) |
| `reports` | Every action report of the call, in send order; `[report]` when it sent one |
| `auditIds` | The engine audit ids of those reports, in send order |
| `toolCallId` | The id of the tool call that sent the input; the call's audit records carry the same id |

A screenshot a helper takes is displayed in the cell output as the call finishes, in call order, unless the helper was called with `silent: true`. A call that fails displays nothing: the helper throws before it reaches the call's images. A refused or failed call throws: in JavaScript an `Error`, in Python a `RuntimeError`, whose message is the tool's text. For the failures the tool returns as structured results, the error also carries `error.code`, the `COMPUTER_*` code: the size caps and call budget below, a missing launch context, and the engine codes `PermissionDenied`, `ControlRequired`, `InputBusy`, `Suspended` and `StaleRef` (for example `COMPUTER_CONTROL_REQUIRED`). Any other engine failure throws with the engine's message only; its `data` fields (`reason`, `disposition`, `delivered`, `nextCall`) reach SDK and host programs, not the cell.

A helper that resolves has sent its input, so its `report.disposition` reads `delivered_unverified` or `delivered_verified` and `retry` is `unsafe`: the cell reads the target back rather than sending the same input again. A cell can branch on what came back:

```js
const doc = await computer.window({ app: "TextEdit" })
try {
  const typed = await doc.type("Quarterly report", { delivery: "foreground" })
  // Sent: never type it again; read the window back when it was not confirmed.
  if (typed.report.disposition.delivery !== "delivered_verified") await doc.observe()
} catch (error) {
  // Refused before anything was sent: ask for the grant, then try again.
  if (error.code !== "COMPUTER_CONTROL_REQUIRED") throw error
  await computer.control.acquire({ reason: "type the report title" })
}
```

## Tool boundary

The desktop service executes no model-written code. A `call` chain and a `computer_actions` batch run as data: each step names a facade method, the chain's methods are classified before anything starts, and an unknown or unchainable method is refused. Arguments cross as JSON; a helper refuses a function or `RegExp` argument instead of letting it vanish. A call classified `computer:read` can send no input: a method that would is refused with `read-only call: '<method>' sends input, which needs the exec tier` before any request is sent. The boundary also enforces three limits:

| Limit | What happens past it |
|-------|----------------------|
| Input of a `computer` or `computer_actions` call: 1 MiB of UTF-8 JSON | Refused with `COMPUTER_ARGUMENTS_TOO_LARGE` before anything starts; send the data in smaller calls |
| A helper's return value: 8 MiB of UTF-8 JSON | The value is replaced by a `COMPUTER_RESULT_TOO_LARGE` failure. The call has already run, and any input it sent is not undone. The failure result still carries the call's screenshots, but an eval helper throws on the failure before displaying them, so a cell sees none of them |
| 20,000 desktop requests per agent session (one desktop service each) | Every further request is refused with `COMPUTER_CALL_BUDGET_EXCEEDED` and nothing is sent. The service raises the typed `DesktopCallBudgetError` (`reason: "CallBudgetExceeded"`, `limit`); the tool turns it into that code, with the hint to stop and tell the user, because only the user can start a fresh budget. One helper can send more than one request (a window lookup, then a click), and `capabilities` counts too. Only the user's `/computer off` resets the count (then `/computer on` to continue); the model's `computer.close()` closes the desktop session but leaves the budget spent |

Every audit record a call returns carries the session id and the call's `toolCallId`. Before a call that sent requests returns, it waits for the audit records of every one of them, so its `details.audit` always includes its own last action; that wait stays within the call's deadline and stops when the call is aborted, and a wait cut short fails the call.

A call whose desktop steps fail or are interrupted (an engine error, the call's timeout, an abort) revokes the foreground control grant, so the next foreground action asks the human again. A refusal at the boundary (`COMPUTER_ARGUMENTS_TOO_LARGE`, `COMPUTER_RESULT_TOO_LARGE`) and a failed `capabilities` action leave the grant in place. Beyond that, the grant is revoked when the agent's turn ends and when the session shuts down.

## Result envelope

Every `computer` result has text `content` (plus image content for a screenshot) and a `details` object (`ComputerToolDetails` in `packages/senpi-desktop-tool/src/tool.ts`):

| `details` field | Meaning |
|-----------------|---------|
| `value` | The helper's return value; on a failure, the failure itself (`code`, `message`) |
| `readOnly` | Whether the call ran in the `computer:read` tier |
| `screenshots` | Screenshots taken during the call, with their frame and artifact path |
| `audit` | The audit records of the mutating actions the call sent, each tagged with the session id and `toolCallId` |
| `toolCallId` | The tool call these details belong to |
| `report` | The action report of the last input action the call sent; absent when it sent none |
| `reports` | Every action report in send order, present when the call sent more than one input action |
| `auditIds` | The engine audit ids of every report, in send order; present with `report` |
| `isError` | `true` on a structured failure; `value` then holds the failure |

### Action reports

An OmO Native session opens the engine with `reportMode: "object"` whenever the engine's `engine.hello` lists the `action-report` feature, so each input action answers with an action report instead of `null`:

| Report field | Meaning |
|--------------|---------|
| `disposition` | Whether input reached the target and whether the same action may be sent again (below) |
| `delivered` | `{ count, of }` characters, keys or steps delivered out of those requested; `null` when the engine does not count |
| `effect` | `confirmed`, `unverifiable` or `no_change` (a read-back showed nothing changed); `refused` appears only in SDK batch reports |
| `route` | `ax`, `background_window`, `background_pid` or `foreground_hid` |
| `hit` | The element under the point before sending (`role`, `label`); `label` is `null` for a secure field, and a label over 256 characters is cut and ends `[truncated]` |
| `focusRestoration` | `not_needed`, `restored`, `user_moved_on` or `not_confirmed` |
| `openedSurfaces` | Sheets, dialogs, menus, popovers or windows the action opened; a title over 256 characters is cut and ends `[truncated]` |
| `note`, `warning` | `warning` is an open token set, in this release only `secure_field`: the action typed into a secure text field, whose value is never read back. `note` is reserved and always `null` in this release |
| `nextCall` | Always `null` in a report: a report describes input that was sent. The suggested next step of a refusal is the engine error's `data.nextCall` (see [Error codes](#error-codes)) |
| `auditIds` | Ids of the audit events the action emitted |
| `timings` | Always `null` at the tool; per-stage timings are written to the trace file when `computer.trace` is on |
| `legacy` | `true` when the engine replied `null` (an engine without `action-report`); the report then reads `delivered_unverified` / `unsafe` with `effect: "unverifiable"` |

`details.report` and `details.reports` hold the reports of actions that succeeded. A failed action has no entry there: its disposition, delivered count, focus restoration and next step arrive in the engine error's `data`.

### Dispositions

`disposition` is one `{ delivery, retry }` pair, carried by every action report and, in an object-mode session, by every engine error's `data.disposition`. `retry` answers one question only: can the same input be sent again without being duplicated.

| `delivery` | `retry` | What to do |
|------------|---------|------------|
| `not_delivered` | `safe` | Nothing was sent; the action may be sent again (fix the arguments first when the error names an argument) |
| `not_delivered` | `after_user` | Nothing was sent; wait for the user (resume, grant, unlock, consent) before trying again |
| `delivery_uncertain` | `unsafe` or `unknown` | The input may have landed; read the target back before anything else |
| `delivered_unverified` | `unsafe` | Sent but not confirmed; read back, and when `delivered` is present send only the remainder |
| `delivered_verified` | `unsafe` | Sent and confirmed; never repeat it |
| `unknown` | `unknown` | The engine cannot tell (an internal error, a restart mid-action); observe from scratch |

A successful action always reads `delivered_unverified` or `delivered_verified`; the other rows come with an error. The SDK's `ComputerError.nothingSent` is `true` exactly when `delivery` is `not_delivered`. The model's helper reference says that input helpers resolve with a report and that `report.disposition.retry` tells whether sending the same input again is safe; this table is not part of what the model reads.

## Permission classification

`capabilities` and inspection-only `call` chains use `computer:read`. `close`, other calls, unknown methods and malformed inputs use `computer:exec`. The host checks the tier before the engine receives an action, so an exec-denied click is not audited as an engine click. Rules may target the entire `computer` tool or the `computer:read` and `computer:exec` tiers. An approval for read never approves exec.

## Coordinates and delivery

Pointer coordinates refer to the latest screenshot of the same target, while accessibility coordinates are global desktop coordinates. Each accessibility snapshot changes the reference generation; old refs fail with `StaleRef`.

Scroll amounts (`dx`/`dy` of `scroll`, and `scroll_x`/`scroll_y` of `computer_actions`) are pixels, the same unit on every OS. macOS posts them as pixel scroll events; Windows and X11 send one wheel notch per 40 px (rounded, at least one), and Wayland sends 120ths of a notch at the same rate. So `dy: 120` scrolls about three notches everywhere. A positive `dy` moves the view toward the end of the content and a positive `dx` toward its right edge, whatever the natural-scrolling setting.

Input defaults to background delivery when supported. On macOS it leaves the frontmost app, its focused window, the cursor and the destination of the user's next keystroke unchanged, but a clicked target window may rise directly under the user's front window. Foreground delivery uses a focus guard to restore the previous window and cursor; restoration failures are reported instead of hidden. A stop chord, screen lock, lost stop path or missing OS permission refuses input before a backend action.

Foreground delivery also needs this session's live control grant. The host asks the human to confirm, then calls `control.grant { reason, confirmationId }` (host-only); `control.revoke` releases it, `session.close` and a stop chord revoke it too, and `stopPath.resume` never restores it. At most one session of the process holds the grant; another session's grant is refused `InputBusy`, never stolen. `control.state` (public) reports `{ active, reason?, grantedAt? }`. An omitted delivery stays background, except that pointer and keyboard input on the `desktop` or a `display:*` target (click, moveMouse, drag, scroll, typeText, keyChord, holdKeys, holdMouse) always needs the grant: every backend posts it globally, onto the user's real pointer and frontmost app, so the engine admits it by its effect rather than the requested delivery (#10788). In full access the OmO host takes the grant itself, without a confirm and in non-interactive runs too, and revokes it once the session leaves full access. `raiseWindow` (`win.raise()`) always needs the grant, because raising a window always takes the user's foreground; this is deliberately stricter than upstream oh-my-pi, which gates only takeover input.

On macOS the engine keeps the display awake while the agent operates: the first request other than `capabilities`, `control.state` and `stopPath.*` takes a `PreventUserIdleDisplaySleep` power assertion, listed by `pmset -g assertions` as "OmO computer use is operating the desktop", and it lasts until 60 seconds after the last such request finished. `session.close`, a disconnect and a stop release it at once. `capabilities.displayAsleep` is true when every display the session can capture is asleep; the screen lock still refuses input with `ScreenLocked`.

## Error codes

A failed call carries one engine error code (`crates/senpi-desktop-core/src/error.rs`), and some codes also carry a `data.reason` naming the cause (for example `consumed` for `InvalidCoordinateFrame`; the tokens are under [Error reasons](#error-reasons)); the tool's recovery hint follows that reason when it knows it. In an object-mode session the error also carries `data.disposition`, `data.delivered` when part of the input was sent, `data.focusRestoration`, and on a `BackgroundUnavailable` refusal (other than `user_active_in_target`) `data.nextCall`: the next rung to try (an element action, the keyboard, foreground), never followed automatically. These `data` fields reach SDK and host programs; an eval cell sees the message and, for the structured failures, `error.code` (see [Eval helpers](#eval-helpers)). The ones a user or model acts on:

| Code | Meaning | What to do |
|------|---------|------------|
| `PermissionDenied` | The OS permission for capture, input or accessibility is missing | Grant it to the app that launches OmO; see [Set up your operating system](../guide/computer-use.md#set-up-your-operating-system) |
| `Suspended` | The user pressed the stop chord (on macOS and X11 only a physical press counts; a posted or XTEST chord is ignored) or ran `/computer stop` | Stop acting; only the user runs `/computer resume` |
| `StopPathUnavailable` | The global stop chord could not be armed, or cannot hear keys (`secure-input-active`: macOS Secure Event Input is on), so input is refused; an in-flight `typeText` stops at the next character, and a menu walk at the next menu level, with this code; no stop latches | Use a host where the chord arms, or `allow_host_relay_only_stop`; for `secure-input-active`, wait for the user to leave the password field |
| `ScreenLocked` | The screen is locked | Unlock the session |
| `BackgroundUnavailable` | The target refuses background delivery | Use accessibility actions or `delivery: "foreground"` |
| `ControlRequired` | Foreground delivery, `raiseWindow`, or input on the desktop or a display without this session's live control grant | A consent-capable host confirms with the human, then calls `control.grant`; a bridge client (`--oneshot`, MCP) cannot grant, so target a window for background delivery |
| `InputBusy` | Another session holds the foreground control grant | Retry after that session revokes or closes |
| `InvalidCoordinateFrame` | The coordinates do not belong to the latest screenshot of that target, or the target moved or resized | Take a new screenshot of the same target |
| `StaleRef` | An accessibility ref from an older snapshot | Take a new `ax()` snapshot |
| `WindowNotFound`, `InvalidTarget` | The window closed, or the filter matched nothing or several windows | List windows again and pick one |
| `AxUnsupported`, `AxFailed` | The element or platform does not support that accessibility operation | Fall back to pointer input |
| `FocusRestoreFailed`, `CursorRestoreFailed` | Foreground delivery could not put the previous window or cursor back | Tell the user; nothing is hidden |
| `UserIntervened` | The user was using the target app, or brought another window forward, so the action stopped; the message says whether any input was sent | Read the window again once the user pauses; never repeat the action as it was |
| `AxUnconfirmed` | An accessibility request was made but the app did not confirm it (no reply in time, or a modal dialog opened). On macOS, `ax.perform` (press and the other named actions), `ax.setValue` and `ax.focus` report it when the app answers `kAXErrorCannotComplete`; a refused request stays `AxFailed`, and so does a value the app answered but did not take | It may already have taken effect: read the element back before any retry |
| `SpaceUnsupported`, `SpaceMoveDenied` | A window could not be moved to the current Space (macOS), because the platform lacks support or the window server refused or could not verify the move | Ask the user to bring the window to the current Space |
| `AmbiguousTarget` | A target description matched more than one window or element. Reserved in the protocol; no backend returns it in this release, and the SDK's window lookup that matches several windows answers `InvalidTarget` with reason `ambiguous` instead | List them again and target one by its id or ref |
| `CaptureConsentRequired` | The system needs the user to approve screen capture first. Reserved in the protocol; no backend returns it in this release | Ask the user once to approve capture, then capture again |
| `ProtectedProcess` | The target process is protected and the engine never sends it input. Reserved in the protocol; no backend returns it in this release | Do not retry; pick another target or ask the user to act in that app |
| `CaptureFailed`, `InputFailed`, `Timeout`, `Cancelled`, `Closed`, `TransactionFailed`, `Internal` | The platform call failed, took too long, was aborted, or the session ended. On macOS a `CaptureFailed`, `InputFailed` or `Timeout` message that ends `(the screen is locked)` or `(the display is asleep)` names the likely cause | Observe again before retrying; stop after repeated failures; for a lock or sleep note, ask the user to unlock or wake the Mac |

### Error reasons

`data.reason` is an open set of tokens per code; a host that does not know a token falls back to the code's general hint. These are the tokens the engine attaches in this release, in an object-mode session only:

| Code | Engine reasons |
|------|----------------|
| `InvalidCoordinateFrame` | `resized` (the window changed size after the capture), `out_of_bounds` (the point is outside the frame, or between two displays of it), `pixels_only` (the capture has no known logical geometry, so its pixels cannot be used as input coordinates), `frame_required` (the target has no capture yet), `no_capture` (the named frame exists but this target has never been captured), `wrong_target` (the frame belongs to another target), `consumed` (the frame was used with `consume: true`), `superseded` (a newer capture replaced the frame, or the desktop changed under the session, below; nothing was sent when it changed before the first input event, otherwise the disposition is `unknown`) |
| `WindowNotFound` | `identity_changed`: the window number is the same but its owning process differs from the captured one |
| `BackgroundUnavailable` | `key_route_unproven` (macOS could not confirm the target window as its app's key window), `user_active_in_target` (the user pressed a key or clicked in that frontmost app within the last 1.5 s; retry after they pause) |
| `InvalidKey` | `dangerous_chord`: `cmd+q` on macOS, `alt+f4` or `win+l` on Linux and Windows, refused on `keyChord` without `force: true` and always on `holdKeys` |
| `AxUnsupported` | `disabled`, `action_unsupported`, `not_visible`, `unstable`, `occluded` (the actionability checks run before an accessibility action) |

The protocol's own description of `data.reason` (`crates/senpi-desktop-core/src/protocol.rs`) also names `InvalidCoordinateFrame` `zoom`, `InvalidTarget` `ambiguous`, `BackgroundUnavailable` `pointer_reading_toolkit`, `electron_select` and `wayland_window_targeting`, `ControlRequired` `headless_host`, `spawn_inside_session` and `lease_missing`, `Suspended` `stop_marker`, and `Internal` `request_too_large` and `other`. No engine code path attaches any of them in this release; they are reserved. In particular the engine's `ControlRequired` carries no reason at all. The SDK (`packages/senpi-desktop-sdk/src`) refuses some requests itself, before anything reaches an engine, with its own reasons:

| Code | SDK reasons (source file) |
|------|---------------------------|
| `InvalidTarget` | `ambiguous`: a window selector, or `verify`'s `windowBounds`, matched several windows, and `data.candidates` lists them (`computer.ts`, `verify.ts`); `unsupported_transport`: an unknown transport kind, or `attach` on Windows (`connect.ts`, `transport/attach-uds.ts`); `missing_launch` (`transport/spawn.ts`); `invalid_timeout` (`verify.ts`); `empty_reason` (`control.ts`); `invalid_duration`, `invalid_delta` (`target.ts`) |
| `WindowNotFound` | `no_match` (`computer.ts`) |
| `InvalidCoordinateFrame` | `other_target`, `zoom_frame`, `invalid_point`, `mixed_frames` (`target.ts`) |
| `InvalidKey` | `empty_chord` (`target.ts`) |
| `ControlRequired` | `spawn_inside_session` (`transport/spawn.ts`), `attach_inside_session` (`transport/attach-uds.ts`), `no_confirm_channel`, `declined` (`control.ts`) |
| `Closed` | `endpoint_refused`, `server_refused`, `unreachable` (`transport/attach-uds.ts`); `sdk_closed` (`link.ts`) |
| `Cancelled` | `aborted` (`verify.ts`, `batch.ts`) |
| `Internal` | `launch_failed` (`transport/spawn.ts`), `malformed_result` (`errors.ts`) |

An object-mode engine also announces `epoch.changed` when the desktop changes under the session; its `reason` is `display`, `lock`, `sleep`, `space`, `engine_restarted` or `idle_flush`. Every frame and ref taken before it is superseded, so capture and read again. Input whose frame the change overtakes fails `InvalidCoordinateFrame` with reason `superseded`. The OmO host does not act on the notification itself in this release; the refusals carry the effect.

### Stop persistence

A stop persists across an engine restart only on the macOS XPC agent path, which keeps a private stopped marker that no operation clears. The marker is the file `~/Library/Application Support/OmO/ComputerControl/xpc-v1/global-stop`, owned by the user with private permissions; an engine on that path that finds it, or finds stop state with the wrong owner or permissions, starts stopped. Only the user clears it, by deleting that file. The `--serve` daemon behind `--oneshot` and `--mcp` keeps its stop in memory: `--resume` lifts it, and a daemon that restarts (after a crash, an idle exit or a kill) starts unstopped, so a v1 consumer never stays `Suspended` behind a file the user would have to delete.

Engine start failures are reported by `/computer status` as `engine: native-unavailable`, `quarantined` or `abi-mismatch`, and are described in [Troubleshooting](../guide/computer-use.md#troubleshooting).

## Session settings

The `computer` block in `omo.jsonc` (OmO Native only) has three settings for the engine session; the full table is in [Configure it](../guide/computer-use.md#configure-it). Each is sent in `session.open` only to an engine whose `engine.hello` lists the matching feature, because an engine refuses keys it does not know:

| Key | Values (default first) | Engine feature | Effect |
|-----|------------------------|----------------|--------|
| `intervention` | `"continue"`, `"pause"` | `intervention-policy` | What a background action does while the user is using the target app. `continue` records the user's presses there but neither waits for them nor stops input already being sent; the 1.5 s `user_active_in_target` refusal still applies. `pause` waits for the user to stop and then fails `UserIntervened` with nothing sent, and stops input in progress at their first key or click. An engine without the feature is not sent the key and always pauses |
| `macos_key_priming` | `"off"`, `"on"` | `key-priming` | On macOS, background keys into an app with several windows first make the target window the app's key window, then hand key focus inside the app back. It acts only in an object-mode session; with it off such keys answer `BackgroundUnavailable` |
| `trace` | `false`, `true` | `trace` | With the audit log on, writes a redacted JSONL trace to `trace/<pid>-<start>.jsonl` beside it: ids, codes and per-stage durations; typed text by length and hash only, strings cut at 256 characters, secure-field content dropped |

## Engine interoperability

Engine discovery checks `computer.engine_path`, a compiled sidecar, the package prebuild and `target/release` in that order (`packages/senpi-desktop-engine/src/locator.ts`). Outside OmO Native, `senpi-desktop-engine --enable-daemon --mcp` serves the same engine operations over MCP stdio, forwarding through the daemon and preserving its stop-path and audit checks. A host using relay-only stop must keep the heartbeat alive; the model cannot invoke the user-only resume operation. The MCP and `--oneshot` bridges refuse the host-only `control.grant`, so their desktop and display input is refused with `ControlRequired`; window-targeted background input still works where the backend supports it (Wayland supports none, so a bridge-only Wayland session has no pointer or keyboard injection).

### SDK transports

`@oh-my-opencode/senpi-desktop-sdk` (`packages/senpi-desktop-sdk/src/connect.ts`) reaches an engine session through one of three transports; inside an OmO session, the eval-kernel `computer` global goes through the `computer` tool instead, so permission tiers, lazy activation, the size caps and the call budget apply to every call.

| Transport | What it does | `close()` |
|-----------|--------------|-----------|
| `inProcess` | Wraps a port the host already owns (the desktop service, a test fake) | Detaches the SDK; the port stays with its owner |
| `spawn` | Starts an engine child through a `launch` function the caller injects; the SDK itself launches nothing. Inside an OmO session it is refused before `launch` runs, with `ControlRequired` reason `spawn_inside_session`: use the session's own `computer` instead of a second engine. The session is recognized by `SENPI_DESKTOP_HOST=1`, which the eval prelude sets in a kernel that owns its environment (a worker-thread or process-mode JavaScript kernel, and the Python kernel) and which processes a cell starts inherit. The marker is an accident guard, not a security boundary | Ends the engine connection |
| `attach` | Connects to a running `--serve` daemon's unix socket (by default `<runtime-dir>/senpi-desktop/<uid>.sock`) and joins its shared session. The parent directory is opened without following links and the socket must be owned by the current user; like the `--oneshot` and `--mcp` bridges, it never sends the host-only methods (`session.open`, `session.close`, `control.grant`, `control.revoke`, `stopPath.start`, `stopPath.heartbeat`, `stopPath.resume`). Like `spawn`, it is refused inside an OmO session (`ControlRequired` reason `attach_inside_session`), and on Windows, where the daemon listens on a named pipe (`InvalidTarget` reason `unsupported_transport`) | Ends this connection; the daemon's session stays |

### Interaction lock

Input from all of one user's engines, in every process, is serialized by one machine-wide lock (`crates/senpi-desktop-session/src/lock.rs`). On Linux it is the file `$XDG_RUNTIME_DIR/senpi-desktop/<uid>.lock` (`/run/user/<uid>` when `XDG_RUNTIME_DIR` is unset or relative); on macOS the same name under the per-user directory `confstr(_CS_DARWIN_USER_TEMP_DIR)` reports, never `$TMPDIR`; on Windows a mutex named with the user's SID. The `senpi-desktop` directory is created with mode 0700 and refused when another user owns it. There is no fallback to the shared temp directory: an unusable location refuses the request with nothing sent. A background action holds the lock for its dispatch only, a foreground action from the focus capture through the restore; a lock another process holds for more than 2 seconds answers `InputBusy` with nothing sent, and the request may be retried once that process is done.
