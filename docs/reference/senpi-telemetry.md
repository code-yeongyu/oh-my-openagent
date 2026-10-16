# Senpi Telemetry Reference

## What this is

OmO Native, the standalone edition, ships an anonymous product analytics pipeline. It is enabled by default and uses an opt-out model: every switch in the opt-out matrix below turns it fully off. Telemetry sends to the PostHog project configured in the packaged default; setting `POSTHOG_API_KEY` overrides that project key.

The payloads carry only booleans, buckets, counters, and allowlisted enum values. No free-form text ever leaves your machine. The exact schema is machine-generated below; if the generator and this document ever disagree, a drift test fails in CI.

The curated plan agents were renamed to `plan-consultant` and `plan-reviewer`; `delegation_started.name` and `delegation_completed.agent_type` carry the new ids, and this is a breaking value change for anyone querying the old ones. Events emitted before the rename carry metis/momus. <!-- retired-name-allowed -->

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
| `session_started` | `default_model` | `string` | `qwen3.6-flash`, `qwen3.8-max-preview`, `claude-fable-5`, `claude-fable-5-1`, `claude-haiku-4-5`, `claude-haiku-5-5`, `claude-opus-4-6`, `claude-opus-5`, `claude-opus-5-5`, `claude-sonnet-5`, `claude-sonnet-5-5`, `qwen3.7-plus`, `gpt-5.6-luna-fast`, `gpt-5.6-sol`, `gpt-5.6-sol-fast`, `gpt-5.6-terra`, `gpt-6-astra`, `gpt-6-luna`, `gpt-6-luna-fast`, `gpt-6-sol`, `gpt-6-sol-fast`, `gpt-6.1-sol`, `gpt-6.1-sol-fast`, `deepseek-flash`, `deepseek-v4-flash`, `deepseek-v4-pro`, `gemini-3.1-pro`, `gemini-3.6-flash`, `gemini-4-argon`, `grok-4.6`, `grok-4.7`, `k3`, `kimi-for-coding-highspeed`, `kimi-k3`, `glm-5.2`, `glm-5.3`, `mimo-v2.5-pro`, `mimo-v2.6-pro`, `minimax-m2.7`, `minimax-m3`, `grok-4.20-0309-non-reasoning`, `mimo-v2.6-flash`, `glm-5.3-flash`, `custom` |
| `session_started` | `default_provider` | `string` | `alibaba-token-plan`, `alibaba-token-plan-cn`, `anthropic`, `anthropic-api`, `anthropic-subscription`, `bailian-coding-plan`, `chatgpt-subscription`, `claude-sdk-oauth`, `deepseek`, `google`, `google-vertex`, `github-copilot`, `kimi-coding`, `kimi-for-coding`, `moonshotai`, `openai`, `openai-codex`, `opencode`, `opencode-go`, `qwen-token-plan`, `qwen-token-plan-cn`, `vercel`, `xai`, `xiaomi`, `zai`, `zai-coding-cn`, `zai-coding-plan`, `custom` |
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
| `prompt_submitted` | `suppression_reason` | `string` | `none`, `no_keyword`, `identifier_reference`, `negated_mention`, `extension_source`, `child_session`, `embedded_directive`, `skill_expansion`, `skill_name_only` |
| `turn_completed` | `$session_id` | `string` | - |
| `turn_completed` | `cache_read_tokens` | `number` | - |
| `turn_completed` | `cache_write_tokens` | `number` | - |
| `turn_completed` | `cost_usd` | `number` | - |
| `turn_completed` | `input_tokens` | `number` | - |
| `turn_completed` | `model_id` | `string` | `qwen3.6-flash`, `qwen3.8-max-preview`, `claude-fable-5`, `claude-fable-5-1`, `claude-haiku-4-5`, `claude-haiku-5-5`, `claude-opus-4-6`, `claude-opus-5`, `claude-opus-5-5`, `claude-sonnet-5`, `claude-sonnet-5-5`, `qwen3.7-plus`, `gpt-5.6-luna-fast`, `gpt-5.6-sol`, `gpt-5.6-sol-fast`, `gpt-5.6-terra`, `gpt-6-astra`, `gpt-6-luna`, `gpt-6-luna-fast`, `gpt-6-sol`, `gpt-6-sol-fast`, `gpt-6.1-sol`, `gpt-6.1-sol-fast`, `deepseek-flash`, `deepseek-v4-flash`, `deepseek-v4-pro`, `gemini-3.1-pro`, `gemini-3.6-flash`, `gemini-4-argon`, `grok-4.6`, `grok-4.7`, `k3`, `kimi-for-coding-highspeed`, `kimi-k3`, `glm-5.2`, `glm-5.3`, `mimo-v2.5-pro`, `mimo-v2.6-pro`, `minimax-m2.7`, `minimax-m3`, `grok-4.20-0309-non-reasoning`, `mimo-v2.6-flash`, `glm-5.3-flash`, `custom` |
| `turn_completed` | `output_tokens` | `number` | - |
| `turn_completed` | `provider` | `string` | `alibaba-token-plan`, `alibaba-token-plan-cn`, `anthropic`, `anthropic-api`, `anthropic-subscription`, `bailian-coding-plan`, `chatgpt-subscription`, `claude-sdk-oauth`, `deepseek`, `google`, `google-vertex`, `github-copilot`, `kimi-coding`, `kimi-for-coding`, `moonshotai`, `openai`, `openai-codex`, `opencode`, `opencode-go`, `qwen-token-plan`, `qwen-token-plan-cn`, `vercel`, `xai`, `xiaomi`, `zai`, `zai-coding-cn`, `zai-coding-plan`, `custom` |
| `turn_completed` | `reasoning_tokens` | `number` | - |
| `turn_completed` | `sample_rate` | `number` | - |
| `turn_completed` | `total_tokens` | `number` | - |
| `turn_completed` | `turn_index` | `number` | - |
| `session_summary` | `$session_id` | `string` | - |
| `session_summary` | `aborted_turns` | `number` | - |
| `session_summary` | `cache_read_tokens` | `number` | - |
| `session_summary` | `cache_write_tokens` | `number` | - |
| `session_summary` | `cost_usd` | `number` | - |
| `session_summary` | `custom_model_turns` | `number` | - |
| `session_summary` | `ended_by` | `string` | `checkpoint`, `shutdown`, `reload`, `recovered` |
| `session_summary` | `error_turns` | `number` | - |
| `session_summary` | `first_turn_index` | `number` | - |
| `session_summary` | `input_tokens` | `number` | - |
| `session_summary` | `invalid_usage_turns` | `number` | - |
| `session_summary` | `is_final` | `boolean` | - |
| `session_summary` | `last_turn_index` | `number` | - |
| `session_summary` | `m1_cost_usd` | `number` | - |
| `session_summary` | `m1_input_tokens` | `number` | - |
| `session_summary` | `m1_model` | `string` | `qwen3.6-flash`, `qwen3.8-max-preview`, `claude-fable-5`, `claude-fable-5-1`, `claude-haiku-4-5`, `claude-haiku-5-5`, `claude-opus-4-6`, `claude-opus-5`, `claude-opus-5-5`, `claude-sonnet-5`, `claude-sonnet-5-5`, `qwen3.7-plus`, `gpt-5.6-luna-fast`, `gpt-5.6-sol`, `gpt-5.6-sol-fast`, `gpt-5.6-terra`, `gpt-6-astra`, `gpt-6-luna`, `gpt-6-luna-fast`, `gpt-6-sol`, `gpt-6-sol-fast`, `gpt-6.1-sol`, `gpt-6.1-sol-fast`, `deepseek-flash`, `deepseek-v4-flash`, `deepseek-v4-pro`, `gemini-3.1-pro`, `gemini-3.6-flash`, `gemini-4-argon`, `grok-4.6`, `grok-4.7`, `k3`, `kimi-for-coding-highspeed`, `kimi-k3`, `glm-5.2`, `glm-5.3`, `mimo-v2.5-pro`, `mimo-v2.6-pro`, `minimax-m2.7`, `minimax-m3`, `grok-4.20-0309-non-reasoning`, `mimo-v2.6-flash`, `glm-5.3-flash`, `custom`, `none` |
| `session_summary` | `m1_output_tokens` | `number` | - |
| `session_summary` | `m1_provider` | `string` | `alibaba-token-plan`, `alibaba-token-plan-cn`, `anthropic`, `anthropic-api`, `anthropic-subscription`, `bailian-coding-plan`, `chatgpt-subscription`, `claude-sdk-oauth`, `deepseek`, `google`, `google-vertex`, `github-copilot`, `kimi-coding`, `kimi-for-coding`, `moonshotai`, `openai`, `openai-codex`, `opencode`, `opencode-go`, `qwen-token-plan`, `qwen-token-plan-cn`, `vercel`, `xai`, `xiaomi`, `zai`, `zai-coding-cn`, `zai-coding-plan`, `custom`, `none` |
| `session_summary` | `m1_total_tokens` | `number` | - |
| `session_summary` | `m1_turns` | `number` | - |
| `session_summary` | `m2_cost_usd` | `number` | - |
| `session_summary` | `m2_input_tokens` | `number` | - |
| `session_summary` | `m2_model` | `string` | `qwen3.6-flash`, `qwen3.8-max-preview`, `claude-fable-5`, `claude-fable-5-1`, `claude-haiku-4-5`, `claude-haiku-5-5`, `claude-opus-4-6`, `claude-opus-5`, `claude-opus-5-5`, `claude-sonnet-5`, `claude-sonnet-5-5`, `qwen3.7-plus`, `gpt-5.6-luna-fast`, `gpt-5.6-sol`, `gpt-5.6-sol-fast`, `gpt-5.6-terra`, `gpt-6-astra`, `gpt-6-luna`, `gpt-6-luna-fast`, `gpt-6-sol`, `gpt-6-sol-fast`, `gpt-6.1-sol`, `gpt-6.1-sol-fast`, `deepseek-flash`, `deepseek-v4-flash`, `deepseek-v4-pro`, `gemini-3.1-pro`, `gemini-3.6-flash`, `gemini-4-argon`, `grok-4.6`, `grok-4.7`, `k3`, `kimi-for-coding-highspeed`, `kimi-k3`, `glm-5.2`, `glm-5.3`, `mimo-v2.5-pro`, `mimo-v2.6-pro`, `minimax-m2.7`, `minimax-m3`, `grok-4.20-0309-non-reasoning`, `mimo-v2.6-flash`, `glm-5.3-flash`, `custom`, `none` |
| `session_summary` | `m2_output_tokens` | `number` | - |
| `session_summary` | `m2_provider` | `string` | `alibaba-token-plan`, `alibaba-token-plan-cn`, `anthropic`, `anthropic-api`, `anthropic-subscription`, `bailian-coding-plan`, `chatgpt-subscription`, `claude-sdk-oauth`, `deepseek`, `google`, `google-vertex`, `github-copilot`, `kimi-coding`, `kimi-for-coding`, `moonshotai`, `openai`, `openai-codex`, `opencode`, `opencode-go`, `qwen-token-plan`, `qwen-token-plan-cn`, `vercel`, `xai`, `xiaomi`, `zai`, `zai-coding-cn`, `zai-coding-plan`, `custom`, `none` |
| `session_summary` | `m2_total_tokens` | `number` | - |
| `session_summary` | `m2_turns` | `number` | - |
| `session_summary` | `m3_cost_usd` | `number` | - |
| `session_summary` | `m3_input_tokens` | `number` | - |
| `session_summary` | `m3_model` | `string` | `qwen3.6-flash`, `qwen3.8-max-preview`, `claude-fable-5`, `claude-fable-5-1`, `claude-haiku-4-5`, `claude-haiku-5-5`, `claude-opus-4-6`, `claude-opus-5`, `claude-opus-5-5`, `claude-sonnet-5`, `claude-sonnet-5-5`, `qwen3.7-plus`, `gpt-5.6-luna-fast`, `gpt-5.6-sol`, `gpt-5.6-sol-fast`, `gpt-5.6-terra`, `gpt-6-astra`, `gpt-6-luna`, `gpt-6-luna-fast`, `gpt-6-sol`, `gpt-6-sol-fast`, `gpt-6.1-sol`, `gpt-6.1-sol-fast`, `deepseek-flash`, `deepseek-v4-flash`, `deepseek-v4-pro`, `gemini-3.1-pro`, `gemini-3.6-flash`, `gemini-4-argon`, `grok-4.6`, `grok-4.7`, `k3`, `kimi-for-coding-highspeed`, `kimi-k3`, `glm-5.2`, `glm-5.3`, `mimo-v2.5-pro`, `mimo-v2.6-pro`, `minimax-m2.7`, `minimax-m3`, `grok-4.20-0309-non-reasoning`, `mimo-v2.6-flash`, `glm-5.3-flash`, `custom`, `none` |
| `session_summary` | `m3_output_tokens` | `number` | - |
| `session_summary` | `m3_provider` | `string` | `alibaba-token-plan`, `alibaba-token-plan-cn`, `anthropic`, `anthropic-api`, `anthropic-subscription`, `bailian-coding-plan`, `chatgpt-subscription`, `claude-sdk-oauth`, `deepseek`, `google`, `google-vertex`, `github-copilot`, `kimi-coding`, `kimi-for-coding`, `moonshotai`, `openai`, `openai-codex`, `opencode`, `opencode-go`, `qwen-token-plan`, `qwen-token-plan-cn`, `vercel`, `xai`, `xiaomi`, `zai`, `zai-coding-cn`, `zai-coding-plan`, `custom`, `none` |
| `session_summary` | `m3_total_tokens` | `number` | - |
| `session_summary` | `m3_turns` | `number` | - |
| `session_summary` | `model_count` | `number` | - |
| `session_summary` | `other_cost_usd` | `number` | - |
| `session_summary` | `other_total_tokens` | `number` | - |
| `session_summary` | `other_turns` | `number` | - |
| `session_summary` | `output_tokens` | `number` | - |
| `session_summary` | `raw_turns_sampled` | `boolean` | - |
| `session_summary` | `reasoning_tokens` | `number` | - |
| `session_summary` | `sample_rate` | `number` | - |
| `session_summary` | `session_role` | `string` | `main`, `child`, `dag_child`, `member` |
| `session_summary` | `summary_seq` | `number` | - |
| `session_summary` | `tool_error_count` | `number` | - |
| `session_summary` | `tool_result_count` | `number` | - |
| `session_summary` | `total_tokens` | `number` | - |
| `session_summary` | `total_tokens_max` | `number` | - |
| `session_summary` | `total_tokens_p50` | `number` | - |
| `session_summary` | `total_tokens_p95` | `number` | - |
| `session_summary` | `turns` | `number` | - |
| `session_summary` | `window_ms` | `number` | - |
| `skill_loaded` | `$session_id` | `string` | - |
| `skill_loaded` | `skill_name` | `string` | `ast-grep`, `browser`, `coding-agent-sessions`, `dag-library`, `data-scientist`, `debugging`, `frontend`, `git-master`, `give-me-tips`, `hyperplan`, `init-deep`, `lsp-setup`, `mass-ulw`, `onboarding`, `programming`, `refactor`, `remove-ai-slops`, `review-work`, `ulw-execute`, `ultimate-browsing`, `ultrawork`, `ulw-loop`, `ulw-plan`, `ulw-research`, `visual-qa`, `visualize` |
| `delegation_started` | `$session_id` | `string` | - |
| `delegation_started` | `background` | `boolean` | - |
| `delegation_started` | `batch_size_bucket` | `string` | `1`, `2_4`, `5_plus` |
| `delegation_started` | `kind` | `string` | `category`, `subagent` |
| `delegation_started` | `name` | `string` | `visual-engineering`, `artistry`, `ultrabrain`, `deep-low`, `deep-high`, `quick`, `unspecified-low`, `unspecified-high`, `architect`, `writing`, `explore`, `librarian`, `plan-consultant`, `plan-reviewer`, `custom` |
| `feature_used` | `$session_id` | `string` | - |
| `feature_used` | `feature` | `string` | `goal_tool`, `team_create`, `memory_tool` |
| `computer_use_activation` | `$session_id` | `string` | - |
| `computer_use_activation` | `active` | `boolean` | - |
| `computer_use_activation` | `backend` | `string` | `quartz`, `x11`, `wayland`, `win32`, `fake`, `unavailable`, `other` |
| `computer_use_activation` | `host_platform` | `string` | `darwin`, `linux`, `win32`, `other` |
| `computer_use_activation` | `source` | `string` | `tool_call`, `command_on`, `command_off`, `other` |
| `computer_use_permission_denied` | `$session_id` | `string` | - |
| `computer_use_permission_denied` | `backend` | `string` | `quartz`, `x11`, `wayland`, `win32`, `fake`, `unavailable`, `other` |
| `computer_use_permission_denied` | `host_platform` | `string` | `darwin`, `linux`, `win32`, `other` |
| `computer_use_permission_denied` | `permission` | `string` | `capture`, `input`, `ax`, `read`, `exec` |
| `computer_use_permission_denied` | `scope` | `string` | `os`, `tier` |
| `computer_use_engine_error` | `$session_id` | `string` | - |
| `computer_use_engine_error` | `backend` | `string` | `quartz`, `x11`, `wayland`, `win32`, `fake`, `unavailable`, `other` |
| `computer_use_engine_error` | `code` | `string` | `PermissionDenied`, `CaptureFailed`, `InputFailed`, `BackgroundUnavailable`, `WindowNotFound`, `InvalidTarget`, `InvalidKey`, `InvalidCoordinateFrame`, `StaleRef`, `AxUnsupported`, `AxFailed`, `Timeout`, `Closed`, `Internal`, `StopPathUnavailable`, `Suspended`, `ScreenLocked`, `Cancelled`, `CursorRestoreFailed`, `FocusRestoreFailed`, `TransactionFailed`, `InputBusy`, `ControlRequired`, `CaptureUnavailable`, `native-unavailable`, `quarantined`, `abi-mismatch`, `other` |
| `computer_use_engine_error` | `host_platform` | `string` | `darwin`, `linux`, `win32`, `other` |
| `kibitzer_summary` | `$session_id` | `string` | - |
| `kibitzer_summary` | `buffered_cooldown` | `number` | - |
| `kibitzer_summary` | `buffered_no_new_candidate` | `number` | - |
| `kibitzer_summary` | `cache_read_tokens` | `number` | - |
| `kibitzer_summary` | `cache_write_tokens` | `number` | - |
| `kibitzer_summary` | `candidates_total` | `number` | - |
| `kibitzer_summary` | `first_nudge_wake` | `number` | - |
| `kibitzer_summary` | `generations` | `number` | - |
| `kibitzer_summary` | `input_tokens` | `number` | - |
| `kibitzer_summary` | `model_top` | `string` | - |
| `kibitzer_summary` | `nudge_gap_ms_median` | `number` | - |
| `kibitzer_summary` | `nudge_gap_ms_p90` | `number` | - |
| `kibitzer_summary` | `nudges_delivered` | `number` | - |
| `kibitzer_summary` | `offers_total` | `number` | - |
| `kibitzer_summary` | `output_tokens` | `number` | - |
| `kibitzer_summary` | `slot_wait_ms_total` | `number` | - |
| `kibitzer_summary` | `tool_calls_total` | `number` | - |
| `kibitzer_summary` | `wake_duration_ms_total` | `number` | - |
| `kibitzer_summary` | `wake_span_ms` | `number` | - |
| `kibitzer_summary` | `wakes_deadline` | `number` | - |
| `kibitzer_summary` | `wakes_failed` | `number` | - |
| `kibitzer_summary` | `wakes_tool_budget` | `number` | - |
| `kibitzer_summary` | `wakes_total` | `number` | - |
| `kibitzer_summary` | `wakes_with_nudge` | `number` | - |
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
| `delegation_completed` | `$session_id` | `string` | - |
| `delegation_completed` | `agent_type` | `string` | `explore`, `librarian`, `plan-consultant`, `plan-reviewer`, `custom`, `none` |
| `delegation_completed` | `background_mode` | `string` | `foreground`, `background`, `promoted`, `unknown` |
| `delegation_completed` | `cache_read_tokens` | `number` | - |
| `delegation_completed` | `cache_write_tokens` | `number` | - |
| `delegation_completed` | `category` | `string` | `visual-engineering`, `artistry`, `ultrabrain`, `deep-low`, `deep-high`, `quick`, `unspecified-low`, `unspecified-high`, `architect`, `writing`, `custom`, `none` |
| `delegation_completed` | `config_generation` | `number` | - |
| `delegation_completed` | `cost_status` | `string` | `reported`, `unavailable`, `invalid` |
| `delegation_completed` | `cost_usd` | `number` | - |
| `delegation_completed` | `duration_ms` | `number` | - |
| `delegation_completed` | `duration_status` | `string` | `monotonic`, `wall_clock`, `unavailable` |
| `delegation_completed` | `execution_mode` | `string` | `in-process`, `process` |
| `delegation_completed` | `fallback_attempts` | `number` | - |
| `delegation_completed` | `input_tokens` | `number` | - |
| `delegation_completed` | `model_id` | `string` | `qwen3.6-flash`, `qwen3.8-max-preview`, `claude-fable-5`, `claude-fable-5-1`, `claude-haiku-4-5`, `claude-haiku-5-5`, `claude-opus-4-6`, `claude-opus-5`, `claude-opus-5-5`, `claude-sonnet-5`, `claude-sonnet-5-5`, `qwen3.7-plus`, `gpt-5.6-luna-fast`, `gpt-5.6-sol`, `gpt-5.6-sol-fast`, `gpt-5.6-terra`, `gpt-6-astra`, `gpt-6-luna`, `gpt-6-luna-fast`, `gpt-6-sol`, `gpt-6-sol-fast`, `gpt-6.1-sol`, `gpt-6.1-sol-fast`, `deepseek-flash`, `deepseek-v4-flash`, `deepseek-v4-pro`, `gemini-3.1-pro`, `gemini-3.6-flash`, `gemini-4-argon`, `grok-4.6`, `grok-4.7`, `k3`, `kimi-for-coding-highspeed`, `kimi-k3`, `glm-5.2`, `glm-5.3`, `mimo-v2.5-pro`, `mimo-v2.6-pro`, `minimax-m2.7`, `minimax-m3`, `grok-4.20-0309-non-reasoning`, `mimo-v2.6-flash`, `glm-5.3-flash`, `custom` |
| `delegation_completed` | `model_source` | `string` | `category`, `explicit`, `agent`, `none` |
| `delegation_completed` | `output_tokens` | `number` | - |
| `delegation_completed` | `owner_kind` | `string` | `plain_child`, `dag_node`, `team_member`, `unknown` |
| `delegation_completed` | `provider` | `string` | `alibaba-token-plan`, `alibaba-token-plan-cn`, `anthropic`, `anthropic-api`, `anthropic-subscription`, `bailian-coding-plan`, `chatgpt-subscription`, `claude-sdk-oauth`, `deepseek`, `google`, `google-vertex`, `github-copilot`, `kimi-coding`, `kimi-for-coding`, `moonshotai`, `openai`, `openai-codex`, `opencode`, `opencode-go`, `qwen-token-plan`, `qwen-token-plan-cn`, `vercel`, `xai`, `xiaomi`, `zai`, `zai-coding-cn`, `zai-coding-plan`, `custom` |
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
| `category_config` | `cat_deep_high` | `string` | - |
| `category_config` | `cat_deep_low` | `string` | - |
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
| `process_crashed` | `$os` | `string` | - |
| `process_crashed` | `arch` | `string` | - |
| `process_crashed` | `crashed_bun_version` | `string` | - |
| `process_crashed` | `crashed_engine_version` | `string` | - |
| `process_crashed` | `crashed_omo_version` | `string` | - |
| `process_crashed` | `detection` | `string` | `supervisor`, `parent`, `unclean_exit`, `unknown` |
| `process_crashed` | `exit_code` | `number` | - |
| `process_crashed` | `process_kind` | `string` | `interactive`, `print`, `json`, `rpc-host`, `task-child`, `unknown` |
| `process_crashed` | `shard_kind` | `string` | `p`, `i`, `none`, `unknown` |
| `process_crashed` | `signal` | `string` | `SIGSEGV`, `SIGBUS`, `SIGILL`, `SIGTRAP`, `SIGABRT`, `SIGFPE`, `SIGKILL`, `SIGTERM`, `SIGHUP`, `SIGINT`, `SIGQUIT`, `SIGSYS`, `other`, `none`, `unknown` |
| `process_crashed` | `uptime_bucket` | `string` | `lt_1m`, `1_10m`, `10_60m`, `1_6h`, `6_24h`, `24h_plus` |
| `process_crashed` | `uptime_ms` | `number` | - |

