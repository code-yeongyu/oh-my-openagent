# omo remote - sessions on your other devices

`omo remote` lists and watches the OmO sessions running on the other devices signed in to your
account. It talks to the OmO device service on this device, which holds the connection to your other
devices; `omo remote` never connects to another machine itself. `status`, `devices`, `sessions` and
`control` print a table, `enable` and `disable` print one sentence, and with `--json` each prints the
SDK's typed value as one JSON line instead; `attach` takes no `--json`
(`packages/omo-native/remote-cli.ts`). `bootstrap` prints the status rows when it connects, or a
notice on stderr when it stops; with `--json` it prints one JSON line, `{state, status}` when it
connects or `{state, notice}` when it stops (`packages/omo-native/remote-bootstrap.ts`).

```bash
omo remote status [--json]       # the device service's connection state
omo remote devices [--json]      # the devices on this account
omo remote sessions [--device D] [--project P] [--state running|idle|ended] [--json]
omo remote enable | disable [--json]   # turn remote sessions on or off for this device
omo remote control [on|off]      # whether your other devices may view and command this device's sessions
omo remote bootstrap [--json]    # set up the device service for your sign-in (every omo start runs it)
omo remote attach <device>/<session>   # watch a session on another device
```

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

`omo remote attach <device>/<session>` opens the session in the attach view. It is observe-only for
now: anything you type is refused with "remote input not enabled yet: this view is observe-only"
(`packages/omo-native/remote-attach.ts`).

## Command outcomes

These are the outcomes the device service's local API reports for a command sent to a remote session
(`packages/device-service-core/src/local-api/protocol-events.ts`). `omo remote` itself sends no
commands today (`attach` is observe-only); clients of the local API see these words:

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

## Windows notes

- The device service listens on a loopback TCP port that it publishes in `endpoint.json` in the state
  dir, instead of a socket file. A stopped service is reported as not running, not as a connection
  error.
- The state dir and its files are restricted to your Windows account (an access control list with
  only your user), set before anything is written.
- `omo remote attach` reaches the attach view over a named pipe derived from its private endpoint and
  secret.
