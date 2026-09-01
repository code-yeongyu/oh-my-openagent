# F4 Fix Instructions — config-docs report files

Worktree (edit ONLY here): <worktree>
Files you own (edit NOTHING else): docs/reference/configuration.md, docs/reference/omo-json.md
Report: /tmp/omo-docs-drift/config-docs.md

Global rules: re-verify citations before each edit, skip+report mismatches, smallest edit, ASCII, no em dashes, UNVERIFIABLE items untouched.

## docs/reference/configuration.md
1. :50 — "If cwd is outside HOME, only cwd is checked" → the walk continues to the filesystem root when cwd is outside HOME (omo-config-core/src/loader/paths.ts:84-101).
2. :76 — model catalog entries → canonical `{ model, reasoning? }`; variant/reasoningEffort are deprecated inputs normalized to reasoning (omo-config-core/src/schema/model-catalog.ts:10-21).
3. :101 — migration marker set → add `2026-08-reasoning-unification` (config-migration/reasoning-unification.ts:6) alongside the two July IDs.
4. :119 — ultrawork.variant → use `ultrawork.reasoning` (agent-overrides.ts:50-57).
5. :127 — agents.oracle.variant → use `reasoning`.
6. :140 — category variant examples → use `reasoning`.
7. :211 — agent options table → add `models`, `reasoning`, `skills`, `description`, `displayName`, `ultrawork`, `compaction`; label compatibility fields deprecated (agent-overrides.ts:6-67).
8. :219 — agent tools → record<string, boolean>, not array (agent-overrides.ts:24).
9. :221 — agent mode → enum `subagent | primary | all` (agent-overrides.ts:27).
10. :222 — agent color → six-digit hex `#RRGGBB` (agent-overrides.ts:28-31).
11. :225 — variant canonical → canonical is `reasoning`; variant deprecated.
12. :227 — thinking canonical → use `reasoning` plus provider options; thinking is a migrated legacy form.
13. :228 — reasoningEffort canonical → use `reasoning`; deprecated.
14. :299 — object fallback entries → add canonical `reasoning`; variant/reasoningEffort/thinking are compatibility fields (fallback-models.ts:4-20).
15. :329 — file://~/ home-relative paths → limited to ~/.config/opencode, ~/.config/oh-my-openagent, ~/.omo, ~/.opencode (agents/builtin-agents/resolve-file-uri.ts:7-19,41-50).
16. :340 — "ultrabrain default chain starts with gpt-5.6-sol xhigh" → chain rungs use variant max (category-model-requirements.ts:28-44). NOTE the doc phrasing here is about the CHAIN, so fix to max. (The category DISPLAY default is xhigh — only change chain-phrased text.)
17. :344 — "unspecified-low default is gpt-5.6-luna xhigh" → CAREFUL: the category default IS luna xhigh (openai-categories.ts:171). If this line is phrased as the chain, fix to gpt-5.6-terra high (category-model-requirements.ts:95-101); if phrased as the category default, leave unchanged and record SKIP with reason.
18. :352 — category options table → add `models`, canonical `reasoning`, `max_tokens`, `provider_options`; remove non-schema `requiresModel` (categories.ts:5-41).
19. :355 — requiresModel → remove from user option table (builtin definition metadata, not a CategoryConfig key).
20. :359 — category maxTokens → canonical `max_tokens`.
21. :360 — category thinking → `reasoning` + provider_options; deprecated.
22. :361 — category reasoningEffort → `reasoning`.
23. :366 — category variant → `reasoning`.
24. :426/:427 — add `low` variant to first gpt-5.6-luna-fast rung (agent-model-requirements.ts:69-70, 82-83).
25. :446 — Unspecified Low chain-table primary column → gpt-5.6-terra (chain first rung; category-model-requirements.ts:95-101). Only the chain-table primary cell; do not touch category-default prose.
26. :463 — background_task.defaultConcurrency → runtime default 5 (features/background-agent/concurrency.ts:25-40).
27. :471 — background-task option table → add maxDepth, messageStalenessTimeoutMs, taskTtlMs, sessionGoneTimeoutMs, taskCleanupDelayMs, syncPollTimeoutMs, maxToolCalls, circuitBreaker (config/schema/background-task.ts:9-28).
28. :506 — experimental.task_system default → false (shared/task-system-enabled.ts:5-9).
29. :607 — built-in commands list → add `handoff` (commands.ts:40-115); note disabled_commands accepts only the schema enum.
30. :613 — browser providers → playwright, agent-browser, dev-browser, playwright-cli (config/schema/browser-automation.ts:3-8).
31. :638 — tmux table → add `isolation` (default `inline`, enum values per config/schema/tmux.ts:9-16).
32. :678 + :681 — built-in MCPs → add `codegraph` (mcp/index.ts:38-68; disabled_mcps example too).
33. :691 — LSP_TOOLS_MCP_PROJECT_CONFIG → delimiter-separated search list: .opencode/lsp.json, .omo/lsp.json, .omo/lsp-client.json (mcp/lsp.ts:14).
34. :704 — codegraph plugin keys → full surface: auto_init, auto_provision, daemon, enabled, excluded_roots, install_dir, telemetry, watch_debounce_ms (config/schema/codegraph.ts:3-12).
35. :721 — codegraph.session_start_cooldown_ms → Codex-only shared key; not in the OpenCode plugin CodegraphConfigSchema; move to shared top-level `codegraph` or `[codex].codegraph` docs.
36. :765 — runtime_fallback table → add `restore_primary_after_cooldown` (config/schema/runtime-fallback.ts:16).
37. :846/:847 — per-fallback variant/reasoningEffort → canonical `reasoning`.
38. :851 — fallback thinking → `reasoning` + provider_options.thinking; legacy-normalized.
39. :862 — "Explicit variant overrides inline model variant syntax" → describe canonical `reasoning`; migration precedence reasoning > reasoningEffort > variant; model suffix normalized separately (omo-config-core/src/schema/fallback-models.ts:38-57).
40. :898 + :947 — copy-paste examples → use canonical `reasoning` (maxTokens remains accepted in [opencode] fallback objects).
41. :962 — full object example → include canonical `reasoning`; drop deprecated variant/reasoningEffort/thinking from the canonical example.
42. :989 — "Explicit variant overrides inline (low) suffix" → canonical `reasoning` precedence.
43. :993 — recommendation → unified `reasoning`; provider-specific [opencode] fields only where needed.
44. :1067 — experimental table → add preemptive_compaction, plugin_load_timeout_ms, safe_hook_creation, model_fallback_title, max_tools, disable_live_parent_wake_routing (config/schema/experimental.ts:4-26).
45. :1104 — OMO_CODEX_DISABLE_POSTHOG → values 1/true/yes; global OMO_DISABLE_POSTHOG also disables Codex telemetry (telemetry-core/src/env.ts:4-5,30-43).
46. :1105 — OMO_CODEX_SEND_ANONYMOUS_TELEMETRY → `yes` is also treated as opt-out by telemetry-core (env.ts:26-43).
47. :1109 + :1115 — LSP install decisions path → per harness: Codex uses CODEX_HOME/lsp-install-decisions.json; OpenCode injects its OpenCode config-dir path (mcp/lsp.ts:136-150; omo-codex/plugin/components/lsp/src/codex-hook.ts:97).
48. :1168 — direct Anthropic example → `reasoning: "max"` instead of variant=max.

