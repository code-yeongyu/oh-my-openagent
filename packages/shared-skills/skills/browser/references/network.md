# What the attached engine sends

The attached engine is BrowserSkill (Tencent, MIT): the `bsk` CLI and daemon on the agent machine plus an
extension in the user's browser. This is what each piece talks to, audited at `bsk` 0.5.0 / extension 0.5.0
with a source read and a proxy capture of a fresh install and a full session (#14347).

| Piece | Talks to | When | Kind |
|---|---|---|---|
| Installer (`browser-install.mjs`) | `raw.githubusercontent.com`, `github.com`, `release-assets.githubusercontent.com` | once, at install | download of the pinned release, checked against its sha256 |
| Extension | `ws://127.0.0.1:52800` only | while the browser runs | local control channel to the daemon |
| Extension install and updates | the Chrome Web Store / Edge Add-ons | the browser's own extension updates | browser-managed |
| Daemon (started by omowright) | `github.com` (the pinned release's `version.json`) | at start and every 30 minutes | update check that never finds a newer version; installs nothing |
| Daemon, agent commands | the sites the agent opens, through the user's browser | during a session | the work itself |

No telemetry, analytics or crash reports: neither the CLI nor the extension carries any.

## The update check, and why omowright pins it

Upstream's daemon checks for an update when it starts and every 30 minutes. By default it asks a
Tencent Cloud object-storage mirror (`*.cos.ap-shanghai.myqcloud.com`) before GitHub, and a daemon
running in the background replaces its own binary with whatever newer release that manifest names.
`BSK_AUTO_UPDATE=off` stops only the replacement; the check still runs.

A daemon omowright starts gets two variables, unless you already set them:

| Variable | Value | Effect |
|---|---|---|
| `BSK_UPDATE_MANIFEST_URL` | the pinned release's `version.json` on GitHub | the check never contacts the mirror and never sees a newer version |
| `BSK_AUTO_UPDATE` | `off` | nothing is ever installed by the daemon |

So `bsk` moves only when this package moves its pin. Set either variable yourself to choose another policy.

These variables reach a daemon only when it starts. A daemon that was already running (started by
`bsk daemon start` in a shell, by another tool, or by an earlier version of this package) keeps its old
behaviour until it exits; `bsk daemon stop` and the next call start a pinned one.

## Remote mode

`bsk daemon start --mode server` and the extension's pairing screen let a browser on another machine
connect ([remote.md](remote.md)). Both are off until the user sets them up; nothing in this package
turns them on.

## Checking it yourself

Run the daemon behind a capturing proxy (it honours `HTTPS_PROXY`, and `SSL_CERT_FILE` for the proxy's CA)
and launch the browser with `--proxy-server`. The daemon's own requests carry no `User-Agent`.
