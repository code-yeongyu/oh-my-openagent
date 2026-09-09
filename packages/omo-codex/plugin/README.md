# omo

`omo` is the single local Codex plugin namespace for Yeongyu's Codex components.

Internally each component remains isolated under `components/`:

- `components/comment-checker`
- `components/rules`
- `components/lsp`
- `components/git-bash`
- `components/ulw-execute-continuation`
- `components/ultrawork`
- `components/ulw-loop`
- `components/telemetry`

The root plugin manifest exports one Codex plugin named `omo`, with aggregate hooks, skills, and plugin-scoped MCP servers for `grep_app`, `context7`, `git_bash`, and `lsp`. AST-aware search ships as the `ast-grep` skill, not as an MCP server.

## Default model

`model-catalog.json` (version `2026-09-08.gpt-6-astra-600k-high`) is the managed default the installer and the SessionStart config migration apply: `gpt-6-astra`, 600k context window, `high` reasoning, `xhigh` plan-mode reasoning. Managed legacy profiles, including `legacy.gpt-5.6-sol-650k-high` for configs still on `gpt-5.6-sol`, are upgraded to the current values; a root model outside the catalog is preserved. Neither the installer nor the migration writes or raises subagent thread caps (`agents.max_threads`, `features.multi_agent_v2.max_concurrent_threads_per_session`). They remove only the values LazyCodex itself wrote earlier (`1000`, `16`), with one exception: on a `multi_agent_v2`-preferred model such as `gpt-6-astra`, the V1-only `agents.max_threads` key is removed whatever its value, since Codex rejects it under V2. Every other user-set value is left alone.

## Telemetry

The bundled telemetry component emits the anonymous `omo_codex_daily_active` event at most once per UTC day per machine when the Codex `SessionStart` hook runs. It uses `sha256("omo-codex:" + hostname)` as the distinct ID, disables PostHog person profiles, and stores daily deduplication state in `$XDG_DATA_HOME/omo-codex/posthog-activity.json` or `~/.local/share/omo-codex/posthog-activity.json`.

Captured properties are limited to product/runtime metadata, operating-system metadata, coarse machine shape, locale/timezone, shell/terminal hints, `source`, `reason`, and `day_utc`. It does not send prompt contents, chat transcripts, source files, repository contents, file paths, access tokens, API keys, raw hostnames, Git remotes, usernames, email addresses, or runtime error diagnostics.

Opt out before launching Codex:

```bash
export OMO_CODEX_DISABLE_POSTHOG=1
export OMO_CODEX_SEND_ANONYMOUS_TELEMETRY=0
```

Global opt-out flags also disable this telemetry:

```bash
export OMO_DISABLE_POSTHOG=1
export OMO_SEND_ANONYMOUS_TELEMETRY=0
```

Detailed implementation notes live in `components/telemetry/README.md`; the root product disclosure lives in `docs/reference/codex-telemetry.md` in the source repository.