## Common properties

Every event above also carries these properties.

| Property | Type | Allowed values |
|----------|------|----------------|
| `$process_person_profile` | `boolean` | - |
| `ci` | `boolean` | - |
| `event_id` | `string` | - |
| `install_hash` | `string` | - |
| `machine_hash` | `string` | - |
| `package_version` | `string` | - |
| `platform` | `string` | `omo-senpi` |
| `product_name` | `string` | `omo-native` |
| `schema_version` | `number` | - |
| `surface` | `string` | `cli`, `desktop` |
<!-- END GENERATED SCHEMA -->

### Computer-use events

`computer_use_activation` records session-scoped activation transitions. `tool_call` means the host activated `computer` or `computer_actions` for a by-name call or after tool discovery; `command_on` and `command_off` are explicit `/computer` commands. Repeating an already-active activation does not emit another row.

`computer_use_permission_denied` separates OS capability blocks from OmO permission rules. `scope = os` reports which fixed capability is unavailable (`capture`, `input`, or `ax`) after activation. `scope = tier` reports a denied `computer:read` or `computer:exec` request. It never includes the permission rule, feedback, tool arguments, screen state, or requested action.

`computer_use_engine_error` reports the frozen desktop protocol error code, startup diagnostics (`native-unavailable`, `quarantined`, `abi-mismatch`), or `other`. Error messages, recovery hints, engine paths, coordinates, window data, application names, and typed text stay local. Backend and `host_platform` values are allowlisted; unknown values become `other`. The field is named `host_platform` because the shared telemetry envelope already owns `platform = omo-senpi`.

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

