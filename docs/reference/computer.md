# The `computer` tool

The OmO Native computer-use component registers a search-exposed `computer` tool and, after activation, a `computer` global in JavaScript and Python eval kernels. For setup, stop paths, platform limits and permissions, see [Computer use](../guide/computer-use.md).

> **Experimental.** Computer use is experimental support. The tool contract below may change between releases.

## Source of the contract

- Component registration, session lifecycle and resource discovery: `packages/omo-senpi/src/components/computer-use/index.ts`
- Typed native-only configuration: `packages/omo-config-core/src/schema/computer.ts`
- Tool actions and validation: `packages/senpi-desktop-tool/src/tool.ts`, `packages/senpi-desktop-tool/src/params.ts`
- User command and permission tiers: `packages/senpi-desktop-tool/src/command.ts`, `packages/senpi-desktop-tool/src/permission.ts`
- Eval facade and model-facing guidance: `packages/senpi-desktop-prelude/src/prelude.js`, `packages/senpi-desktop-prelude/src/prelude.py`
- Engine client and protocol: `packages/senpi-desktop-service/src`, `packages/senpi-desktop-protocol/src`
- Engine and platform backends: `crates/senpi-desktop-engine`, `crates/senpi-desktop-backend-macos`, `crates/senpi-desktop-backend-x11`, `crates/senpi-desktop-backend-wayland`, `crates/senpi-desktop-backend-win32`

## Actions

| `action` | Parameters | Result |
|----------|------------|--------|
| `call` | `chain`: a desktop helper `{ method, args? }`, optionally followed by one window or element method | The helper's result; a screenshot also returns image content |
| `run` | `code`: JavaScript async function body with `desktop`, `wait`, `assert` and `tool`; optional `read_only` and `timeout` in seconds | The returned value and displays |
| `capabilities` | None | Backend, capture/input/AX permissions, stop path and focus guard |
| `close` | None | Ends the desktop session |

For example, `{ "action": "call", "chain": [{ "method": "screenshot" }] }` captures the desktop. A `run` can call `await desktop.screenshot()` then `await desktop.click(x, y)` using a coordinate from that frame. Screenshots are limited to a coordinate-safe size when passed to a model; a stale frame is rejected with `InvalidCoordinateFrame`.

The `computer` eval global offers the same operations as a fluent facade. A `run` marked `read_only: true` is constrained by the runtime, so attempted input fails rather than escaping the read tier.

## Result envelope

Every `computer` result has text `content` (plus image content for a screenshot) and a `details` object (`ComputerToolDetails` in `packages/senpi-desktop-tool/src/tool.ts`):

| `details` field | Meaning |
|-----------------|---------|
| `value` | What the `run` code returned, or the `call` chain's result; the eval-kernel `computer` facade returns this |
| `readOnly` | Whether the call ran in the `computer:read` tier |
| `screenshots` | Screenshots taken during the call, with their frame and artifact path |
| `audit` | The audit records of the mutating actions the call sent |
| `sandbox` | Where the code ran: `vm`, or `quickjs` for model-written `run` code under `computer.run_sandbox: "quickjs"` |
| `report` | The action report of the last input action the call sent; absent when it sent none |
| `reports` | Every action report in send order, present when the call sent more than one input action |
| `isError` | `true` on a structured failure (permission, control, busy, suspended, launch context); `value` then holds the failure |

An OmO Native session opens the engine with `reportMode: "object"` whenever the engine's `engine.hello` lists the `action-report` feature, so each input action answers with an action report instead of `null`:

