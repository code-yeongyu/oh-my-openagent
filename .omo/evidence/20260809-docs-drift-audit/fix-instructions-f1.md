# F1 Fix Instructions — guides report files

Worktree (edit ONLY here): <worktree>
Files you own (edit NOTHING else): docs/guide/installation.md, docs/guide/overview.md, docs/guide/orchestration.md, docs/guide/team-mode.md, docs/guide/senpi-task.md, docs/troubleshooting/ollama.md
Report for context: /tmp/omo-docs-drift/guides.md

Global rules:
- Every fix below cites code ground truth I (lead) personally re-verified. Before each edit, re-read the cited code lines AND the doc lines; if the citation does not support the fix, SKIP that item and record it in your skip report with the reason.
- Keep the doc's existing prose style, tables, and formatting. Smallest correct edit per item. ASCII only, no em dashes.
- Items marked UNVERIFIABLE in the report are intentionally NOT fixed in this pass (leave text untouched).

## docs/guide/installation.md
1. :6 — "Light consists of eight named components" → code truth: packages/omo-codex/plugin/package.json:8-20 lists 11 workspaces (codegraph, comment-checker, git-bash, lazycodex-executor-verify, rules, lsp, telemetry, teammode, start-work-continuation, ulw-loop, ultrawork). Update the list to all 11.
2. :6 — "Light has no agent orchestration" → reword: Light has no OpenCode agent registry/team_* tools, but ships Codex-native agent roles plus the teammode component (script+skill driven).
3. :16 — lazycodex wording → both `lazycodex` and `lazycodex-ai` are shipped bin aliases (package.json:38-43) that default install to Codex; `lazycodex` is also the repository identity.
4. :194-230 — subscription interview missing providers → add Bailian Coding Plan, MiniMax CN Coding Plan (minimaxi.com), MiniMax Coding Plan (minimax.io) questions/flags (cli-program.ts:111-114).
5. :294-304 — non-TUI flag list → add `--bailian-coding-plan`, `--minimax-cn-coding-plan`, `--minimax-coding-plan` (cli-program.ts:111-114).
6. :355 — "doctor runs six categories and returns exit code 2 for warnings-only" → code truth: 8 OpenCode checks (system, config, tui-plugin, deprecated-reasoning-keys, tools, models, telemetry, team-mode — checks/index.ts:20-66) plus separate Codex target checks; exit codes are 0 (pass) / 1 (fail) only (runner.ts:43-45, EXIT_CODES SUCCESS/FAILURE). Rewrite accordingly.
7. :665 — bare `team` keyword → TEAM_PATTERN is /\bteam[\s_-]?mode\b/i (keyword-detector/team/default.ts:10): triggers are team mode, team-mode, team_mode, teammode; bare `team` does NOT match.
8. :734 + :742-749 — Codex component binary/table lists → include teammode and codegraph surfaces or label the list as user-linked executables only (11 workspaces per package.json:8-20).
9. :753 — "Ultimate and Light share no config files" → all harnesses read the unified omo.jsonc surface through harness-specific views ([opencode]/[senpi]/[codex] blocks, omo-config-core/src/schema/config.ts:37-47); runtime state remains separate.
10. :838 — schema URL → https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json (script/build-omo-schema-document.ts:4-5).
11. :886 — "doctor is a six-category health check" → describe the actual registered checks (same as item 6).
12. :889-890 — MCP OAuth command shape → `mcp oauth login <server-name>`, `mcp oauth logout <server-name>`, `mcp oauth status [server-name]` (nested under `mcp`; cli/mcp-oauth/index.ts).