### Session summaries and raw-turn sampling

`session_summary` carries a session's assistant turns, summed per window. A window closes every 50 turns or 30 minutes (`ended_by: checkpoint`), on a reload (`ended_by: reload`, not final) and when the session ends (`ended_by: shutdown`). The open window is kept in `<state>/rollups/<session>.json` after every turn; if the process dies, the next OmO process to record a turn sends it once with `ended_by: recovered` and leaves a placeholder so the session, resumed in any process, continues its numbering. Only `ended_by: shutdown` rows have `is_final: true`; a recovered row is not final because the session may be resumed, and a session that is never resumed has no final row. Leftover rollup, temporary and claim files of dead processes are removed, and rollups older than 14 days are dropped. A session keeps one `summary_seq` sequence across reloads and recovery, so `($session_id, summary_seq)` is unique and summing every row of a session gives its exact totals. The three most used models get their own `m1_*` to `m3_*` totals and the rest are summed into `other_*`. `session_role` is `main` for a user's session and `child`, `dag_child` or `member` for omo-spawned work, whose cost `delegation_completed` already counts; filter on it to avoid counting delegated work twice.

Raw `turn_completed` rows go to PostHog only for a fixed share of sessions (`sample_rate` 0.05), chosen from the session hash so a sampled session sends every one of its turns. PostHog is today's only sink, so this sample is what keeps per-turn events from dominating its volume, while `session_summary` carries exact totals for every session. When the first-party collector ships, every turn goes to the collector through its own path and only this direct PostHog path stays sampled. Weight raw PostHog rows by `1 / sample_rate`, or use `session_summary` for exact totals. Rows from clients older than this change have no `sample_rate` and were never sampled.

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

