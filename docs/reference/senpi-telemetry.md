# Senpi Telemetry Reference

## What this is

OmO Native is the anonymous product analytics pipeline for the omo-senpi adapter. It is enabled by default and uses an opt-out model: every switch in the opt-out matrix below turns it fully off. Telemetry sends to the PostHog project configured in the packaged default; setting `POSTHOG_API_KEY` overrides that project key.

The payloads carry only booleans, buckets, counters, and allowlisted enum values. No free-form text ever leaves your machine. The exact schema is machine-generated below; if the generator and this document ever disagree, a drift test fails in CI.

<!-- BEGIN GENERATED SCHEMA -->
## Event schema

| Event | Property | Type | Allowed values |
|-------|----------|------|----------------|
| `daily_active` | `$session_id` | `string` | - |
| `daily_active` | `day_utc` | `string` | - |
| `daily_active` | `reason` | `string` | `session_start` |
| `session_started` | `$session_id` | `string` | - |
| `session_started` | `$os` | `string` | - |
| `session_started` | `$os_version` | `string` | - |
| `session_started` | `arch` | `string` | - |
| `session_started` | `cpu_count` | `number` | - |
| `session_started` | `default_model` | `string` | `qwen3.6-flash`, `qwen3.8-max-preview`, `claude-fable-5`, `claude-haiku-4-5`, `claude-opus-5`, `claude-sonnet-5`, `deepseek-v4-flash`, `deepseek-v4-pro`, `gemini-3.1-pro`, `gemini-3.6-flash`, `gpt-5.6-sol`, `gpt-5.6-terra`, `grok-4.6`, `k3`, `kimi-for-coding-highspeed`, `kimi-k3`, `gpt-5.6-luna-fast`, `glm-5.2`, `mimo-v2.5-pro`, `minimax-m2.7`, `minimax-m3`, `grok-4.20-0309-non-reasoning`, `custom` |
| `session_started` | `default_provider` | `string` | `alibaba-token-plan`, `alibaba-token-plan-cn`, `anthropic`, `anthropic-api`, `bailian-coding-plan`, `deepseek`, `google`, `github-copilot`, `kimi-coding`, `kimi-for-coding`, `moonshotai`, `openai`, `openai-codex`, `opencode`, `opencode-go`, `quotio-openai`, `qwen-token-plan`, `qwen-token-plan-cn`, `vercel`, `xai`, `xiaomi`, `zai-coding-plan`, `custom` |
| `session_started` | `memory_bucket` | `string` | `lt_8_gb`, `8_15_gb`, `16_31_gb`, `32_63_gb`, `64_plus_gb` |
| `session_started` | `model_count` | `number` | - |
| `session_started` | `provider_count` | `number` | - |
| `session_started` | `providers` | `string` | - |
| `session_started` | `reason` | `string` | `startup`, `reload`, `new`, `resume`, `fork` |
| `session_started` | `timezone` | `string` | - |
| `prompt_submitted` | `$session_id` | `string` | - |
| `prompt_submitted` | `input_source` | `string` | `interactive`, `rpc`, `extension` |
| `prompt_submitted` | `invocation_stage` | `string` | `none`, `first_arm`, `remention`, `post_compact_rearm` |
| `prompt_submitted` | `is_effective_ultrawork_invocation` | `boolean` | - |
| `prompt_submitted` | `is_real_user_prompt` | `boolean` | - |
| `prompt_submitted` | `is_turn_start` | `boolean` | - |
| `prompt_submitted` | `keyword_any` | `boolean` | - |
| `prompt_submitted` | `keyword_occurrence_bucket` | `string` | `1`, `2`, `3_5`, `6_plus` |
| `prompt_submitted` | `keyword_ultrawork_full` | `boolean` | - |
| `prompt_submitted` | `keyword_ulw_abbrev` | `boolean` | - |
| `prompt_submitted` | `keyword_variant` | `string` | `none`, `ulw`, `ultrawork`, `both` |
| `prompt_submitted` | `prompt_length_bucket` | `string` | `lt_100`, `100_500`, `500_2000`, `gte_2000` |
| `prompt_submitted` | `queue_mode` | `string` | `immediate`, `follow_up`, `steer`, `other` |
| `prompt_submitted` | `real_prompt_ordinal_bucket` | `string` | `1`, `2_3`, `4_10`, `11_25`, `26_plus` |
| `prompt_submitted` | `suppression_reason` | `string` | `none`, `no_keyword`, `extension_source`, `embedded_directive`, `skill_expansion`, `skill_name_only` |
| `turn_completed` | `$session_id` | `string` | - |
| `turn_completed` | `cache_read_tokens` | `number` | - |
| `turn_completed` | `cache_write_tokens` | `number` | - |
| `turn_completed` | `cost_usd` | `number` | - |
| `turn_completed` | `input_tokens` | `number` | - |
| `turn_completed` | `model_id` | `string` | `qwen3.6-flash`, `qwen3.8-max-preview`, `claude-fable-5`, `claude-haiku-4-5`, `claude-opus-5`, `claude-sonnet-5`, `deepseek-v4-flash`, `deepseek-v4-pro`, `gemini-3.1-pro`, `gemini-3.6-flash`, `gpt-5.6-sol`, `gpt-5.6-terra`, `grok-4.6`, `k3`, `kimi-for-coding-highspeed`, `kimi-k3`, `gpt-5.6-luna-fast`, `glm-5.2`, `mimo-v2.5-pro`, `minimax-m2.7`, `minimax-m3`, `grok-4.20-0309-non-reasoning`, `custom` |
| `turn_completed` | `output_tokens` | `number` | - |
| `turn_completed` | `provider` | `string` | `alibaba-token-plan`, `alibaba-token-plan-cn`, `anthropic`, `anthropic-api`, `bailian-coding-plan`, `deepseek`, `google`, `github-copilot`, `kimi-coding`, `kimi-for-coding`, `moonshotai`, `openai`, `openai-codex`, `opencode`, `opencode-go`, `quotio-openai`, `qwen-token-plan`, `qwen-token-plan-cn`, `vercel`, `xai`, `xiaomi`, `zai-coding-plan`, `custom` |
| `turn_completed` | `reasoning_tokens` | `number` | - |
| `turn_completed` | `total_tokens` | `number` | - |
| `turn_completed` | `turn_index` | `number` | - |
| `skill_loaded` | `$session_id` | `string` | - |
| `skill_loaded` | `skill_name` | `string` | `ast-grep`, `coding-agent-sessions`, `dag-library`, `data-scientist`, `debugging`, `frontend`, `git-master`, `give-me-tips`, `hyperplan`, `init-deep`, `lsp-setup`, `mass-ulw`, `onboarding`, `programming`, `refactor`, `remove-ai-slops`, `review-work`, `ulw-execute`, `ultimate-browsing`, `ultrawork`, `ulw-loop`, `ulw-plan`, `ulw-research`, `visual-qa` |
| `delegation_started` | `$session_id` | `string` | - |
| `delegation_started` | `background` | `boolean` | - |
| `delegation_started` | `batch_size_bucket` | `string` | `1`, `2_4`, `5_plus` |
| `delegation_started` | `kind` | `string` | `category`, `subagent` |
| `delegation_started` | `name` | `string` | `visual-engineering`, `artistry`, `ultrabrain`, `deep`, `quick`, `unspecified-low`, `architect`, `unspecified-high`, `writing`, `explore`, `librarian`, `metis`, `momus`, `custom` |
| `feature_used` | `$session_id` | `string` | - |
| `feature_used` | `feature` | `string` | `goal_tool`, `team_create`, `memory_tool` |
| `parallelism_summary` | `$session_id` | `string` | - |
| `parallelism_summary` | `clock_anomalies` | `number` | - |
| `parallelism_summary` | `dropped_calls` | `number` | - |
| `parallelism_summary` | `eval_execution_detached_count` | `number` | - |
| `parallelism_summary` | `eval_execution_event_bus_available` | `boolean` | - |
| `parallelism_summary` | `eval_execution_event_count` | `number` | - |
| `parallelism_summary` | `eval_execution_event_rejected_count` | `number` | - |
| `parallelism_summary` | `eval_execution_ok_count` | `number` | - |
| `parallelism_summary` | `eval_cells_with_nested_count` | `number` | - |
| `parallelism_summary` | `eval_saved_prefix_tokens` | `number` | - |
| `parallelism_summary` | `eval_nested_tool_call_count` | `number` | - |
| `parallelism_summary` | `eval_nested_tool_call_error_count` | `number` | - |
| `parallelism_summary` | `eval_nested_tool_call_ok_count` | `number` | - |
| `parallelism_summary` | `eval_nested_tool_call_pending_count` | `number` | - |
| `parallelism_summary` | `eval_only_duration_ms` | `number` | - |
| `parallelism_summary` | `eval_only_waves` | `number` | - |
| `parallelism_summary` | `eval_outer_joined_calls` | `number` | - |
| `parallelism_summary` | `eval_tool_aggregate_truncated_execution_count` | `number` | - |
| `parallelism_summary` | `incomplete_calls` | `number` | - |
| `parallelism_summary` | `measured_eval_execution_duration_ms_sum` | `number` | - |
| `parallelism_summary` | `measured_eval_nested_tool_duration_ms_sum` | `number` | - |
| `parallelism_summary` | `measured_turn_duration_ms_total` | `number` | - |
| `parallelism_summary` | `mixed_non_eval_joined_calls` | `number` | - |
| `parallelism_summary` | `mixed_waves` | `number` | - |
| `parallelism_summary` | `modeled_wallclock_saved_ms` | `number` | - |
| `parallelism_summary` | `non_eval_joined_calls` | `number` | - |
| `parallelism_summary` | `non_eval_saved_prefix_tokens` | `number` | - |
| `parallelism_summary` | `non_eval_saved_round_trips` | `number` | - |
| `parallelism_summary` | `non_eval_wave_size_histogram` | `string` | - |
| `parallelism_summary` | `non_eval_waves_multi` | `number` | - |
| `parallelism_summary` | `non_eval_waves_total` | `number` | - |
| `parallelism_summary` | `schema_kind` | `string` | `parallelism_v1`, `parallelism_v2`, `parallelism_v3` |
| `parallelism_summary` | `upper_bound_saved_ms` | `number` | - |
| `parallelism_summary` | `current_prefix_tokens` | `number` | - |
| `delegation_completed` | `$session_id` | `string` | - |
| `delegation_completed` | `agent_type` | `string` | `explore`, `librarian`, `metis`, `momus`, `custom`, `none` |
| `delegation_completed` | `background_mode` | `string` | `foreground`, `background`, `promoted`, `unknown` |
| `delegation_completed` | `cache_read_tokens` | `number` | - |
| `delegation_completed` | `cache_write_tokens` | `number` | - |
| `delegation_completed` | `category` | `string` | `visual-engineering`, `artistry`, `ultrabrain`, `deep`, `quick`, `unspecified-low`, `architect`, `unspecified-high`, `writing`, `custom`, `none` |
| `delegation_completed` | `config_generation` | `number` | - |
| `delegation_completed` | `cost_status` | `string` | `reported`, `unavailable`, `invalid` |
| `delegation_completed` | `cost_usd` | `number` | - |
| `delegation_completed` | `duration_ms` | `number` | - |
| `delegation_completed` | `duration_status` | `string` | `monotonic`, `wall_clock`, `unavailable` |
| `delegation_completed` | `execution_mode` | `string` | `in-process`, `process` |
| `delegation_completed` | `fallback_attempts` | `number` | - |
| `delegation_completed` | `input_tokens` | `number` | - |
| `delegation_completed` | `model_id` | `string` | `qwen3.6-flash`, `qwen3.8-max-preview`, `claude-fable-5`, `claude-haiku-4-5`, `claude-opus-5`, `claude-sonnet-5`, `deepseek-v4-flash`, `deepseek-v4-pro`, `gemini-3.1-pro`, `gemini-3.6-flash`, `gpt-5.6-sol`, `gpt-5.6-terra`, `grok-4.6`, `k3`, `kimi-for-coding-highspeed`, `kimi-k3`, `gpt-5.6-luna-fast`, `glm-5.2`, `mimo-v2.5-pro`, `minimax-m2.7`, `minimax-m3`, `grok-4.20-0309-non-reasoning`, `custom` |
| `delegation_completed` | `model_source` | `string` | `category`, `explicit`, `agent`, `none` |
| `delegation_completed` | `output_tokens` | `number` | - |
| `delegation_completed` | `owner_kind` | `string` | `plain_child`, `dag_node`, `team_member`, `unknown` |
| `delegation_completed` | `provider` | `string` | `alibaba-token-plan`, `alibaba-token-plan-cn`, `anthropic`, `anthropic-api`, `bailian-coding-plan`, `deepseek`, `google`, `github-copilot`, `kimi-coding`, `kimi-for-coding`, `moonshotai`, `openai`, `openai-codex`, `opencode`, `opencode-go`, `quotio-openai`, `qwen-token-plan`, `qwen-token-plan-cn`, `vercel`, `xai`, `xiaomi`, `zai-coding-plan`, `custom` |
| `delegation_completed` | `reasoning_effort` | `string` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, `other`, `none` |
| `delegation_completed` | `run_epoch` | `number` | - |
| `delegation_completed` | `start_reason` | `string` | `initial_spawn`, `runtime_fallback`, `session_resume`, `dag_retry`, `revive_after_completed`, `revive_after_error`, `revive_after_cancelled`, `revive_after_interrupted`, `revive_after_lost`, `unknown` |
| `delegation_completed` | `stats_status` | `string` | `complete`, `partial`, `unavailable` |
| `delegation_completed` | `status` | `string` | `completed`, `error`, `cancelled`, `interrupted`, `lost` |
| `delegation_completed` | `task_send_queued_count` | `number` | - |
| `delegation_completed` | `task_send_running_count` | `number` | - |
| `delegation_completed` | `task_seq` | `number` | - |
| `delegation_completed` | `token_status` | `string` | `complete`, `partial`, `unavailable` |
| `delegation_completed` | `tool_calls` | `number` | - |
| `delegation_completed` | `total_tokens` | `number` | - |
| `delegation_completed` | `turns` | `number` | - |
| `category_config` | `$session_id` | `string` | - |
| `category_config` | `builtin_overridden_count` | `number` | - |
| `category_config` | `cat_architect` | `string` | - |
| `category_config` | `cat_artistry` | `string` | - |
| `category_config` | `cat_deep` | `string` | - |
| `category_config` | `cat_quick` | `string` | - |
| `category_config` | `cat_ultrabrain` | `string` | - |
| `category_config` | `cat_unspecified_high` | `string` | - |
| `category_config` | `cat_unspecified_low` | `string` | - |
| `category_config` | `cat_visual_engineering` | `string` | - |
| `category_config` | `cat_writing` | `string` | - |
| `category_config` | `combo_fingerprint` | `string` | - |
| `category_config` | `config_generation` | `number` | - |
| `category_config` | `source` | `string` | `startup`, `reload`, `new`, `resume`, `fork` |
| `category_config` | `user_category_count` | `number` | - |
<!-- END GENERATED SCHEMA -->

