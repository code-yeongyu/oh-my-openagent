# Codex Light Telemetry

Codex Light, installed through `lazycodex-ai`, sends anonymous daily-active telemetry for the Codex adapter only. The public package alias is `lazycodex-ai`; the Codex marketplace identity remains `sisyphuslabs` / `omo`.

## Event

The Codex adapter emits one PostHog event:

| Field | Value |
| ----- | ----- |
| Event name | `omo_codex_daily_active` |
| Product platform | `omo-codex` |
| Distinct ID | `sha256("omo-codex:" + hostname)` |
| Daily limit | At most once per UTC day per machine |
| Person profiles | Disabled with `$process_person_profile: false` |

The raw hostname is never sent. It is used locally only to derive the one-way hashed distinct ID.

## Sources

Two paths can attempt to send the same daily event. They share the same daily deduplication state, so a machine should still count once per UTC day.

| Source | Reason | Trigger |
| ------ | ------ | ------- |
| `install` | `install_completed` | `npx lazycodex-ai install`, `omo install --platform=codex`, or `omo install --platform=both` finishes |
| `plugin` | `session_start` | The Codex plugin `SessionStart` hook runs at the start of a Codex session |

The installer path is implemented in `packages/omo-codex/src/telemetry/`. The runtime plugin path is implemented in `packages/omo-codex/plugin/components/telemetry/`, which is copied into the `code-yeongyu/lazycodex` marketplace repository under `plugins/omo/components/telemetry/`.

## Properties

The event properties are limited to product, runtime, operating-system, coarse machine, and locale metadata:

- `platform`, `product_name`, `package_name`, `package_version`
- `runtime`, `runtime_version`
- `source`, `reason`, `day_utc`
- `$os`, `$os_version`, `os_arch`, `os_type`
- `cpu_count`, `cpu_model`, `total_memory_gb`
- `locale`, `timezone`, `shell`, `ci`, `terminal`
- `$process_person_profile: false`

Telemetry does not send prompt contents, chat transcripts, source files, repository contents, file paths, access tokens, API keys, raw hostnames, Git remotes, usernames, email addresses, or runtime error diagnostics.

## Local State

Daily deduplication state is stored locally at:

```text
$XDG_DATA_HOME/omo-codex/posthog-activity.json
```

When `XDG_DATA_HOME` is unset, the default path is:

```text
~/.local/share/omo-codex/posthog-activity.json
```

The file contains the last UTC day captured for the machine, for example:

```json
{ "lastActiveDayUTC": "2026-06-03" }
```

## Opt Out

Set one of these environment variables before running the installer or launching Codex.

Codex-only opt-out:

```bash
export OMO_CODEX_DISABLE_POSTHOG=1
export OMO_CODEX_SEND_ANONYMOUS_TELEMETRY=0
```

Global opt-out, covering both oh-my-openagent and omo-codex telemetry:

```bash
export OMO_DISABLE_POSTHOG=1
export OMO_SEND_ANONYMOUS_TELEMETRY=0
```

When telemetry is disabled, the PostHog client is a no-op and no telemetry network call is made.

## Failure Behavior

Telemetry is best effort. The Codex plugin telemetry hook exits successfully with no output when PostHog cannot be loaded, constructed, captured, or flushed, so Codex session startup is not blocked by telemetry failures.

See also the [Privacy Policy](../legal/privacy-policy.md), [CLI reference](./cli.md#telemetry-and-opt-out), and [environment variable reference](./configuration.md#environment-variables).