| Report field | Meaning |
|--------------|---------|
| `disposition` | Whether input reached the target and whether the same action may be sent again (below) |
| `delivered` | `{ count, of }` characters, keys or steps delivered out of those requested; `null` when the engine does not count |
| `effect` | `confirmed`, `unverifiable`, `no_change` (a read-back showed nothing changed) or `refused` |
| `route` | `ax`, `background_window`, `background_pid` or `foreground_hid` |
| `hit` | The element under the point before sending (`role`, `label`); `label` is `null` for a secure field |
| `focusRestoration` | `not_needed`, `restored`, `user_moved_on` or `not_confirmed` |
| `openedSurfaces` | Sheets, dialogs, menus, popovers or windows the action opened |
| `nextCall` | On a refusal, the next rung to try (an element action, the keyboard, foreground); never followed automatically |
| `note`, `warning` | Short guidance; content from a secure field is never copied in, and long strings are cut at 256 characters |
| `auditIds` | Ids of the audit events the action emitted |
| `timings` | Always `null` in this release; per-stage timings are written to the trace file when `computer.trace` is on |
| `legacy` | `true` when the engine replied `null` (an engine without `action-report`); the report then reads `delivered_unverified` / `unsafe` with `effect: "unverifiable"` |

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

The SDK's `ComputerError.nothingSent` is `true` exactly when `delivery` is `not_delivered`.

## Permission classification

`capabilities`, inspection-only `call` chains, and `run` with `read_only: true` use `computer:read`. `close`, other calls and runs, unknown methods and malformed inputs use `computer:exec`. The host checks the tier before the engine receives an action, so an exec-denied click is not audited as an engine click. Rules may target the entire `computer` tool or the `computer:read` and `computer:exec` tiers. An approval for read never approves exec.

## Coordinates and delivery

Pointer coordinates refer to the latest screenshot of the same target, while accessibility coordinates are global desktop coordinates. Each accessibility snapshot changes the reference generation; old refs fail with `StaleRef`.

Scroll amounts (`dx`/`dy` of `scroll`, and `scroll_x`/`scroll_y` of `computer_actions`) are pixels, the same unit on every OS. macOS posts them as pixel scroll events; Windows and X11 send one wheel notch per 40 px (rounded, at least one), and Wayland sends 120ths of a notch at the same rate. So `dy: 120` scrolls about three notches everywhere. A positive `dy` moves the view toward the end of the content and a positive `dx` toward its right edge, whatever the natural-scrolling setting.

Input defaults to background delivery when supported. On macOS it leaves the frontmost app, its focused window, the cursor and the destination of the user's next keystroke unchanged, but a clicked target window may rise directly under the user's front window. Foreground delivery uses a focus guard to restore the previous window and cursor; restoration failures are reported instead of hidden. A stop chord, screen lock, lost stop path or missing OS permission refuses input before a backend action.

Foreground delivery also needs this session's live control grant. The host asks the human to confirm, then calls `control.grant { reason, confirmationId }` (host-only); `control.revoke` releases it, `session.close` and a stop chord revoke it too, and `stopPath.resume` never restores it. At most one session of the process holds the grant; another session's grant is refused `InputBusy`, never stolen. `control.state` (public) reports `{ active, reason?, grantedAt? }`. An omitted delivery stays background, except that pointer and keyboard input on the `desktop` or a `display:*` target (click, moveMouse, drag, scroll, typeText, keyChord, holdKeys, holdMouse) always needs the grant: every backend posts it globally, onto the user's real pointer and frontmost app, so the engine admits it by its effect rather than the requested delivery (#10788). In full access the OmO host takes the grant itself, without a confirm and in non-interactive runs too, and revokes it once the session leaves full access. `raiseWindow` (`win.raise()`) always needs the grant, because raising a window always takes the user's foreground; this is deliberately stricter than upstream oh-my-pi, which gates only takeover input.

On macOS the engine keeps the display awake while the agent operates: the first request other than `capabilities`, `control.state` and `stopPath.*` takes a `PreventUserIdleDisplaySleep` power assertion, listed by `pmset -g assertions` as "OmO computer use is operating the desktop", and it lasts until 60 seconds after the last such request finished. `session.close`, a disconnect and a stop release it at once. `capabilities.displayAsleep` is true when every display the session can capture is asleep; the screen lock still refuses input with `ScreenLocked`.

## Error codes

