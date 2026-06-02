# codex-telemetry

Codex plugin component that emits a single anonymous daily-active event (`omo_codex_daily_active`) to PostHog whenever a Codex session starts.

The event is sent **at most once per UTC day per machine**. It uses a SHA256-hashed installation identifier derived from `omo-codex:${hostname}` and never sends the raw hostname. PostHog person profiles are explicitly disabled.

## Hook Wiring

The component registers a single `SessionStart` hook:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${PLUGIN_ROOT}/dist/cli.js\" hook session-start",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

The aggregate `plugin/hooks/hooks.json` mounts this hook alongside `rules` and `ultrawork` so all three fire in parallel at the start of every Codex session.

## What Is Captured

A single PostHog `capture` call with:

- `event: "omo_codex_daily_active"`
- `distinctId: sha256("omo-codex:" + hostname)`
- `properties`:
  - `platform`, `product_name`, `package_name`, `package_version`
  - `runtime` (`"node"`), `runtime_version`
  - `source: "plugin"`, `reason: "session_start"`
  - `$os`, `$os_version`, `os_arch`, `os_type`
  - `cpu_count`, `cpu_model`, `total_memory_gb`
  - `locale`, `timezone`, `shell`, `ci`, `terminal`
  - `day_utc` (today's UTC date)
  - `$process_person_profile: false`

The component never sends prompt contents, file contents, API keys, raw hostnames, or any user-identifying data.

## Opt-Out

Set any of the following environment variables before launching Codex:

```bash
# Codex-only opt-out
export OMO_CODEX_DISABLE_POSTHOG=1
export OMO_CODEX_SEND_ANONYMOUS_TELEMETRY=0

# Global opt-out (covers both omo and omo-codex)
export OMO_DISABLE_POSTHOG=1
export OMO_SEND_ANONYMOUS_TELEMETRY=0
```

When any of these is set the component creates a no-op PostHog client and exits without any network call.

## Daily Deduplication

The component writes a small JSON state file at:

```
$XDG_DATA_HOME/omo-codex/posthog-activity.json
# or, when XDG_DATA_HOME is unset:
~/.local/share/omo-codex/posthog-activity.json
```

containing `{ "lastActiveDayUTC": "YYYY-MM-DD" }`. If the stored day matches today (UTC), the hook returns without sending anything. The file is written atomically via `rename(2)`.

## Failure Behavior

Every telemetry path is wrapped in `try`/`catch`. The hook always exits 0 with no stdout output, even when PostHog construction, capture, or shutdown fails. Codex session startup is never blocked or slowed by telemetry failures.

## Endpoint Overrides

| Variable | Default |
|----------|---------|
| `POSTHOG_HOST` | `https://us.i.posthog.com` |
| `POSTHOG_API_KEY` | shared `omo-codex` project key |

## Development

```bash
npm install
npm test           # vitest (in-process + subprocess CLI smoke)
npm run typecheck
npm run build      # tsc -> dist/
npm run check      # typecheck + biome + build
```

The component shares its product identity constants with the `@oh-my-opencode/omo-codex` CLI installer. Drift between the two implementations is guarded by `packages/omo-codex/src/telemetry/cross-package-equivalence.test.ts`.

## Privacy

See [the omo Privacy Policy](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/legal/privacy-policy.md) for the full disclosure.