### Parallelism v2 interpretation

`parallelism_v3` consumes Senpi's in-process `senpi.eval.execution` event and
adds fixed scalar rollups for eval-internal tool calls plus counterfactual prefix
accounting. The event's
`toolCallCount` remains authoritative even when its enriched per-call detail
array is capped. Tool names, arguments, result previews, paths, and aggregate
map keys are discarded before the PostHog boundary.

Top-level wave metrics and eval-internal calls remain separate populations.
`eval_outer_joined_calls` counts top-level eval wrappers,
`mixed_non_eval_joined_calls` counts direct non-eval calls in mixed waves, and
`eval_nested_tool_call_count` counts tools executed inside eval cells. Nested
durations are sums of per-call elapsed durations and may overlap, so they do
not prove concurrency, wall-clock savings, or saved round trips.

Historical `parallelism_v1` and `parallelism_v2` rows do not carry the v3
fields. On v3 rows,
`eval_execution_event_bus_available` reports host bus availability, not proof
that every producer emitted an event. Use the accepted and rejected event
counts when evaluating rollout coverage.

### Reasoning tokens caveat

`turn_completed` reports `reasoning_tokens`. That field is optional and is a subset of `output_tokens`, not an addition to it. Never add `reasoning_tokens` to `output_tokens` when computing totals, or you double count.

