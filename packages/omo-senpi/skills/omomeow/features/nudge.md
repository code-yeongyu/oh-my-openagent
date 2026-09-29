# Feature: nudge (version 1)

Every `omomeow.nudge.interval_minutes` (default 30) the user gets one short DM: each task in flight with its name, thread, what it is, elapsed time, and latest progress, blocked sessions first. Nothing is sent when nothing is working or blocked, or when nothing changed since the last nudge (elapsed time alone is not a change). Turn it off with `omomeow.nudge.enabled: false`.

How it runs, with no model turn per nudge:

- A user-level timer service runs `CLI nudge --scheduled` every interval: a launchd agent (`ai.omo.omomeow-nudge`, `StartInterval`) on macOS, a systemd user timer (`omomeow-nudge.timer`) on Linux. It runs a copy of the scripts under `~/.omo/omomeow/runtime/`, so an omo update that moves the skill never breaks it (`reconcile` refreshes the copy), and it runs in the directory it was installed from, so it reads the same `omo.json` layers.
- The nudge has nothing to do with `schedule_prompt` or `senpi schedule run`: scheduled prompts keep senpi's own delivery.
- `nudge` reads `herdr tab list`, joins it with the session map (`CLI session ...`), drops tabs with nothing to report, compares a fingerprint of task, state, name, title, progress, and thread link with what each recipient got last time, and sends through the agent-messenger bot CLI only when it differs. Tasks recorded with a requester go to that person; everything else goes to the owner.

## Install

1. Make sure the owner is set: `CLI owner show`. If it is null, ask where the user wants nudges and run `CLI owner set ...` (see the setup feature).
2. Install the timer: `CLI service install`. It exits non-zero when a service step failed; show the user the failed `steps` entry and stop here. On a platform without launchd or systemd it returns `kind: "manual"` with the command and interval: show them to the user to run under their own scheduler, and continue only once they confirm it is scheduled.
3. Run `CLI nudge --dry-run` once and show the user what the next nudge would say (or that it would stay silent, and why).
4. `CLI record nudge --data '{"service":"<kind from step 2>"}'`.

## Update

A version bump or a changed `interval_minutes`: run `CLI service install` again (it rewrites the service with the current interval and reloads it), then Install steps 3-4.

## Remove

`omomeow.nudge.enabled` turned false, or the feature was retired: `CLI service uninstall`. When it exits non-zero the timer could not be stopped and its file is kept (`kept`); show the user the failed step and do not forget the feature. Otherwise `CLI forget nudge`. For `kind: "manual"`, ask the user to remove the job from their own scheduler first.

## Checking on it

- `CLI snapshot`: current tabs and the items a nudge would report.
- `CLI nudge --dry-run`: the exact message and who would get it, without sending or saving anything.
- `CLI status`: installed features, resolved settings, and whether the timer is installed and loaded.
- `~/.omo/omomeow/logs/nudge.jsonl`: one JSON line per scheduled nudge (what was sent, or why it stayed silent).
- `~/.omo/omomeow/logs/nudge-service.log`: the service's own stdout and stderr.