## docs/guide/overview.md
13. :171 — schema URL → same omo.schema.json URL as item 10.
14. :261 — "Goal continuation is an always-on discipline mechanism" → Goal is opt-in: goal.enabled defaults false, auto_start defaults false (config/schema/goal.ts:3-10).
15. :269-273 — IntentGate "semantically classifies" → it is regex-based mode keyword injection: ultrawork/ulw, team-mode patterns, hyperplan (keyword-detector/constants.ts + team/default.ts).
NOTE: report items about ultrabrain xhigh and unspecified-low Luna at :104/:196/:208 are REJECTED by lead verification (category defaults really are openai/gpt-5.6-sol:xhigh and openai/gpt-5.6-luna:xhigh per delegate-task/openai-categories.ts:151-175; the max/terra values are requirement-chain rungs, not defaults). Do NOT change those lines.

## docs/guide/orchestration.md
16. :343 — "quick-rust, quick-zig, and git are built-in user-facing categories" → built-ins are exactly the 8: visual-engineering, ultrabrain, deep, artistry, quick, unspecified-low, unspecified-high, writing (model-core/src/category-model-requirements.ts); other names are user-defined categories.
17. :348 — ground-truth pointer → authoritative fallback chains live in packages/model-core/src/category-model-requirements.ts; packages/omo-opencode/src/shared/model-requirements.ts is only a re-export shim.
18. :582-590 — sisyphus_agent toggle claim → these are optional legacy toggles (disabled, default_builder_enabled, planner_enabled, replace_plan, tdd; config/schema/sisyphus-agent.ts:3-9); do not equate sisyphus_agent.disabled=false with enabling Atlas orchestration.

## docs/guide/team-mode.md
19. :81 — "call a tool named delegate-task" → the registered tool is `task` (the implementation module is delegate-task; plugin/tool-registry.ts:41-65).

## docs/guide/senpi-task.md
20. :14 — "model may override any resolved target including category tasks" → `model` is valid only with `subagent_type` and is rejected with category routing (senpi-task/src/tools/task/params.ts:29-33, validation.ts:59-96).
21. :41 + :79 — "Team members receive task_send and team_wait" / "lead receives seven team tools including team_wait" → team_wait was removed: lead receives six tools (team_create, team_delete, task_create, task_get, task_list, task_update — senpi-task/src/tools/team/index.ts:66-75); member sessions receive only task_send (team/member-extension/index.ts:117-145).
22. :85 — "Team send only writes files and never pushes/steers/revives" → durable mailbox write PLUS injection-driven steer delivery into the recipient session (member-extension/index.ts:126-143 via pi.sendMessage steer; team/messaging/lead-poller.ts:95-130).
23. :87-95 — remove the entire team_wait section; tell agents to send with task_send, end the turn, and receive steered notifications.
24. :99-109 — clarify schema default wait.default_ms is 60,000; 90,000 is only the sample override (omo-config-core/src/schema/task.ts:7-11).

## docs/troubleshooting/ollama.md
25. Whole-doc refresh (the doc is Claude-Code-SDK-era and references removed surfaces):
   - :7-13 — replace the `mcp_grep_search` reproduction reference with the current grep/task tool surfaces (plugin/tool-registry.ts:41-65) or drop the stale reproduction line.
   - :28 + :62-68 — remove the "Claude Code SDK" root-cause and "Claude Code SDK NDJSON merger" fix claims; this adapter uses @opencode-ai/plugin and @opencode-ai/sdk (package.json:164-165).
   - :35-42 + :124-125 — remove the `{provider, model, stream:false}` "valid OMO config" example and the stream:false recommended workaround; that shape is not valid OMO config (config/schema/agent-overrides.ts:6-68).
   - :74-98 — remove the unattached TypeScript NDJSON parser sample (no integration point in the current codebase).
   - Reframe the doc as: known Ollama tool-call streaming issue, current status, and a request for a current reproduction; keep only claims that survive against current code.

DELIVERABLE: edits applied + a completion report listing per item: FIXED / SKIPPED(reason). STOP WHEN all items are FIXED or SKIPPED and the report is written to /tmp/omo-docs-drift/fix-report-f1.md.
