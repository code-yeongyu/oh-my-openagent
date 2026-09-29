## skills/omomeow: OmOMeow mode as an updatable skill, first feature the periodic status nudge

- `skills/omomeow/`: new native skill. `SKILL.md` carries the OmOMeow-mode behavior that used to live in a copy-once
  setup prompt; `manifest.json` lists versioned features (`setup`, `nudge`) documented in `features/<id>.md`.
  `scripts/omomeow.mjs reconcile` compares the manifest with `~/.omo/omomeow/state.json` and returns only what to
  install, update (version bump or changed setting), or remove, so an existing user never re-runs the whole setup.
- nudge: a user timer service (`service install`: a launchd agent with `StartInterval` on macOS, a systemd user timer on
  Linux, the command to schedule elsewhere) runs `omomeow.mjs nudge --scheduled` from a runtime copy of the scripts under
  the state dir every `interval_minutes`. It reads `herdr tab list`, joins the thread/tab/session map, and DMs each
  requester through the agent-messenger bot CLI only when something is working or blocked and the
  task/state/title/progress fingerprint changed. It does not use `schedule_prompt`, so scheduled prompts keep senpi's
  own delivery and busy-session guard. `service uninstall` keeps the service file and fails when the timer cannot be
  stopped.
- A setup done by hand before the skill (the old gist) is reported by `reconcile` (`existing`: Herdr and bot CLIs on
  PATH) and adopted after one confirmation instead of replayed.
- `native-skill-sources.mjs`, `BUILTIN_SKILL_NAMES`, and the skill-sync expectations list `omomeow`.

## model-profile, task: builtin lanes and the category notice never route to an unlisted gateway (#9146)

- `components/model-profile/resolve.ts`: every builtin rung, in `recommended` and in the `daily-*`/`geeky-*` lanes, is
  served only by its listed providers, so a lane never lands the session on a gateway's copy of its model
  (`opengateway/anthropic/claude-opus-5-5`). A lane no listed provider serves is `unavailable` and keeps the session
  model with the existing one-line notice. A user's bare model id, which names no provider, still matches anywhere.
  `rankedProvidersOnly` is gone: it was the only builtin that had the listed-only rule, which is now the rule.
- `components/task/category-unavailable-warning.ts`: when only an unlisted provider serves a hidden category's chain,
  the one notice per session names it and the exact opt-in line
  (`categories.<name>.model = "<gateway>/<model>"`); `details.unlisted_provider_model` carries it for remote clients.