## docs/reference/omo-json.md
49. :5 — "Every schema object is strict" → qualify: `[opencode]` is intentionally a freeform record; strict typed blocks reject unknown keys (omo-config-core/src/schema/config.ts:14-15,37-51).
50. :17 — "All arrays replace" → exception: codegraph.excluded_roots arrays union/deduplicate across layers (loader/merge.ts:26-27,41-45).
51. :67 — shared category example → use canonical `reasoning: "high"`.
52. :122 — catalog entries → only canonical `model` + optional `reasoning` (plus deprecated variant/reasoningEffort inputs); remove temperature/top_p/max_tokens/provider_options from the catalog table (model-catalog.ts:10-17).
53. :143 — shared agent field table → add `disallowed_tools` and `max_turns` (omo-config-core/src/schema/agent.ts:16-35).
54. :178-180 — agent models entry legacy tables → use canonical model-object fields (reasoning/temperature/top_p/max_tokens/provider_options); delete duplicated legacy variant/reasoningEffort sections (fallback-models.ts:78-101).
55. :239 — "codegraph.daemon=false makes each Senpi session use in-process CodeGraph" → daemon is unsupported for Senpi; applies only to Codex and OpenCode (omo-config-core/src/schema/codegraph.ts:42-50).
56. :253 — "Every task field has a default" → provider/model concurrency, state_dir, reattach_on_reconcile are optional/unset (task.ts:23-41).
57. :255 — task settings table → add `reattach_on_reconcile` and `warnings.unavailable_categories`; clarify optional fields.
58. :261 — task.residency_max_children → also accepts literal `"unlimited"` (task.ts:5,29,65).
59. :262 — residency default → effective default max(8, availableParallelism()*3); schema literal default overridden by resolver (task.ts:78-86).
60. :350 — shared category example → use `models` ordered chain + canonical `reasoning`.
61. :378 — applied migration IDs → add `2026-08-reasoning-unification`.

DELIVERABLE: edits + /tmp/omo-docs-drift/fix-report-f4.md with FIXED/SKIPPED per item. STOP WHEN all items resolved.
