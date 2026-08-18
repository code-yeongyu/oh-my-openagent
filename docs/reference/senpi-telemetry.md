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
| `session_started` | `default_model` | `string` | `claude-fable-5`, `claude-haiku-4-5`, `claude-opus-5`, `claude-sonnet-5`, `deepseek-v4-flash`, `deepseek-v4-pro`, `gemini-3.6-flash`, `gpt-5.6-sol`, `gpt-5.6-terra`, `k3`, `kimi-for-coding-highspeed`, `kimi-k3`, `gpt-5.6-luna-fast`, `minimax-m2.7`, `minimax-m3`, `grok-4.20-0309-non-reasoning`, `custom` |
| `session_started` | `default_provider` | `string` | `anthropic`, `anthropic-api`, `deepseek`, `google`, `github-copilot`, `kimi-for-coding`, `moonshotai`, `openai`, `opencode`, `opencode-go`, `quotio-openai`, `vercel`, `xai`, `custom` |
| `session_started` | `memory_bucket` | `string` | `lt_8_gb`, `8_15_gb`, `16_31_gb`, `32_63_gb`, `64_plus_gb` |
| `session_started` | `model_count` | `number` | - |
| `session_started` | `provider_count` | `number` | - |
| `session_started` | `providers` | `string` | - |
| `session_started` | `reason` | `string` | `startup`, `reload`, `new`, `resume`, `fork` |
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
| `turn_completed` | `model_id` | `string` | `claude-fable-5`, `claude-haiku-4-5`, `claude-opus-5`, `claude-sonnet-5`, `deepseek-v4-flash`, `deepseek-v4-pro`, `gemini-3.6-flash`, `gpt-5.6-sol`, `gpt-5.6-terra`, `k3`, `kimi-for-coding-highspeed`, `kimi-k3`, `gpt-5.6-luna-fast`, `minimax-m2.7`, `minimax-m3`, `grok-4.20-0309-non-reasoning`, `custom` |
| `turn_completed` | `output_tokens` | `number` | - |
| `turn_completed` | `provider` | `string` | `anthropic`, `anthropic-api`, `deepseek`, `google`, `github-copilot`, `kimi-for-coding`, `moonshotai`, `openai`, `opencode`, `opencode-go`, `quotio-openai`, `vercel`, `xai`, `custom` |
| `turn_completed` | `reasoning_tokens` | `number` | - |
| `turn_completed` | `total_tokens` | `number` | - |
| `turn_completed` | `turn_index` | `number` | - |
| `skill_loaded` | `$session_id` | `string` | - |
| `skill_loaded` | `skill_name` | `string` | `ast-grep`, `coding-agent-sessions`, `dag-library`, `data-scientist`, `debugging`, `frontend`, `git-master`, `give-me-tips`, `hyperplan`, `init-deep`, `lsp-setup`, `mass-ulw`, `onboarding`, `programming`, `refactor`, `remove-ai-slops`, `review-work`, `start-work`, `ultimate-browsing`, `ultrawork`, `ulw-loop`, `ulw-plan`, `ulw-research`, `visual-qa` |
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
| `parallelism_summary` | `non_eval_saved_round_trips` | `number` | - |
| `parallelism_summary` | `non_eval_wave_size_histogram` | `string` | - |
| `parallelism_summary` | `non_eval_waves_multi` | `number` | - |
| `parallelism_summary` | `non_eval_waves_total` | `number` | - |
| `parallelism_summary` | `schema_kind` | `string` | `parallelism_v1`, `parallelism_v2` |
| `parallelism_summary` | `upper_bound_saved_ms` | `number` | - |
<!-- END GENERATED SCHEMA -->

### Parallelism v2 interpretation

`parallelism_v2` consumes Senpi's in-process `senpi.eval.execution` event and
adds fixed scalar rollups for eval-internal tool calls. The event's
`toolCallCount` remains authoritative even when its enriched per-call detail
array is capped. Tool names, arguments, result previews, paths, and aggregate
map keys are discarded before the PostHog boundary.

Top-level wave metrics and eval-internal calls remain separate populations.
`eval_outer_joined_calls` counts top-level eval wrappers,
`mixed_non_eval_joined_calls` counts direct non-eval calls in mixed waves, and
`eval_nested_tool_call_count` counts tools executed inside eval cells. Nested
durations are sums of per-call elapsed durations and may overlap, so they do
not prove concurrency, wall-clock savings, or saved round trips.

Historical `parallelism_v1` rows do not carry the new fields. On v2 rows,
`eval_execution_event_bus_available` reports host bus availability, not proof
that every producer emitted an event. Use the accepted and rejected event
counts when evaluating rollout coverage.

### Reasoning tokens caveat

`turn_completed` reports `reasoning_tokens`. That field is optional and is a subset of `output_tokens`, not an addition to it. Never add `reasoning_tokens` to `output_tokens` when computing totals, or you double count.

## Identity model

Identity is machine-level, not person-level:

- The anonymous machine id is `sha256("omo-senpi:" + hostname)`. The raw hostname never leaves the machine; it's only hashed locally.
- The `$session_id` value is a keyed hash: a per-machine random salt combined with the raw session id, then hashed. The raw session id is never sent, and sessions from different machines can't be correlated by session id.
- Person profiles are disabled on every event (`$process_person_profile: false`), so PostHog builds no person records.
- Geoip enrichment is enabled for these events, matching the legacy adapters, so PostHog may derive location data from the sending IP.

Because identity is machine-level, a shared machine conflates its users into one id. That's an accepted, documented limitation, not a bug.

## SDK-added properties

PostHog's node client attaches `$lib` and `$lib_version` to every event. Geoip enrichment is enabled, so the client does not attach `$geoip_disable`; PostHog may add derived location properties after ingestion. These are SDK or service metadata, not authored by the omo-senpi client, so they don't appear in the allowlists above. They're listed here so an auditor comparing captured and ingested payloads against the schema isn't surprised.

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
- Custom provider or model names, which are masked to `custom`

A structural allowlist enforces this rather than relying on discipline: any property key not in the allowlist is dropped before send, and any string value on a key ending in `_text`, `_path`, or `_prompt` is rejected regardless of allowlisting.

## Local retention

OmO Native does not retain a local history or preview file of sent telemetry payloads.
The event schema and opt-out controls above are the public audit surface.