### Process crash events

A process that dies natively cannot report its own death, so `process_crashed` is sent by the NEXT OmO process to start, once per crash. The crash is recorded locally at the time it happens: the RPC host supervisor records its child's exit (`detection = 'supervisor'`), a task runner records a process-mode child it did not ask to stop (`detection = 'parent'`), and an interactive or print process that ends without running any exit handler leaves a lifetime marker that the next start turns into a record (`detection = 'unclean_exit'`). An unclean exit proves the death but not its cause, so its `signal` is `unknown`, and it also counts a `SIGKILL` from outside (an OOM kill, `kill -9`) as a crash.

- `crashed_bun_version`, `crashed_engine_version`, and `crashed_omo_version` are the versions of the process that died, not the reporter's. Per-version crash rates must group on them, never on `package_version`, which belongs to the reporting process. A value that is not version-shaped, or was not recorded (records written before the field existed), is `unknown`.
- `uptime_ms` for an unclean exit runs to the last one-minute heartbeat, so it is short by up to a minute. Exit-code crashes carry `signal = 'none'` plus `exit_code`.
- `shard_kind` names the kind of RPC host that crashed: `p` is a per-session task host, `i` is a Desktop per-thread host, and `none` is the legacy machine-wide host or a process that was not a host. `unknown` means an endpoint directory that names no socket of its own. Every host's endpoint directory is read, and the same record written by two hosts is reported once for each host. The shard key, socket path and owning session never leave the machine.
- Records older than 14 days are never sent, and at most 20 crashes are sent per start; the rest wait for later starts. The event timestamp is the report time, not the crash time.
- Opting out sends nothing and leaves the local records unread. Crash records never carry a stack, a path, a prompt, or session content.

