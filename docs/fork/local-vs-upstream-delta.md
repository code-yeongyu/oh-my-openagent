# Local vs upstream delta review

## Scope and evidence

This document is an inventory-only audit for the local parity fork. It records observed local deltas without normalizing them.

Primary evidence used for this review:

- `C:\Users\RedFox\.config\opencode\opencode.json`
- `C:\Users\RedFox\.config\opencode\oh-my-opencode.json`
- `C:\Users\RedFox\.config\opencode\plugins\heartbeat-status.js`
- `C:\Users\RedFox\.config\opencode\plugins\tls-certificate-retry.js`
- `C:\Users\RedFox\.config\opencode\node_modules\oh-my-openagent\dist\oh-my-opencode.schema.json`
- `src/plugin-config.ts`
- `src/shared/jsonc-parser.ts`
- `src/cli/config-manager/add-plugin-to-opencode-config.ts`
- `docs/guide/installation.md`
- `docs/reference/configuration.md`

The installed schema and repo sources are the compatibility baseline for this audit. The local plugin config still points `$schema` at the remote `dev` URL, but this review does not treat that URL itself as the source of truth.

## Config-only deltas

### Host config delta

- The inspected local OpenCode host config sets `default_agent = prometheus` in `opencode.json`.

### Plugin config deltas

- All configured local agent overrides pin to `openai/gpt-5.4` with `variant = xhigh` and `textVerbosity: high`: `sisyphus`, `hephaestus`, `oracle`, `librarian`, `explore`, `multimodal-looker`, `prometheus`, `metis`, `momus`, `atlas`, and `sisyphus-junior`.
- All configured local category overrides pin to `openai/gpt-5.4` with `variant = xhigh` and `textVerbosity: high`: `visual-engineering`, `ultrabrain`, `deep`, `artistry`, `quick`, `unspecified-low`, `unspecified-high`, and `writing`.
- The local config adds `prompt_append` additions for `sisyphus`, `hephaestus`, `prometheus`, `atlas`, and `sisyphus-junior`.

### Supported runtime knob differences

The installed schema explicitly supports the following local runtime knob differences, so they are config deltas rather than immediate drift by themselves:

| Path | Local value | Why it is classified as config-only |
| --- | --- | --- |
| `hashline_edit` | `true` | Root schema property exists. |
| `background_task.staleTimeoutMs` | `600000` | `background_task` schema supports `staleTimeoutMs`. |
| `babysitting.timeout_ms` | `300000` | `babysitting` schema supports `timeout_ms`. |
| `model_capabilities.refresh_timeout_ms` | `10000` | `model_capabilities` schema supports `refresh_timeout_ms`. |
| `experimental.auto_resume` | `true` | `experimental` schema supports `auto_resume`. |
| `notification.force_enable` | `true` | `notification` schema supports `force_enable`. |

Related local runtime tuning is also present in supported schema space, including `background_task.defaultConcurrency`, `background_task.providerConcurrency.openai`, `background_task.modelConcurrency["openai/gpt-5.4"]`, `model_capabilities.enabled`, `model_capabilities.auto_refresh_on_start`, `experimental.task_system`, and `sisyphus_agent.{planner_enabled,replace_plan,default_builder_enabled}`.

## Plugin/code deltas

- `plugins/heartbeat-status.js` is a local custom plugin that layers heartbeat/status behavior on top of the upstream plugin. The current file tracks tool/message activity, todo summaries, retry/error states, and provider-block handling, then emits status toasts/log entries instead of relying on upstream defaults alone.
- `plugins/tls-certificate-retry.js` is a local custom plugin that retries retryable certificate/connectivity failures after `RETRY_DELAY_MS = 60_000`, reconstructs the last user payload before retry, and stops automatic retry on hard 403-style provider/account/proxy blocks.

## Intended extension points

- `src/plugin-config.ts` loads user config first, project config second, and deep-merges `agents` and `categories` while unioning the `disabled_*` arrays. That makes the local agent/category pinning and prompt customization a supported extension path.
- The installed schema explicitly supports agent/category overrides, `prompt_append`, and the runtime knobs called out above, so those keys belong in the supported-extension bucket unless a later task proves a behavior mismatch.
- `src/cli/config-manager/add-plugin-to-opencode-config.ts` and `docs/guide/installation.md` both show that OpenCode host config is expected to use an explicit `plugin` array entry, with `oh-my-openagent` preferred and legacy `oh-my-opencode` entries normalized during the transition.
- `src/shared/jsonc-parser.ts`, `docs/reference/configuration.md`, and the compatibility contract all show that legacy `oh-my-opencode` alias/basename support should not be treated as drift. The current loader checks `oh-my-opencode` before `oh-my-openagent`, so legacy file naming remains compatibility behavior in this phase.

## Suspicious runtime drift

### Missing visible plugin registration

The inspected `opencode.json` contains only `$schema` and `default_agent`, so there is missing visible plugin registration in the host config. Because repo docs and config-manager code expect explicit `plugin` array registration, any currently working local plugin load is not explained by the inspected host config alone.

### `sisyphus.tasks.enabled`

- The local `oh-my-opencode.json` sets `sisyphus.tasks.enabled = true`.
- The installed schema allows `sisyphus.tasks.storage_path`, `sisyphus.tasks.task_list_id`, and `sisyphus.tasks.claude_code_compat`, but it does not allow `sisyphus.tasks.enabled`.
- No inspected repo file in this task established `sisyphus.tasks.enabled` as a documented merge or schema key, so this should be treated as suspicious runtime drift until a later task proves intentional support.

## Classification summary

- Config-only deltas: `default_agent = prometheus`, full `openai/gpt-5.4` + `xhigh` + `textVerbosity: high` pinning, the five `prompt_append` additions, and the supported runtime knob differences.
- Plugin/code deltas: the local heartbeat-status and TLS certificate retry plugins.
- Intended extension points: merge semantics, schema-supported overrides, explicit `plugin` array registration, and legacy `oh-my-opencode` compatibility handling.
- Suspicious runtime drift: missing visible plugin registration in the inspected host config and `sisyphus.tasks.enabled`.