### Delegation and category config events

`delegation_completed` fires at most once per task run, on the nonterminal-to-terminal status edge of a delegated task (`completed`, `error`, `cancelled`, `interrupted`, or `lost`). Its `$session_id` is the salted hash of the parent session that owns the task, even when the row is emitted long after that session was resumed. `category_config` snapshots the effective builtin category-to-model map once per `config_generation`; a snapshot is only re-emitted when the canonical map actually changed. Join the two events on `($session_id, config_generation)`, never on event order: re-registration can replay snapshots out of order.

#### Parent follow-up, not "revision request"

`task_send_running_count` counts accepted parent messages delivered while the child was running in the reported `run_epoch`. `task_send_queued_count` counts messages queued before the child launched. Neither is a revision-request metric, and no dashboard may label it as one. Message intent (revision, added context, nudge, status poll, crash recovery, control traffic) is not identifiable without the message text, which never leaves the machine, so the honest published name is parent follow-up rate. Queued sends are reported separately and never enter the follow-up numerator: a prelaunch message cannot revise output that does not exist yet.

Related: the re-query signal is `start_reason = 'revive_after_completed'` only. Revives after `error`, `cancelled`, `interrupted`, or `lost` are recovery and belong in a separate rate.

#### Coverage status fields

Omitting an unavailable number is invisible inside a `sum()`, where missing silently reads as zero. Four status enums make coverage explicit:

- `cost_status`: sum `cost_usd` only where `cost_status = 'reported'`. A reported zero is a real zero; an absent cost is not.
- `token_status`: sum token fields only where `token_status = 'complete'`. `partial` means some turns reported usage and some did not.
- `duration_status`: average or percentile durations only where `duration_status = 'monotonic'`. `wall_clock` values come from record timestamps and can include suspended age or clock skew.
- `stats_status`: exclude `stats_status = 'unavailable'` rows (tasks that never ran, or were reconciled as lost) from efficiency metrics.

Every cost or time dashboard must publish its coverage column alongside the aggregate, for example `countIf(cost_status = 'reported') / count()`. An aggregate without its coverage is misleading by construction.

#### Known undercounts

- Runtime fallback: tokens and cost consumed by a destroyed pre-fallback attempt are lost. `fallback_attempts > 0` flags the row and its `token_status` / `cost_status` degrade when totals cannot be vouched for. Cost per category is a lower bound for these tasks.
- Session shutdown suspension: work done before a suspension is never counted. The resumed run emits with `start_reason = 'session_resume'` and only the resumed epoch's stats.
- Background completion after client shutdown: a task that terminates after the spawning host's telemetry client shut down emits nothing. Completion counts are a lower bound; use `delegation_started` as the request denominator, never the completion count.

