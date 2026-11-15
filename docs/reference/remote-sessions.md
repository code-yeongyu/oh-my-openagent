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
omo remote devices [--json]      # the devices on this account
omo remote sessions [--device D] [--project P] [--state running|idle|ended] [--json]
omo remote enable | disable [--json]   # turn remote sessions on or off for this device
omo remote control [on|off]      # whether your other devices may view and command this device's sessions
omo remote bootstrap [--json]    # set up the device service for your sign-in (every omo start runs it)
omo remote attach <device>/<session>   # open a session on another device in the terminal UI, to watch and type
omo remote open <device> [--project P] [--model M] [--permission-preset MODE] [--json]
                                 # start a session on another device; prints <device>/<session>
omo remote send <device>/<session> <text> [--steer|--follow-up] [--no-wait] [--json]
                                 # send a message and print the answer as it arrives
omo remote model <device>/<session> <provider/id> [--json]   # switch the session's model
omo remote interrupt <device>/<session> [--json]   # stop the session's running turn
omo remote close <device>/<session> [--json]       # end the session on its device
```

`open` runs the new session in `MODE` (default: this device's own setting, else full-access). `send`
with `--steer` goes into the running turn, and `--no-wait` returns once the session took the message
instead of printing the answer.

Exit codes: `0` done, `1` the operation failed, `2` usage error, `3` unavailable (signed out, the
device service is not set up or not running, or it lacks the feature). `omo remote bootstrap` exits `3`
for every stop, including a failed verification or install.

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

## Cold wake

A message another device sends to a session that is not running is delivered by an omo process on this
device. So that one can start when none runs, `omo remote bootstrap` and `omo remote enable` install one
fixed per-user unit that runs the omo session host, and record it in the device service's service table as the
only unit it may start for a cold wake (`packages/device-service-core/src/cold-wake/`):

| | Linux | macOS |
| --- | --- | --- |
| Unit | systemd user unit `~/.config/systemd/user/omo-session-host.service` | LaunchAgent `ai.omo.session-host`, `~/Library/LaunchAgents/ai.omo.session-host.plist` |
| Runs | `<omo> daemon run` (an npm launcher script under the runtime that ran it), with `OMO_CODING_AGENT_DIR` set to the agent dir the bootstrap registers and `PATH` as it was at install | same |
| Shape | `Type=oneshot`, `KillMode=process`: each start runs the ensure again, and the host it starts keeps running | loaded but idle: no `RunAtLoad`, no `KeepAlive`, `AbandonProcessGroup` |
| Table entry | `OMO_RELAYD_SERVICES` entry `"omo": {"systemd_user": "omo-session-host.service", "senders": []}` in the drop-in `~/.config/systemd/user/omo-relay-daemon.service.d/50-omo-cold-wake.conf` | entry `"omo": {"launchd": "ai.omo.session-host", "senders": []}` in the device service's plist `EnvironmentVariables` |

The device service reads its table once, at start, so a changed table restarts it (Linux: `systemctl --user
restart omo-relay-daemon.service`; macOS: `launchctl bootout`, then `bootstrap` of `ai.omo.relay-daemon`).
Nothing is written and nothing restarts when the unit and the entry are already in place. Other entries of the
table are kept; a table that does not parse is left as it is, and the command prints a notice instead. Nothing
runs as root, and neither the unit's name nor its command can be configured.

The device service's installer rewrites its macOS plist on every install and update, which drops the entry;
the next `omo remote bootstrap` (every omo start) writes it back. The Linux drop-in survives an install.

`omo remote disable` removes the unit and the entry, and while remote sessions are off,
`omo remote bootstrap` removes them again instead of installing them. A cold wake that cannot be set up
prints one notice on stderr and never changes the command's exit code or output. Windows has no cold wake.

## Windows notes

- The device service listens on a loopback TCP port that it publishes in `endpoint.json` in the state
  dir, instead of a socket file. A stopped service is reported as not running, not as a connection
  error.
- The state dir and its files are restricted to your Windows account (an access control list with
  only your user), set before anything is written.
- `omo remote attach` reaches the attach view over a named pipe derived from its private endpoint and
  secret.