## Identity model

Identity is installation-level, not person-level:

- As of schema version 4, every OmO Native event's `distinct_id` is `install_hash` = `sha256(install id)`, where the install id is the random file described below. The same value is sent as the `install_hash` property; the raw install id never leaves the machine.
- Schema versions 1 to 3 used the machine id `sha256("omo-senpi:" + hostname)` as `distinct_id`. Until `2026-12-15` (UTC, exclusive) every event also carries that value as `machine_hash`, so rows from before and after the switch can be joined per installation; after that date the property is no longer sent. The raw hostname never leaves the machine; it's only hashed locally. The legacy `omo_senpi_daily_active` event keeps the machine id as its `distinct_id`.
- The `$session_id` value is a keyed hash: a per-machine random salt combined with the raw session id, then hashed. The raw session id is never sent, and sessions from different machines can't be correlated by session id.
- Person profiles are disabled on every event (`$process_person_profile: false`), so PostHog builds no person records.
- GeoIP enrichment is enabled as of schema version 2: native events are sent without the `$geoip_disable` transport flag, so PostHog may derive an approximate country (`$geoip_country_code`) from the sending IP server side. The application never authors `$ip` or any location property itself, and stores no IP locally. Earlier schema versions disabled GeoIP; a prior revision of this document wrongly claimed it was already on.

