# Feature: nudge (version 1)

Every `omomeow.nudge.interval_minutes` (default 30) the user gets one short DM: each task in flight with its name, thread, what it is, elapsed time, and latest progress, blocked sessions first. Nothing is sent when nothing is working or blocked, or when nothing changed since the last nudge (elapsed time alone is not a change). Turn it off with `omomeow.nudge.enabled: false`.

How it runs, with no model turn per nudge:

- A recurring `schedule_prompt` job fires on the interval. Its prompt starts with the `[omomeow:nudge]` marker.
- A `senpi schedule run --watch` runner delivers it through the omomeow hook (`--exec ... omomeow.mjs schedule-hook`). The hook runs `nudge`; every other scheduled prompt goes through the hook's fallback, which resumes its session the way senpi's default delivery does.
- `nudge` reads `herdr tab list`, joins it with the session map (`CLI session ...`), drops tabs with nothing to report, compares a fingerprint of task, state, title, and progress with what each recipient got last time, and sends through the agent-messenger bot CLI only when it differs. Tasks recorded with a requester go to that person; everything else goes to the owner.
- If another runner without the omomeow hook delivers the job instead, the prompt itself tells the session to run `nudge` once and reply with its JSON only, so the nudge still happens, at the cost of one model turn.

## Install

1. Make sure the owner is set: `CLI owner show`. If it is null, ask where the user wants nudges and run `CLI owner set ...` (see the setup feature).
2. Check the runner: `CLI runner status`.
   - `ours: true`: a runner with the omomeow hook is live. Nothing to do.
   - `live: 0`: install the service with `CLI runner install` (launchd on macOS, a systemd user unit on Linux; it copies the scripts to `~/.omo/omomeow/runtime/` so omo updates never break the service path). Pass `--senpi-bin <path>` if the CLI picked the wrong binary (it prefers `omo` for `~/.omo/agent`, else `senpi`). On other platforms, show the user the `runner render` command line to run under their own supervisor.
   - `others` not empty: a runner with a different `--exec` hook already serves this agent dir. Do not start a second one. Tell the user; the nudge still works through the prompt fallback above, or they can point their hook at `schedule-hook` for the nudge job.
3. Get the prompt: `CLI nudge-prompt`, and use its `prompt` value verbatim.
4. Create the job with `schedule_prompt` (find it with `tool_search` if it is not loaded): `action: "create"`, `prompt: <that value>`, `delaySeconds` and `everySeconds` both `interval_minutes * 60`. Keep the returned job id.
5. Run `CLI nudge --dry-run` once and show the user what the next nudge would say (or that it would stay silent, and why).
6. `CLI record nudge --data '{"scheduleId":"<job id>"}'`.

## Update

A version bump or a changed `interval_minutes`: cancel the old job with `schedule_prompt` `action: "cancel"`, `id: <data.scheduleId>` (a job that no longer exists is fine), then do Install steps 2-6 again.

## Remove

`omomeow.nudge.enabled` turned false, or the feature was retired: cancel the job (`schedule_prompt` `action: "cancel"`, `id: <data.scheduleId>`), then `CLI forget nudge`. Leave the runner service in place when other scheduled prompts may need it; `CLI runner uninstall` removes it when the user wants it gone.

## Checking on it

- `CLI snapshot`: current tabs and the items a nudge would report.
- `CLI nudge --dry-run`: the exact message and who would get it, without sending or saving anything.
- `CLI status`: installed features, resolved settings, runner leases.
- `~/.omo/omomeow/logs/nudge.jsonl`: one JSON line per scheduled nudge (what was sent, or why it stayed silent).
- Runner log: `~/.omo/omomeow/logs/schedule-runner.log` (the runner's own `fired` events).