#### Country queries and delayed delivery

GeoIP country is derived server side from the transport's sending IP at delivery time. For rows delivered late, that IP belongs to whatever network the draining host is on, not the network where the task executed. Country queries must therefore exclude rows with `start_reason = 'session_resume'` or `stats_status = 'unavailable'`. VPNs, proxies, mobile routing, and missing GeoIP data further limit accuracy; treat country as approximate.

## Identity model

Identity is machine-level, not person-level:

- The anonymous machine id is `sha256("omo-senpi:" + hostname)`. The raw hostname never leaves the machine; it's only hashed locally.
- The `$session_id` value is a keyed hash: a per-machine random salt combined with the raw session id, then hashed. The raw session id is never sent, and sessions from different machines can't be correlated by session id.
- Person profiles are disabled on every event (`$process_person_profile: false`), so PostHog builds no person records.
- GeoIP enrichment is enabled as of schema version 2: native events are sent without the `$geoip_disable` transport flag, so PostHog may derive an approximate country (`$geoip_country_code`) from the sending IP server side. The application never authors `$ip` or any location property itself, and stores no IP locally. Earlier schema versions disabled GeoIP; a prior revision of this document wrongly claimed it was already on.

Because identity is machine-level, a shared machine conflates its users into one id. That's an accepted, documented limitation, not a bug.

