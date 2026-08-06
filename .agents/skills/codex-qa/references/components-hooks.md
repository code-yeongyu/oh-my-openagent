# omo-codex components → events → observable proof

The plugin's hook wiring lives in
`packages/omo-codex/plugin/hooks/hooks.json`. Each hook runs
`node "${PLUGIN_ROOT}/components/<c>/dist/cli.js" hook <event>`, reading the
event JSON on stdin and writing zero-or-one line of JSON on stdout.

Use this table to pick what to assert. Two proof tiers:

- **Unit** (`hook-unit-probe.sh`): pipe a synthetic event into a component's
  `dist/cli.js`, assert stdout/disk. Deterministic, no codex process.
- **Live** (`app-server-drive.sh --plugin`): drive a real turn, assert the
  `hook/completed` notification fires for the event. Proves Codex WIRES it.

| Component | Codex events | Observable proof it fired |
|---|---|---|
| `rules` | SessionStart; UserPromptSubmit; PostToolUse `apply_patch`; PostCompact | `hookSpecificOutput.additionalContext` (rule body) on stdout; session cache at `$PLUGIN_DATA/sessions/<id>.json` |
| `ultrawork` | UserPromptSubmit | stdout `additionalContext` contains `<ultrawork-mode>` **only** when prompt matches `/ultrawork|ulw/i`; empty otherwise |
| `ulw-loop` | UserPromptSubmit; PreToolUse `create_goal` | steer JSON on a steer prompt; `permissionDecision:"deny"` when `create_goal` carries keys beyond `objective` |
| `comment-checker` | PostToolUse (write/edit/apply_patch) | warning text on stdout when an edited file has banned comments; empty when clean |
| `lsp` | PostToolUse (write/edit/apply_patch); PostCompact | LSP diagnostics as `additionalContext` for mutated files |
| `start-work-continuation` | Stop; SubagentStop | `{"decision":"block","reason":...}` **only** when a continuation/boulder state exists for the session |
| `git-bash` | PreToolUse `Bash`; PostCompact | **Windows-only**: reminder + marker `$PLUGIN_DATA/git-bash-reminder/<id>.seen`; no-op elsewhere |
| `telemetry` | SessionStart | empty stdout; side effect is a PostHog event (or a diagnostic file on failure) |
| `bootstrap` | SessionStart | `BOOTSTRAP_RESTART_NOTICE` additionalContext on first run (gated on `PLUGIN_ROOT`+`PLUGIN_DATA`) |

Many components are **conditional** (only emit on a matching prompt / OS / state).
For a stable always-fires assertion, prefer:

- Live: `sessionStart` and `userPromptSubmit` `hook/completed` (several components
  wire them, so the events always fire). `app-server-drive.sh --plugin` defaults
  to `--expect sessionStart,userPromptSubmit`.
- Unit: `ultrawork` on an `ulw` prompt deterministically injects `<ultrawork-mode>`.

`hook/*` notification eventNames are camelCase (`sessionStart`,
`userPromptSubmit`, `postToolUse`, `stop`, …); the hooks.json matchers use
snake_case (`session_start`, `user_prompt_submit`, …). The component CLI takes
the kebab form (`hook user-prompt-submit`).
