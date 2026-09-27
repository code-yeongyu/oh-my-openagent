# Computer use in OmO Native

OmO Native can capture your desktop, inspect windows and accessibility trees, and send mouse and keyboard input to native applications. The `computer` tool is backed by the `senpi-desktop-engine` binary. The OmO Senpi component registers the tool when a session loads, but starts the engine only when the tool is first used. Computer use is available on macOS, Linux and Windows. It does not drive web pages through a browser API; for pages, use the `browser` skill.

The tool's parameters and permission classification are in [the computer tool reference](../reference/computer.md). This feature belongs to OmO Native; the same `computer` block does not enable it in the OpenCode or Codex editions.

## Turn it on

Computer use is on by default on macOS, Linux and Windows hosts: the `computer` tool is registered in every OmO Native session, and nothing touches your desktop until the agent (or you) activates it. The agent finds the tool with `tool_search` for `computer`, or calls it by name. After activation, JavaScript and Python eval kernels also receive a `computer` global.

You control it with these commands:

| Command | Effect |
|---------|--------|
| `/computer` or `/computer status` | Report whether the tool is enabled and active, the engine state, the stop path, and the current capabilities (backend, capture/input/accessibility permissions, screen lock) |
| `/computer on` | Enable and activate computer use for this session |
| `/computer off` | Deactivate computer use for this session |
| `/computer stop` | Suspend desktop input and release held keys and buttons |
| `/computer resume` | Lift a suspension; only you can do this, the model has no action that reaches it |