## SDK-added properties

PostHog's node client attaches `$lib` and `$lib_version` to every event. Since schema version 2 the client omits the `$geoip_disable` flag, so PostHog may add derived location properties such as `$geoip_country_code` after ingestion; before schema version 2 that flag was set and no location was derived. These are SDK or service metadata, not authored by the omo-senpi client, so they don't appear in the allowlists above. They're listed here so an auditor comparing captured and ingested payloads against the schema isn't surprised.

## Opt-out matrix

Each switch below turns telemetry fully off: both the OmO Native events in the schema above and the legacy `omo_senpi_daily_active` event.

| Switch | Value that disables | Notes |
| ------ | ------------------- | ----- |
| `DO_NOT_TRACK` | `1` | The consoledonottrack.com convention, honored across all omo adapters |
| `OMO_SENPI_DISABLE_POSTHOG` | `1` | Adapter-specific kill switch |
| `OMO_DISABLE_POSTHOG` | `1` | Global kill switch across omo packages |
| `OMO_SENPI_SEND_ANONYMOUS_TELEMETRY` | any opt-out value, including `yes` | See the quirk note below |
| `OMO_SEND_ANONYMOUS_TELEMETRY` | any opt-out value, including `yes` | See the quirk note below |
| `omo.json` | `telemetry.enabled: false` | Config-file opt-out |
| Component flag | `omo-senpi-telemetry-disabled` | Per-component disable flag |

Quirk, documented honestly: the `*_SEND_ANONYMOUS_TELEMETRY` variables treat the value `yes` as an opt-out. This is a pre-existing behavior in the shared telemetry core, knowingly preserved for compatibility. Don't set `yes` expecting it to opt in; leaving the variable unset is what keeps telemetry on.

## What is never collected

The following never leaves your machine:

- Prompt or response text, prompt fragments, or exact prompt lengths (only coarse buckets)
- File paths, the working directory, or repository and project names
- Git identities or environment variable values
- Raw hostnames or IP addresses in the application-authored payload (the transport connection still exposes its sending IP to PostHog for geoip enrichment)
- Custom (non-builtin) skill names
- Custom provider names, which are always masked to `custom` — including the name of a self-hosted, proxy, or internal gateway
- Custom model names — any model id that is not an exact match for a publicly shipped model, such as a fine-tune, a private deployment name, or an internal codename — which are masked to `custom`

How provider and model are masked differs, because they carry different privacy weight:

| Field | Rule |
|---|---|
| `provider` | Exported only when it is one of the providers OmO itself ships. Every other value, including a self-hosted or proxy gateway name, is exported as `custom`. |
| `model_id` | Exported when it exactly matches OmO's published model vocabulary (`claude-opus-5`, `gpt-5.6-sol`, and the other public product names listed in the tables above), **regardless of which provider routed it**. Any other value is exported as `custom`. |

The practical consequence: routing a publicly known model through an unknown gateway reports `custom/claude-opus-5` rather than `custom/custom`. The gateway name — the user-authored half — is still withheld, while the model id is a public product name shared by every user running that model. A model name you chose yourself is never exported.

A structural allowlist enforces this rather than relying on discipline: any property key not in the allowlist is dropped before send, and any string value on a key ending in `_text`, `_path`, or `_prompt` is rejected regardless of allowlisting.

## Local retention

OmO Native does not retain a local history or preview file of sent telemetry payloads.
The event schema and opt-out controls above are the public audit surface.