Because identity is per installation, a shared machine conflates its users into one id. That's an accepted, documented limitation, not a bug.

### Surface attribution and install ids (schema version 3)

Every event carries two shared attribution properties as of schema version 3:

- `surface` is `cli` for standalone CLI sessions, or `desktop` when the runtime is embedded in OmO Desktop. The Desktop host sets `OMO_NATIVE_SURFACE=desktop` in the child environment; anything else is the CLI. A Desktop-driven turn is Desktop usage, not CLI adoption, and must never be counted as one.
- The install id is a random 64-hex value stored (like the session-id salt) under the agent home at `omo-senpi/omo-native/install-id`, created with mode 0600 on first use. It is generated locally and derived from nothing: not the hostname, not hardware, not accounts. The standalone CLI and the Desktop-bundled runtime on one machine converge on the same file, which is what joins the two surfaces without fingerprinting the machine. A valid `OMO_NATIVE_INSTALL_ID` env value overrides the file, so a Desktop host can pin a remote (SSH/WSL) runtime to the local installation's id; a malformed override is ignored.

Schema version 3 sent this value raw as the `install_id` property; schema version 4 sends only its hash (`install_hash`). Rows written before schema version 3 carry neither property. Segment on `schema_version` when mixing eras.

### CI attribution

Every event carries `ci`: `true` when the process runs with the `CI` environment variable set to anything other than empty, `0` or `false` (the convention GitHub Actions and most CI runners follow), else `false`. It lets analysis separate automated runs from people; it does not turn telemetry off. Rows written before this field existed carry no `ci`.