`/computer on` and `/computer off` last for the current session only. To keep computer use off everywhere, set `computer.enabled` to `false` (see [Configure it](#configure-it)); the tool is then not registered at all and `/computer` reports that computer use is unavailable in this session.

### Where the engine comes from

- **Compiled OmO binary:** the engine is staged inside the extracted runtime on macOS (arm64, x64), Linux x64 (glibc) and Windows x64.
- **npm install (`omo-ai`):** the npm package carries no native binaries. On first use, OmO looks for an engine for its own release version under `~/.omo/cache/senpi-desktop-engine/<version>/<host>/`, and when none is there it downloads the matching asset from the OmO GitHub release and verifies it against the release's checksum file before running it.
- **Your own build:** set `computer.engine_path` to a binary, or build one in a checkout with `cargo build --release -p senpi-desktop-engine`.

Without `computer.engine_path`, the locator also checks the compiled executable's sidecar, the `@oh-my-opencode/senpi-desktop-engine` package's native prebuild, and the development build at `target/release/senpi-desktop-engine` (`packages/senpi-desktop-engine/src/locator.ts`). A candidate carrying macOS's `com.apple.quarantine` attribute is skipped and reported, never cleared. Hosts with no released engine (Linux arm64, Windows arm64) keep the tool registered and report `native-unavailable` on first use.

## Set up your operating system

Computer use needs a graphical desktop session. It cannot use a desktop it is not logged into, so an SSH session, a CI runner without a display, or a locked screen will refuse capture or input.

### macOS

macOS gates capture and input behind two privacy permissions, and grants them to the **application you launch OmO from** (Terminal, iTerm2, Ghostty, your editor, or the OmO desktop app), not to the `omo` or engine binary:

| Permission | Needed for | System Settings location |
|------------|------------|--------------------------|
| Screen Recording (Screen & System Audio Recording on newer macOS) | screenshots, the display and window lists | Privacy & Security > Screen & System Audio Recording |
| Accessibility | mouse and keyboard input, accessibility trees and element actions | Privacy & Security > Accessibility |

To grant them:

1. Open System Settings > Privacy & Security.
2. Open Screen & System Audio Recording, turn on the switch for your terminal app (use **+** to add it if it is not listed).
3. Open Accessibility and do the same.
4. Quit and reopen the terminal app. macOS offers "Quit & Reopen" after a Screen Recording change; a grant does not reach processes that were already running.
5. Start a new OmO session and run `/computer status`; `capturePermission=granted inputPermission=granted axPermission=granted` means you are set.

OmO never opens the macOS permission prompt itself: it checks the grants with the non-prompting preflight calls and, when one is missing, reports it in `/computer status` and fails the call with `PermissionDenied` naming the process macOS evaluated. If you launch OmO from a different app later, that app needs its own grants.

The first background input of a session on macOS runs a short delivery check: a small dialog reading "senpi desktop canary" appears for a moment, receives a marked keystroke, and is dismissed automatically (it closes on its own after five seconds at most). Leave it alone while it is up. It proves background keyboard delivery works before OmO relies on it. If the check fails, background window input is reported as unavailable (`stopReason=skylight-canary-failed`) and `/computer resume` re-arms it.

### Linux

OmO picks the backend from the session: `WAYLAND_DISPLAY` wins over `DISPLAY` (an XWayland session sets both). With neither set, the engine reports that there is no display server.

- **X11:** capture uses RandR, input uses XTEST (or XSendEvent for background delivery), and accessibility uses AT-SPI on the session D-Bus. Enable your desktop's assistive-technology support (for example GNOME's accessibility setting) so AT-SPI trees are populated. Some toolkits ignore synthetic background input; OmO then reports `BackgroundUnavailable` instead of pretending the event landed.
- **Wayland:** capture uses the ScreenCast portal with PipeWire when `libpipewire` is present at runtime, otherwise the Screenshot portal (one image of the whole desktop as the display `wayland-portal-0`). Neither path captures a single window. Input goes through libei, either from a `LIBEI_SOCKET` provided by the compositor or through the RemoteDesktop portal. GNOME and KDE ask for consent the first time a portal is used; wlroots compositors do not. Wayland allows input only to the focused surface, so per-window input and `raise()` are unavailable: use accessibility actions, or focus the window yourself first.
- **Stop chord on Wayland:** the global stop chord needs a compositor with the GlobalShortcuts portal. Without it, input is refused with `StopPathUnavailable` unless you opt into `allow_host_relay_only_stop`.

### Windows

Capture uses the native display and window APIs with per-monitor DPI awareness, and accessibility uses UI Automation. Windows' UIPI refuses input from a normal process to an application running elevated (as administrator); run OmO at the same integrity level as the application you want it to drive. Some toolkits, including WPF, ignore posted background messages, which surfaces as `BackgroundUnavailable`; use accessibility actions or foreground delivery for those.

## Configure it

Put the `computer` block in `~/.omo/omo.jsonc` (or `~/.omo/omo.json`) for your account, or `.omo/omo.jsonc` in a project. The closest project layer wins. You may place it under `"[native]"` or at the shared top level; either way it is effective only in OmO Native. All keys are **snake_case** and optional:

```jsonc
{
  "[native]": {
    "computer": {
      "enabled": true,
      "max_width": 3840,
      "max_height": 2400,
      "audit_log": { "enabled": true }
    }
  }
}
```

| Key | Default | Meaning |
|-----|---------|---------|
| `enabled` | `true` on macOS, Linux and Windows | Register the `computer` tool and `/computer` controls |
| `display` | `"all"` | `all` composites every display; otherwise one display id from `computer.displays()` |
| `max_width` | `3840` | Largest screenshot width in pixels; bigger captures are scaled down |
| `max_height` | `2400` | Largest screenshot height in pixels |
| `screenshot_max_bytes` | `5000000` | Largest inline screenshot; a bigger one is returned only as a file path |
| `stop_hotkey` | `ctrl+alt+cmd+escape` on macOS, `ctrl+alt+shift+escape` elsewhere | The global stop chord |
| `allow_host_relay_only_stop` | `false` | Allow input when the global chord cannot be armed, with `/computer stop` as the only stop path |
| `macos_canary` | `"session"` | The macOS background-delivery check; `"off"` is reserved and not forwarded to the engine yet |
| `audit_log.enabled` | `true` | Write the mutating-action audit log |
| `screenshot_gc.enabled` | `true` | Delete stale screenshot files |
| `screenshot_gc.stale_ms` | `43200000` (12 hours) | Age after which a screenshot file is deleted |
| `screenshot_gc.scan_interval_ms` | `1800000` (30 minutes) | How often stale screenshots are swept |
| `engine_path` | unset | Use this engine binary instead of locating or downloading one |
| `cua_adapter` | `false` | Also register `computer_actions`, OpenAI computer-use actions over the same permissions, audit and stop path |

The schema is `packages/omo-config-core/src/schema/computer.ts`; the defaults are resolved in `packages/senpi-desktop-tool/src/settings.ts`. An invalid block is reported in the log and the component stays unregistered for that session. Start a new session after changing the file.

## Safety model

**Permission tiers.** Screenshots, window lists, accessibility reads and `run` with `read_only: true` require `computer:read`. Input, mutations, `close`, unknown methods and malformed requests require `computer:exec`. The host checks the tier before the engine sees the call, and an approval for read never approves exec. A non-interactive run cannot answer an `ask` decision, so allow the tier explicitly or the call is blocked. To let the agent look but never touch:

```sh
omo --permission computer:read=allow --permission computer:exec=deny
```

**The stop chord.** While input is possible, a global stop chord is armed (Control+Option+Command+Escape on macOS, Ctrl+Alt+Shift+Escape on Linux and Windows, or `stop_hotkey`). Pressing it suspends all computer input immediately, and an action cut short by the suspension releases any keys and buttons it was holding; `/computer stop` does the same from the prompt. Input stays suspended until you run `/computer resume`. If the chord cannot be armed, input is refused with `StopPathUnavailable` rather than running without a way to stop it; `allow_host_relay_only_stop: true` accepts `/computer stop` as the only stop path, and is meant for hosts that relay a stop reliably.

**Before input reaches an application,** the engine refuses it when input is suspended, the screen is locked, the stop path is gone, or the OS permission is missing.

**What the agent is told.** The computer-use skill instructs the model to treat screen text, notifications and documents as untrusted data that can never authorize an action, and to confirm immediately before consequential actions (sending or publishing, purchases and transfers, deletion, account, security and permission changes, disclosing private data, accepting terms) unless your own message authorized that exact action. A `Suspended` or `StopPathUnavailable` error means stop and report; the model is told never to work around it. These are model instructions, not a sandbox: `computer.run` code runs with full host access, so keep permission rules strict for untrusted work and use a separate account or VM for risky automation.

**Focus.** Input defaults to background delivery. On macOS it leaves your frontmost app, visible front window, keyboard focus, cursor and next-keystroke destination unchanged, although a clicked target may rise directly beneath your front window. Background typing into an app with multiple windows can report `BackgroundUnavailable`; use accessibility actions or foreground delivery instead. Foreground delivery briefly activates the target and then restores the previous window and cursor; a failed restore is reported, not hidden.

**Audit.** Every mutating action is appended to `.computer-audit.jsonl` in the session directory. Typed text is recorded by length and digest, not content. Set `audit_log.enabled: false` to turn it off.

## Privacy

- **What is captured:** only what the agent requests: screenshots of the desktop or a window, window lists (app names, titles, bounds), accessibility trees of a window (element roles, titles, values), and the clipboard when a helper reads it. Nothing is captured in the background or while computer use is inactive.
- **What stays on your machine:** screenshot files are written to the system temporary directory and deleted after `screenshot_gc.stale_ms`; the audit log stays in the session directory. The engine makes no network requests; the only network access computer use performs is the one-time engine download from the OmO GitHub release for npm installs.
- **What leaves your machine:** screenshots, accessibility text and window titles that a tool call returns become part of the conversation and are sent to your model provider like any other tool result. Keep sensitive windows closed or covered, or deny `computer:read`, when that matters.
- **Telemetry:** OmO Native's product telemetry records three computer-use events, each with enumerated values only: `computer_use_activation` (on or off, and whether a tool call or `/computer on|off` did it), `computer_use_permission_denied` (which OS capability or permission tier refused), and `computer_use_engine_error` (the engine's error code). Screenshots, screen text, window titles, app names, coordinates, typed text, tool arguments, paths and error messages are never sent. See [Senpi telemetry](../reference/senpi-telemetry.md) for every field and how to turn telemetry off.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `/computer` says "Computer use is unavailable in this session." | `computer.enabled` is `false`, the `computer` block is invalid (see the session log), or the platform is not macOS, Linux or Windows | Fix or remove the block and start a new session |
| `engine: native-unavailable` in `/computer status` | No engine binary for this host was found or downloaded; the error lists every path tried | Check the network for the first download (npm installs), set `computer.engine_path`, or build one with `cargo build --release -p senpi-desktop-engine` |
| `engine: quarantined` | The only engine found carries macOS's download quarantine | Use the OmO-provided engine, or remove the attribute yourself with `xattr -d com.apple.quarantine <path>` if you trust that file |
| `engine: abi-mismatch` | `computer.engine_path` points at an engine from another release | Point it at an engine built from the same OmO version, or remove the setting |
| `PermissionDenied`, or `capturePermission=denied` / `inputPermission=denied` on macOS | The app you launch OmO from lacks Screen Recording or Accessibility | Grant both to that app (see [macOS](#macos)), quit and reopen it, start a new session |
| Screenshots are black, blank, or show only the wallpaper | The display is asleep or locked (`screenLocked=true`), you are in an SSH or headless session, the window shows DRM-protected content, or on Wayland the portal consent was denied | Unlock and wake the display, run OmO in the graphical session, accept the portal dialog; protected content cannot be captured |
| Clicks land in the wrong place, often on Retina or HiDPI displays | The coordinates came from an older screenshot, or from a different target, or mixed accessibility (global points) with screenshot pixels | Take a fresh screenshot of the same target and use its pixel coordinates; `InvalidCoordinateFrame` is the engine refusing a stale frame. Screenshots may be scaled below native resolution (`max_width`, `max_height`, or a smaller coordinate-safe size for some models); OmO maps the pixels back to screen points itself |
| Focus jumps to another window, or the clicked window moves forward | Foreground delivery activated the target, or on macOS a background click raised the clicked window just below the front one | Prefer accessibility actions; background delivery keeps your frontmost app and focus, and the z-order change is a known limitation |
| `BackgroundUnavailable` | The target app or platform rejects background delivery (a macOS app with several windows for keystrokes, WPF, some Linux toolkits, Wayland) | Use accessibility `setValue` / `press`, or retry with `delivery: "foreground"` |
| `StopPathUnavailable` | The global stop chord could not be armed (commonly Wayland without GlobalShortcuts) | Use a compositor with GlobalShortcuts, or set `allow_host_relay_only_stop: true` knowing `/computer stop` is then the only stop |
| `Suspended` | You pressed the stop chord or ran `/computer stop` | Run `/computer resume` when you want input back |

## Known limitations

- macOS: a background click can raise the clicked window to just below the frontmost window; your frontmost app, front window, focus, cursor and next-keystroke destination are kept. Restoring the full previous window order is tracked in [#8930](https://github.com/code-yeongyu/oh-my-openagent/issues/8930).
- macOS: the stop chord latches immediately, but a `type` already in progress is not interrupted mid-string yet ([#8937](https://github.com/code-yeongyu/oh-my-openagent/issues/8937)).
- macOS: `macos_canary: "off"` is accepted but not yet forwarded to the engine, so the delivery check always runs.
- Wayland: no single-window capture, no per-window input, no `raise()`; the stop chord needs the GlobalShortcuts portal.
- No released engine for Linux arm64 or Windows arm64 yet.
- Windows: no input into elevated applications from a non-elevated OmO (UIPI).

## Engine modes and bunshin

The engine supports `--stdio` (JSON-RPC over NDJSON), `--serve <socket>` (daemon), `--oneshot` (one request forwarded to the daemon), `--resume` (user-controlled stop recovery), `--mcp` (MCP stdio server), `--selftest` and `--schema`. In `--mcp` mode, `tools/list` offers engine methods as `desktop_<method>` tools; capture results include MCP images, and input still goes through the same safety gate. Never expose the user-only resume operation as a model tool.

The descriptor in `packages/senpi-desktop-engine/bunshin/descriptor.mjs` uses the `--oneshot` bridge. `bun script/install-bunshin-desktop-capability.mjs` installs it into the bunshin agent capability directory for a locally available engine; use `--engine <path>` for a specific binary or `--remove` to uninstall the descriptor. Installing a descriptor does not itself start an agent or grant desktop permissions.
