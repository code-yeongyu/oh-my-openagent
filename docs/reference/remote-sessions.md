# omo remote - sessions on your other devices

`omo remote` lists, starts, watches and commands the OmO sessions running on the other devices signed
in to your account. It talks to the OmO device service on this device, which holds the connection to your other
devices; `omo remote` never connects to another machine itself. `status`, `devices`, `sessions` and
`control` print a table, `enable` and `disable` print one sentence, and with `--json` each prints the
SDK's typed value as one JSON line instead; `attach` takes no `--json`
(`packages/omo-native/remote-cli.ts`). `bootstrap` prints the status rows when it connects, or a
notice on stderr when it stops; with `--json` it prints one JSON line, `{state, status}` when it
connects or `{state, notice}` when it stops (`packages/omo-native/remote-bootstrap.ts`). The session
commands `open`, `send`, `model`, `interrupt` and `close` print a short result, or with `--json` the
remote operation's typed result as one JSON line (`packages/omo-native/remote-session-verbs.ts`).

```bash
omo remote status [--json]       # the device service's connection state
omo remote devices [--json]      # the devices on this account, this device first
omo remote sessions [--device D] [--project P] [--state running|idle|ended] [--json]
omo remote enable | disable [--json]   # set this device up and turn remote sessions on, or turn them off
omo remote control [on|off]      # whether your other devices may view and command this device's sessions
omo remote wake [on|off|default] # whether a message from your other devices may start a session here that is not running
omo remote bootstrap [--json]    # set up the device service for your sign-in (every omo start runs it)
omo remote attach <session>      # open a session in the terminal UI, to watch and type
omo remote open <device> [--project P] [--model provider/id] [--thinking LEVEL] [--permission-preset MODE]
                [--worktree [--branch B] [--base REF]] [--prompt TEXT [--steer|--follow-up]] [--json]
                                 # start a session on another device; prints <device>/<session>
omo remote send <session> <text> [--steer|--follow-up] [--no-wait] [--json]
                                 # send a message and print the answer as it arrives
omo remote model <session> <provider/id> [--json]   # switch the session's model
omo remote interrupt <session> [--json]   # stop the session's running turn
omo remote close <session> [--json]       # end the session on its device
```

`devices` lists this device first. With `--json`, every row has `id`, `name`, `platform`, `online`,
`last_seen_ms` and `caps` (`attach`, `machine`, `control`), and `kind` when one is reported (this device's row has
none when the account roster does not list it). Only this device's row has `self: true`; the other rows have no
`self` key. When the device service reports this device, its row reads online only while that service is
connected; with no device service, or one that does not report this device, the row is a local one (`id: "local"`,
`kind: "local"`) that reads online. While the device service answers, `sessions --device D` for a device that is
neither this device nor on the account fails with exit 2 and names it.

`open` runs the new session in `MODE` (default: this device's own setting, else full-access), on the
model and thinking level given (default: that device's own); a model that device cannot run opens
nothing and fails with `model_not_found`. `--worktree` starts the session in a new git worktree of the
repository at `--project` on that device, on branch `B` (default `omo/thread-<time>`) at `REF` (default
its HEAD). `--prompt` hands the new session its first message, delivered as `send --no-wait` delivers
it; with `--json` the result's `prompt` field names that delivery or its failure (the session stays
open). The agent tool `thread_create` takes the same options as `model`, `reasoning`,
`permission_preset`, `worktree`, `prompt` and `delivery`; there `permission_preset` may only keep or
narrow the calling session's own mode.

The canonical session identity is the durable `thread.thread_id` that `open --json` returns. Pass it
directly to `send`, `model`, `interrupt`, `close` or `attach`; the CLI finds its device in the account
listing. All five also take `<device>/<session>`, with either the durable id or the listing key in the
`SESSION` column; an explicit device skips the account listing, and a durable id that device has not
listed yet (a session opened a moment ago) is located on that device. A bare id is found through the
account listing, which can lag a session opened a moment ago: right after `open`, use
`<device>/<thread_id>`.

`send`
with `--steer` goes into the running turn, and `--no-wait` returns once the session took the message
instead of printing the answer.

Exit codes: `0` done, `1` the operation failed, `2` usage error, `3` unavailable (signed out, the
device service is not set up or not running, or it lacks the feature). `omo remote bootstrap` exits `3`
for every stop, including a failed verification or install.

## Set up a device

Remote sessions are **on by default**. When `omo login` completes, it turns them on for this device. What it prints
depends on whether this device already runs the current device service.

If it does, login switches remote sessions on right away and prints:

```text
Remote is on for this device: other signed-in devices can reach it. Turn off: omo remote disable
```

If it does not (a new device, or one still running an older service), login does not wait for the install. It starts
`omo remote enable --after-login` in the background, exits, and prints:

```text
Remote is turning on for this device in the background. Check: omo remote status. Turn off: omo remote disable
```

The background enable installs the service and then switches remote sessions on. Check how far it got with
`omo remote status`. To turn remote off, run `omo remote disable`, even while the background enable is still running:
the enable sees the record and leaves remote off.

Every omo start then keeps the device set up (`omo remote bootstrap`). `omo remote disable` turns remote sessions
off and records that in `~/.omo/remote-sessions.json`, so neither `omo login` nor an omo start turns them on again;
`omo login` then says so (`Remote is off for this device, as you set it with omo remote disable. Turn on: omo remote
enable`). The bootstrap never turns the device service's switch on by itself: a switch turned off another way (the
OmO desktop app) stays off. `omo remote enable` turns remote sessions back on and clears the record:

```bash
omo remote enable
```

It runs the bootstrap first (`packages/omo-native/remote-bootstrap.ts`): it installs the pinned device service when
none runs, connects, and registers this omo's agent dir with it (the service only creates endpoints and delivery
consumers for agent dirs it knows). It then turns remote sessions on, links a sign-in the service has not seen (a sign-in made before the service was
installed), and installs and starts the always-on session host unit (see [Session host unit and cold wake](#session-host-unit-and-cold-wake)). Each step is idempotent, so running it
again changes nothing that is already in place. Signed out, it stops before anything is installed, with exit `3`.

`omo remote status` reads the result back. Besides the service's own state it shows this device's two units as the
service manager reports them (the session host unit: running or not, enabled, and whether its host is pinned; the
device service's unit; whether the device service's table names the session host for a cold wake) and the agent dir
omo registers. The service has no read for registered agent dirs yet, so that line is the dir every omo start and
`enable` register, not a confirmation from the service. With `--json` these are the `local` object next to the
service's `Status` fields:

```json
{
  "local": {
    "session_host": { "unit": "omo-session-host.service", "state": "running", "enabled": true, "pinned": true },
    "device_service": { "unit": "omo-relay-daemon.service", "state": "running" },
    "cold_wake_entry": true,
    "agent_dir": "/home/me/.omo/agent"
  }
}
```

A unit `state` is `running`, `stopped`, `not_installed` or `unknown`; `pinned` and `cold_wake_entry` are `unknown` when
they could not be read. Windows has no session host unit, so `local` is absent there.

## What you need

- The same OmO account signed in on every device you want to reach. `omo remote` has no pairing
  command: it reaches the devices signed in to your account.
- The OmO device service set up and running on each device (see [Install and update](#install-and-update)).
- A plan that includes remote sessions. Without one, `omo remote status` shows `Plan required`.

## Before any command runs

Each command first runs `omo account show`. Signed out, a locked keychain or an unreadable sign-in
stops the command with one line saying what to do, and exit `3`
(`packages/device-service-core/src/account-state.ts`). Next the device service must be set up and
running on this device; otherwise the command says so and exits `3`.

## States

`omo remote status` reports one of these states (`packages/omo-native/remote-render.ts`), with an
`Action` line when there is something you can do:

| State | Shown as |
| --- | --- |
| `not_configured` | Not set up |
| `disabled` | Off |
| `sign_in_required` | Sign-in required |
| `plan_required` | Plan required |
| `keychain_locked` | Keychain locked |
| `connecting` | Connecting |
| `activation_pending` | Waiting for activation |
| `connected` | Connected |
| `offline` | Offline |
| `authorization_stale` | Reconnecting |
| `service_degraded` | Needs attention |
| `update_required` | Update required |
| `signed_out` | Signed out |

## Sessions

`omo remote sessions` lists the sessions on your other devices as `<device>/<session>` rows with a
title, state, project, device and last update. A row marked `(cached)` is the last copy kept for a
device that did not answer this time. When some devices did not answer, a closing line names them:
their rows may be missing or cached.

## Watching a session

`omo remote attach <device>/<session>` opens the session in the terminal UI on this device. You watch
it as it runs and can type into it: what you type is sent to the session's device, and a command that
device does not apply is shown as `<state>: <reason>` with the outcomes below
(`packages/omo-native/remote-attach.ts`).

## Command outcomes

These are the outcomes the device service's local API reports for a command sent to a remote session
(`packages/device-service-core/src/local-api/protocol-events.ts`). `omo remote attach` shows them for
input the session's device did not apply, and clients of the local API see the same words:

| Outcome | Meaning | Retry offered |
| --- | --- | --- |
| `queued` | not every part of the command is acknowledged yet | no |
| `transport_confirmed` | every part is acknowledged | no |
| `engine_dispatched`, `engine_applied`, `engine_stale` | what the session's device reported for it | no |
| `engine_refused (<reason>)` | the session's device refused it (`parts_conflict`, `peer_unauthorized`, `message_too_long`, `engine_capability_missing`) | no |
| `uncertain (<reason>)` | it may have been delivered and applied (`request_gone`, `no_receipt`, `engine_restarted`, `recipient_revoked`, `transport_expired`, `unconfirmed`) | no |
| `not confirmed` | the transport refused a part, so nothing was stored | yes |
| `not delivered: never_sent` | no part of it was ever written to the transport | yes |

A retry is offered only when the other device provably cannot hold the command, so a retry never
runs it twice.

The text of one command is limited to 1,000,000 characters and 3,000,000 bytes of UTF-8
(`packages/device-service-core/src/local-api/spec-proto.ts`).

## Install and update

An interactive `omo` start (a TUI session started by the `omo` launcher) runs `omo remote bootstrap` in
the background, once per process, in its own process with a 10-minute deadline
(`packages/omo-senpi/src/components/device-service/runner.ts`). It does not run under CI or in task
children, and `device_service.enabled: false` in `omo.json` turns it off. When you are signed in, it
connects to a running device service at the pinned version or newer; only when none runs, or the
running one is older, does it acquire the pinned version from
`https://get.omo.dev/<channel>/device-service/<version>/`, install it and connect
(`packages/device-service-core/src/bootstrap.ts`, `src/release/acquire.ts`). Before anything is
written:

- `checksums.txt` must carry a valid signature under the release key built into omo;
- every downloaded file must match its sha256 in `checksums.txt`;
- `latest.json` must name the pinned version, and its `min_engine_version` must not be newer than the
  engine omo ships with (otherwise: update OmO).

The verified files are then written to a staging directory under `<state dir>/bin/`. On macOS the
binary's code signature must verify there; a failure removes the staging directory. Only then is the
release moved into place as a whole under `<state dir>/bin/<version>/`. A download that
fails verification is not installed and the command says so. The state dir is `~/.omo/device-service`
(macOS and Linux) or `%LOCALAPPDATA%\OmO\device-service` (Windows).

## Session host unit and cold wake

`omo remote bootstrap` (every omo start) and `omo remote enable` install and start one fixed, always-on
per-user unit that runs the omo session host next to the device service, and record it in the device service's
service table as the only unit it may start for a cold wake: a message another device sends to a session that is
not running (`packages/device-service-core/src/cold-wake/`).

| | Linux | macOS |
| --- | --- | --- |
| Unit | systemd user unit `~/.config/systemd/user/omo-session-host.service`, enabled (`WantedBy=default.target`) | LaunchAgent `ai.omo.session-host`, `~/Library/LaunchAgents/ai.omo.session-host.plist` |
| Runs | `<omo> daemon run --pinned` (an npm launcher script under the runtime that ran it), with `OMO_CODING_AGENT_DIR` set to the agent dir the bootstrap registers and `PATH` as it was at install | same |
| Always on | `Restart=always`, `RestartSec=30`, `StartLimitIntervalSec=0`, `KillMode=process` | `RunAtLoad`, `KeepAlive`, `ThrottleInterval` 30, `AbandonProcessGroup` |
| Table entry | `OMO_RELAYD_SERVICES` entry `"omo": {"systemd_user": "omo-session-host.service", "senders": []}` in the drop-in `~/.config/systemd/user/omo-relay-daemon.service.d/50-omo-cold-wake.conf` | entry `"omo": {"launchd": "ai.omo.session-host", "senders": []}` in the device service's plist `EnvironmentVariables` |

`omo daemon run` ensures the host, which detaches, and exits; the service manager runs it again after every
exit, at most every 30 seconds, so a host that ended is started again and a running one is reused. Stopping or
restarting the unit never ends the host or its sessions. `--pinned` makes the host it starts never idle-exit
(see [`omo daemon`](omo-daemon.md)); a host another omo already started is reused as it is, and once it
idles out the next run starts a pinned one.

The device service reads its table once, at start, so a changed table restarts it (Linux: `systemctl --user
restart omo-relay-daemon.service`; macOS: `launchctl bootout`, then `bootstrap` of `ai.omo.relay-daemon`).
Nothing is written and nothing restarts when the unit and the entry are already in place; a unit that is not
running is started. Other entries of the table are kept; a table that does not parse is left as it is, and the
command prints a notice instead. Nothing runs as root, and neither the unit's name nor its command can be
configured.

The device service's installer rewrites its macOS plist on every install and update, which drops the entry;
the next `omo remote bootstrap` (every omo start) writes it back. The Linux drop-in survives an install.

`omo remote disable` disables and removes the unit and the entry, and while remote sessions are off,
`omo remote bootstrap` removes them again instead of installing them. Removing the unit also stops the host
it pinned (`omo daemon stop --drain`, so a running turn finishes first), because that host never idle-exits;
a host another omo started (no pin in its `env_keys`) is left to its own idle exit. A unit that cannot be set up prints one
notice on stderr and never changes the command's exit code or output. Windows has no session host unit.

## Windows notes

- The device service listens on a loopback TCP port that it publishes in `endpoint.json` in the state
  dir, instead of a socket file. A stopped service is reported as not running, not as a connection
  error.
- The state dir and its files are restricted to your Windows account (an access control list with
  only your user), set before anything is written.
- `omo remote attach` reaches the attach view over a named pipe derived from its private endpoint and
  secret.