### Event ids

Every event carries `event_id`, a UUIDv7 minted on the client at capture time from a monotonic clock and random bits; it is derived from nothing in the event. PostHog's top-level `uuid` is set to the same value, so a delivery that is retried or relayed through a second path deduplicates to one row. Rows written before this field existed carry no `event_id`.

## SDK-added properties

PostHog's node client attaches `$lib` and `$lib_version` to every event. Since schema version 2 the client omits the `$geoip_disable` flag, so PostHog may add derived location properties such as `$geoip_country_code` after ingestion; before schema version 2 that flag was set and no location was derived. These are SDK or service metadata, not authored by the omo-senpi client, so they don't appear in the allowlists above. They're listed here so an auditor comparing captured and ingested payloads against the schema isn't surprised.

## Opt-out matrix

Each switch below turns telemetry fully off: both the OmO Native events in the schema above and the legacy `omo_senpi_daily_active` event.

| Switch | Value that disables | Notes |
| ------ | ------------------- | ----- |
| `DO_NOT_TRACK` | `1` | The consoledonottrack.com convention, honored across all omo adapters |
| `OMO_SENPI_DISABLE_POSTHOG` | `1` | Adapter-specific kill switch |
| `OMO_DISABLE_POSTHOG` | `1` | Global kill switch across omo packages |
| `OMO_DISABLE_TELEMETRY` | `1`, `true` or `yes` | Global kill switch across omo packages, named for the product rather than the vendor |
| `OMO_SENPI_SEND_ANONYMOUS_TELEMETRY` | any opt-out value, including `yes` | See the quirk note below |
| `OMO_SEND_ANONYMOUS_TELEMETRY` | any opt-out value, including `yes` | See the quirk note below |
| `omo.json` | `telemetry.enabled: false` | Config-file opt-out |
| Component flag | `omo-senpi-telemetry-disabled` | Per-component disable flag |

