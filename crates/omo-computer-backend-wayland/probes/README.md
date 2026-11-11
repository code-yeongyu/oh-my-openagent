# SP-W probes: Wayland portal and compositor facts

This directory holds spike SP-W, which measures the Wayland portal and compositor facts the Wayland backend relies on, on GNOME 46, KDE Plasma 6 and sway. It ships no engine code. Its outputs are:

- `probe-sp-w.ts`: the probe. It is a Bun script and runs on a Linux host with Docker.
- `wayland-portal.tsv`: the ledger. It has one row per compositor per question, and one row per condition when a question is measured under several conditions.
- `containers/`: one Dockerfile per compositor, plus the helpers the probe runs inside them (session start and stop, a portal client, an AT-SPI client, a libei client, and a KWin window-management client).

A later constant that depends on a ledger row cites it in a comment, in the form `cites crates/omo-computer-backend-wayland/probes/wayland-portal.tsv:<row id>`.

## Running it

```sh
# measure one compositor (or one question) and print ledger rows
bun crates/omo-computer-backend-wayland/probes/probe-sp-w.ts --compositor sway [--question release-on-close]
# measure and (re)write rows in the ledger
bun crates/omo-computer-backend-wayland/probes/probe-sp-w.ts --write crates/omo-computer-backend-wayland/probes/wayland-portal.tsv --compositor kde
# measure every row again; exits 0 only if every verdict is identical
bun crates/omo-computer-backend-wayland/probes/probe-sp-w.ts --verify crates/omo-computer-backend-wayland/probes/wayland-portal.tsv
```

The probe runs containers one at a time. Each starts with `--cpus=2` and `--rm`, and is force-removed afterwards. Before each `docker build` or `docker run`, the probe waits until the host's 1-minute load average is under 2x `nproc`, and logs the `uptime` reading it started on (`LOAD_GATE ...`). It also logs one `CONTAINER_START` and one `CONTAINER_REMOVED` line per container.

Inside a container, the probe needs a running session, which `containers/common/session.sh run <compositor> -- <command>` starts. Without one, it prints one `SPW_PRECONDITION_MISSING: ...` line, exits 2 and writes no row.

Every question runs in a fresh session over a fresh `$HOME`, so no grant, permission-store row or GSettings value carries over from one question to the next.

## Ledger grammar

The ledger is tab-separated, with a header row. Its columns are:

| # | column | content |
|---|---|---|
| 1 | `id` | `SPW-<compositor>-<question id>`, the citation key |
| 2 | `compositor` | `gnome`, `kde` or `sway` |
| 3 | `question` | the binary question |
| 4 | `condition` | the exact condition it was measured under |
| 5 | `verdict` | `CONFIRMS` (the answer is yes), `CONTRADICTS` (the answer is no), `UNMEASURED`, or `INVALID` (the probe for the row was found unproven; the row waits for a re-measure) |
| 6 | `rerun` | the command that measures this row again, from the repository root |
| 7 | `observed` | what was measured; rectangles are in 8 px buckets |
| 8 | `host_build` | measurement date, host kernel, Docker version, pinned base image digest, built image id, and package versions |
| 9 | `note` | `UNMEASURED: <reason>` for a row that was not measured. On `release-on-close` rows it is `release: proven`, `release: contradicted` or `release: unproven`. Otherwise `-` |

The verdict always answers the question in column 3, never a design expectation. For example, `SPW-sway-gs-version CONTRADICTS` means the GlobalShortcuts portal is absent on sway, which is what the design expects for wlroots.

A row is `UNMEASURED` only when the measurement itself could not run in the container, and its note names the cause. An answer is never guessed.

## How the questions are measured

- **Interface presence.** `containers/common/iface_probe.py` introspects `/org/freedesktop/portal/desktop` on `org.freedesktop.portal.Desktop` and parses its `<interface name=...>` list. An interface is absent only when that list came back without it. A failed call is recorded as `UNMEASURED` with its error text, never as absent. Its tests run without D-Bus or a container: `python3 -m unittest crates/omo-computer-backend-wayland/probes/containers/common/test_iface_probe.py`.

- **First grants.** A portal dialog is answered by `atspi.py approve`, an AT-SPI client acting as the person at the dialog: it picks every screen, ticks "remember" or "allow restore", and presses the accept button. This happens only for the first grant. Restore legs run with no approver, so a restore that succeeds was granted by the token alone.
  - On sway, the chooser of `xdg-desktop-portal-wlr` picks the output for the grant leg (`xdpw-grant.ini`). The restore leg swaps in a chooser that always fails (`xdpw-deny.ini`).
- **File policy.** Restore tokens are written to a file with mode 0600, opened with `O_NOFOLLOW`, and read back the same way. Each question measures one token kind, so each file holds one token.
- **Restarts.**
  - An engine restart is a new client process on the same session bus.
  - A session restart stops the bus, the compositor, the portals and PipeWire, then starts them again over the same `$HOME`.
- **Region coverage.** Regions announced by libei are compared with the xdg-output logical rectangles that `wayland-info` reports, in 8 px buckets.
- **Release on socket close.** An independent `wev` client reads the seat state, and the measurement runs as follows:
  1. A second injector is armed: on GNOME and KDE this is another RemoteDesktop session's libei keyboard, on sway another virtual keyboard.
  2. The holder presses shift.
  3. The holder is killed with SIGKILL.
  4. 300 ms later, the second injector types `a`.

  The release is proven when the reader receives an unshifted `a` within 2 s.

  On sway, the injector's keyboard exists before the kill. wlroots keeps modifier state per keyboard device and applies the active keyboard's state to the seat, so on sway the row shows that the destroyed device's shift is no longer in effect for the focused client. On GNOME, one Escape sent through Mutter's own RemoteDesktop API first leaves the overview that gnome-shell opens at startup, so that the reader window can take focus.
- **KDE window management.** `kde-pwm.py` binds `org_kde_plasma_window_management` and asks KWin to activate the older of two windows. KWin authorises protocols by executable path, through the first desktop file that names the path, and Debian's `python3.x.desktop` already names the system interpreter. The helper therefore runs from its own copy of the interpreter, which a user desktop file authorises.

## Container notes (what each image needed to run headless)

- **GNOME** (Ubuntu 24.04, GNOME 46):
  - gnome-shell needs a system bus. A private bus stands in for it.
  - `/run/systemd/seats` is removed, so that gnome-shell takes its no-systemd login manager.
  - Chromium is an upstream snapshot pinned by revision, because the Ubuntu package is a snap.
- **KDE** (Debian 13, Plasma 6.3):
  - `kwin-common` carries the EIS and screencast plugins.
  - `plasma-workspace` carries the dialog QML.
  - A minimal XDG applications menu makes the service cache index desktop files.
  - `kwin_wayland`'s `cap_sys_nice` file capability is dropped.
  - kwin starts without the KDE session variables, because it crashes at startup with all of them set.
- **sway** (Debian 13, sway 1.10): runs headless on the pixman renderer.

This host exposes no DRM render node (`/dev/dri`), so no container can composite with OpenGL. As a result, KWin refuses every ScreenCast stream ("OpenGL compositing is required for screencasting"), and `xdg-desktop-portal-wlr` cannot negotiate a screencopy format on pixman. Those rows are `UNMEASURED` with that reason. They can be measured on a host with a render node.