A failed call carries one engine error code (`crates/senpi-desktop-core/src/error.rs`), and some codes also carry a `data.reason` naming the cause (for example `consumed` for `InvalidCoordinateFrame`; the full list is under [Error reasons](#error-reasons)); the tool's recovery hint follows that reason when it knows it. In an object-mode session the error also carries `data.disposition`, `data.delivered` when part of the input was sent, `data.focusRestoration` and `data.nextCall`. The ones a user or model acts on:

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
| `AmbiguousTarget` | A target description matched more than one window or element. Reserved in the protocol; no backend returns it in this release, and a window filter that matches several windows still answers `InvalidTarget` with reason `ambiguous` | List them again and target one by its id or ref |
| `CaptureConsentRequired` | The system needs the user to approve screen capture first. Reserved in the protocol; no backend returns it in this release | Ask the user once to approve capture, then capture again |
| `ProtectedProcess` | The target process is protected and the engine never sends it input. Reserved in the protocol; no backend returns it in this release | Do not retry; pick another target or ask the user to act in that app |
| `CaptureFailed`, `InputFailed`, `Timeout`, `Cancelled`, `Closed`, `TransactionFailed`, `Internal` | The platform call failed, took too long, was aborted, or the session ended. On macOS a `CaptureFailed`, `InputFailed` or `Timeout` message that ends `(the screen is locked)` or `(the display is asleep)` names the likely cause | Observe again before retrying; stop after repeated failures; for a lock or sleep note, ask the user to unlock or wake the Mac |

### Error reasons

`data.reason` is an open set of tokens per code (`crates/senpi-desktop-core/src/protocol.rs`); a host that does not know a token falls back to the code's general hint.

| Code | Reasons |
|------|---------|
| `InvalidCoordinateFrame` | `resized` (the window changed size after the capture), `consumed` (the frame was used with `consume: true`), `zoom` (a zoomed crop is never an input frame), `wrong_target`, `out_of_bounds` |
| `WindowNotFound` | `identity_changed`: the window number is the same but its owning process differs from the captured one |
| `InvalidTarget` | `ambiguous`: the filter matched several windows; `data.candidates` lists them |
| `BackgroundUnavailable` | `key_route_unproven`, `user_active_in_target` (the user pressed a key or clicked in that frontmost app within the last 1.5 s; retry after they pause), `pointer_reading_toolkit`, `electron_select`, `wayland_window_targeting` |
| `InvalidKey` | `dangerous_chord`: `cmd+q`, `alt+f4` or `win+l` without `force: true` on `keyChord` |
| `AxUnsupported` | `disabled`, `action_unsupported`, `not_visible`, `unstable`, `occluded` (the actionability checks run before an accessibility action) |
| `ControlRequired` | `headless_host`, `spawn_inside_session`, `lease_missing` |
| `Suspended` | `stop_marker` (reserved for an engine that starts behind the persistent stop marker) |
| `Internal` | `request_too_large`, `other` |

An object-mode session also announces `epoch.changed` when the desktop changes under it (display layout, lock, sleep, Space switch, engine restart); every frame and ref taken before it is superseded, so capture and read again.

### Stop persistence

A stop persists across an engine restart only on the macOS XPC agent path, which keeps a private stopped marker that no operation clears. The marker is the file `~/Library/Application Support/OmO/ComputerControl/xpc-v1/global-stop`, owned by the user with private permissions; an engine on that path that finds it, or finds stop state with the wrong owner or permissions, starts stopped. Only the user clears it, by deleting that file. The `--serve` daemon behind `--oneshot` and `--mcp` keeps its stop in memory: `--resume` lifts it, and a daemon that restarts (after a crash, an idle exit or a kill) starts unstopped, so a v1 consumer never stays `Suspended` behind a file the user would have to delete.

Engine start failures are reported by `/computer status` as `engine: native-unavailable`, `quarantined` or `abi-mismatch`, and are described in [Troubleshooting](../guide/computer-use.md#troubleshooting).

## Session settings

The `computer` block in `omo.jsonc` (OmO Native only) has four settings for the v2 surface; the full table is in [Configure it](../guide/computer-use.md#configure-it). Each of the last three is sent in `session.open` only to an engine whose `engine.hello` lists the matching feature, because an engine refuses keys it does not know:

| Key | Values (default first) | Engine feature | Effect |
|-----|------------------------|----------------|--------|
| `run_sandbox` | `"vm"`, `"quickjs"` | none (host side) | Where model-written `run` code executes. `quickjs` runs it in a QuickJS WebAssembly cell with `computer` (alias `desktop`), `assert` and `console` as its only globals and per-run limits (64 MiB memory, 1,000 bridged calls, 1 MiB output and return value); host-built code such as a `call` chain always runs on `vm` |
| `intervention` | `"pause"`, `"continue"` | `intervention-policy` | What a background action does while the user is using the target app. No released engine advertises the feature yet, so OmO does not send the key and the engine pauses: input waits for the user to stop and then fails `UserIntervened` with nothing sent |
| `macos_key_priming` | `"off"`, `"on"` | `key-priming` | On macOS, background keys into an app with several windows first make the target window the app's key window, then hand key focus inside the app back. It acts only in an object-mode session; with it off such keys answer `BackgroundUnavailable` |
| `trace` | `false`, `true` | `trace` | With the audit log on, writes a redacted JSONL trace to `trace/<pid>-<start>.jsonl` beside it: ids, codes and per-stage durations; typed text by length and hash only, strings cut at 256 characters, secure-field content dropped |

## Engine interoperability

Engine discovery checks `computer.engine_path`, a compiled sidecar, the package prebuild and `target/release` in that order (`packages/senpi-desktop-engine/src/locator.ts`). Outside OmO Native, `senpi-desktop-engine --enable-daemon --mcp` serves the same engine operations over MCP stdio, forwarding through the daemon and preserving its stop-path and audit checks. A host using relay-only stop must keep the heartbeat alive; the model cannot invoke the user-only resume operation. The MCP and `--oneshot` bridges refuse the host-only `control.grant`, so their desktop and display input is refused with `ControlRequired`; window-targeted background input still works where the backend supports it (Wayland supports none, so a bridge-only Wayland session has no pointer or keyboard injection).

### SDK transports

`@oh-my-opencode/senpi-desktop-sdk` (`packages/senpi-desktop-sdk/src/connect.ts`) reaches an engine session through one of three transports; inside an OmO session, the eval-kernel `computer` global goes through the `computer` tool instead, so permission tiers and lazy activation apply to every call.

| Transport | What it does | `close()` |
|-----------|--------------|-----------|
| `inProcess` | Wraps a port the host already owns (the desktop service, a test fake) | Detaches the SDK; the port stays with its owner |
| `spawn` | Starts an engine child through a `launch` function the caller injects; the SDK itself launches nothing. Inside an OmO session (the kernel prelude sets `SENPI_DESKTOP_HOST=1`, and child processes inherit it) it is refused before `launch` runs, with `ControlRequired` reason `spawn_inside_session`: use the session's own `computer` instead of a second engine. The marker is an accident guard, not a security boundary | Ends the engine connection |
| `attach` | Connects to a running `--serve` daemon's unix socket (by default `<runtime-dir>/senpi-desktop/<uid>.sock`) and joins its shared session. The parent directory is opened without following links and the socket must be owned by the current user; like the `--oneshot` and `--mcp` bridges, it never sends the host-only methods (`session.open`, `session.close`, `control.grant`, `control.revoke`, `stopPath.start`, `stopPath.heartbeat`, `stopPath.resume`) | Ends this connection; the daemon's session stays |

### Interaction lock

Input from all of one user's engines, in every process, is serialized by one machine-wide lock (`crates/senpi-desktop-session/src/lock.rs`). On Linux it is the file `$XDG_RUNTIME_DIR/senpi-desktop/<uid>.lock` (`/run/user/<uid>` when `XDG_RUNTIME_DIR` is unset or relative); on macOS the same name under the per-user directory `confstr(_CS_DARWIN_USER_TEMP_DIR)` reports, never `$TMPDIR`; on Windows a mutex named with the user's SID. The `senpi-desktop` directory is created with mode 0700 and refused when another user owns it. There is no fallback to the shared temp directory: an unusable location refuses the request with nothing sent. A background action holds the lock for its dispatch only, a foreground action from the focus capture through the restore; a lock another process holds for more than 2 seconds answers `InputBusy` with nothing sent, and the request may be retried once that process is done.