Quirk, documented honestly: the `*_SEND_ANONYMOUS_TELEMETRY` variables treat the value `yes` as an opt-out. This is a pre-existing behavior in the shared telemetry core, knowingly preserved for compatibility. Don't set `yes` expecting it to opt in; leaving the variable unset is what keeps telemetry on.

## Known issue fixed in 5.1.35

OmO Native versions v5.0.0-beta.6 through v5.1.34 kept sending usage events for the rest of a session after telemetry was turned off while that session was running ([#10328](https://github.com/code-yeongyu/oh-my-openagent/issues/10328)). These events are personless and carry a session hash; the ones confirmed in that report are `turn_completed`, `feature_used` and `computer_use_activation`, other usage events may have been sent the same way, and like every OmO Native event they never contain prompt or response text, file paths, or file contents. Turning telemetry off before a session started, or through one of the opt-out environment variables, was never affected. Since v5.1.35 consent is checked when events are sent (a check is reused for at most 5 seconds), and events already queued are dropped once the opt-out is read. Those events can't be told apart from consented ones, so erasure is per install: send a private request through this repository's [private vulnerability reporting form](https://github.com/code-yeongyu/oh-my-openagent/security/advisories/new), titled "Telemetry erasure request", with your install id (the file `omo-senpi/omo-native/install-id` under the agent home), and an operator erases that install's events. Put the id only in that private report, never in a public issue or comment. Events from older versions that are keyed only by the machine hash are erased only where our records pair that hash with your install id and no other install. A history shared by several machines or installs (the same hostname hash) can't be erased automatically; it needs that private request, and where nothing proves the events are yours, they can't be erased.

## What is never collected

The following never leaves your machine:

- Prompt or response text, prompt fragments, or exact prompt lengths (only coarse buckets)
- File paths, the working directory, or repository and project names
- Git identities or environment variable values
- Computer-use screenshots, window titles, application names, coordinates, typed text, tool code or arguments, permission feedback, engine paths, and error messages
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
The only telemetry file it keeps is the open `session_summary` window of each live session under `<state>/rollups/`: numbers and masked model names only, rewritten after every turn and deleted when the session ends or once a later process has sent it as `recovered`.
The event schema and opt-out controls above are the public audit surface.
