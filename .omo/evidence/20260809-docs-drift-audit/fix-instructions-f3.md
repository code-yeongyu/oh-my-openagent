# F3 Fix Instructions — features-cli report files

Worktree (edit ONLY here): <worktree>
Files you own (edit NOTHING else): docs/reference/features.md, docs/reference/cli.md, docs/reference/monitor.md, docs/reference/web-terminal-visual-qa.md
Report: /tmp/omo-docs-drift/features-cli.md
NOTE: docs/reference/github-attachment-upload.md is policy prose — leave untouched.

Global rules: re-verify citations before each edit, skip+report mismatches, smallest edit, ASCII, no em dashes, UNVERIFIABLE items untouched.

## docs/reference/features.md
1. :16/:17 — add `(low)` to the first gpt-5.6-luna-fast rung in Librarian and Explore rows (agent-model-requirements.ts:69-70, 82-83).
2. :43 — REMOVE the "Atlas cannot delegate with task or call_omo_agent" row: Atlas is an orchestrator via task() (agents/atlas/agent.ts:113-125); no task deny in shared/agent-tool-restrictions.ts.
3. :44 — Momus row: write/edit denied but `task` is NOT denied (agent-tool-restrictions.ts:48-51).
4. :141 — "15 tool directories, 20-39 tools" → 14 native tool directories; 12-38 registry tools (12 always-on core + gated); the 8 LSP aliases are MCP-served tools, not registry tools (plugin/tool-registry-core-tools.ts:126-144, tool-registry-gated-tools.ts, tool-registry-team-tools.ts).
5. :142 — hook composition "54 base / 61 with Team Mode" → 58 composed slots (Session 24 + ToolGuard 18 + Transform 7 + Continuation 7 + Skill 2), ~50-51 active on default config, 62 max including 4 direct Team Mode event handlers (plugin/hooks/create-*.ts).
6. :143 — Tier-1 built-in MCPs → 3 remote (websearch, context7, grep_app) + local stdio `lsp` and `codegraph` (mcp/index.ts:38-68; codegraph gated by codegraph.enabled).
7. :144 — "exactly four managers" → avoid the fixed count or list the manager/controller fields created in create-managers.ts (tmux, background, skill MCP, config handler, plus optional TuiStateMirror and MonitorManager).
8. :192-206 — category schema table → add `models` (ordered chain), canonical `reasoning`, `max_tokens`, `provider_options`, `warn_unavailable`; mark `fallback_models`, `variant`, `maxTokens`, `reasoningEffort`, `thinking` deprecated (config/schema/categories.ts:5-41).
9. :330-356 — built-in slash commands: remove `/init-deep` from the command table (it is a built-in SKILL, not a command); the actual commands are /goal, /refactor, /start-work, /stop-continuation, /remove-ai-slops, /handoff, /hyperplan (features/builtin-commands/commands.ts:40-115). Move the /init-deep section to the skills table or note invocation via the skill surface.
10. :471-478 — built-in skills table "complete" → label as examples or enumerate the real set from packages/skills-loader-core builtin-skills/skills (agent-browser, debugging, dev-browser, frontend, git-master, init-deep, playwright, playwright-cli, remove-ai-slops, review-work, security-research, security-review, team-mode, visual-qa — verify the exact registry list before writing).
11. :647 — "20 to 39" → "12-38 registry tools".
12. :668-673 — LSP table: 8 aliases (add lsp_status and lsp_install_decision), all served by the built-in `lsp` MCP (lsp-core/src/tools/definitions.ts:9-137).
13. :753-765 — Task schema: add optional `repoURL` and `parentID` (tools/task/types.ts:6-20).
14. :796 — task storage → default is the OpenCode config dir `tasks/<list-id>` (via getOpenCodeConfigDir), overridable with sisyphus.tasks.storage_path (features/claude-tasks/storage.ts:13-35).
15. :832 — "use regular Bash with shell &" → point to the harness background-session/monitor mechanism instead.
16. :840-846 — counts: Session 24, ToolGuard 18 (17 non-team + teamToolGating), Transform 7, Continuation 7, Skill 2; total 58 composed slots, 62 max with Team Mode direct events.
17. :881 — category-skill-reminder → PostToolUse + experimental.chat.messages.transform + event handler (hooks/category-skill-reminder/hook.ts:185-188).
18. :888 — remove `thinking-block-validator` row (no such hook exists in hooks/); document `tool-pair-validator` if intended.
19. :939 — claude-code-hooks → executes Claude Code hook handlers for chat.message and tool.execute.before/after (hooks/claude-code-hooks/handlers/); not literally all hook events.
20. :1016 + :1033-1036 — built-in MCP set is five: websearch, context7, grep_app, lsp, codegraph (codegraph.enabled gating).
REJECTED items (do NOT change): :165 ultrabrain xhigh (category default really is xhigh — openai-categories.ts:152), :169 unspecified-low Luna xhigh (default really is luna xhigh — openai-categories.ts:171), :865-867 injector "both before and after" rows (directory-agents-injector and directory-readme-injector register tool.execute.after as the primary handler with optional before; rules-injector registers BOTH before and after — the doc claims are accurate enough), :915 agent-usage-reminder (returns tool.execute.after + event — doc correct), :922 task-resume-info (registers tool.execute.after — doc correct), :942 non-interactive-env (registers tool.execute.before — doc correct), :951 sisyphus-junior-notepad (registers tool.execute.before — doc correct).

## docs/reference/cli.md
21. :12-17 — bin list → add the `lazycodex` bin alias (package.json:38-44 ships 5 aliases: oh-my-openagent, oh-my-opencode, omo, lazycodex, lazycodex-ai).
22. :31-41 — command catalog → add `setup` (install alias), `config migrate`, and `ulw-loop` (cli-program.ts:99-273, runtime-commands.ts).
23. :59-72 — install option table → add --bailian-coding-plan, --minimax-cn-coding-plan, --minimax-coding-plan (cli-program.ts:111-114).
24. :74 — "lazycodex is only a marketplace repository name" → both lazycodex and lazycodex-ai are bin aliases defaulting install to Codex; distinguish the repository identity separately.
25. :111 — cleanup default-Codex aliases → both `lazycodex` and `lazycodex-ai` (cli/cleanup.ts:17).
26. :120 — doctor check groups → current OpenCode checks: System, Config, TUI Plugin, Deprecated Reasoning Keys, Tools, Models, Telemetry, Team Mode; plus separate Codex target checks (checks/index.ts:20-78).
27. :134-136 — doctor options → add `--platform <opencode|codex>` (cli-program.ts:237-244).
REJECTED: :278-281 exit codes claim is CORRECT as-is (boulder exits 0/1 only per boulder tests; all documented commands use 0/1).

## docs/reference/monitor.md
28. :120 — idle-mode claim → qualify: terminal batches (process exit) can be force-dispatched after the active-defer ceiling (MONITOR_OUTPUT_MAX_ACTIVE_DEFER_MS = 60_000; features/monitor/manager-internals.ts:63, output-injector.ts:262-273).
29. :121 — live_safe → mention the same terminal-batch defer-ceiling exception.

## docs/reference/web-terminal-visual-qa.md
30. :72 — "cleanup receipt proves no leftover pty, Chrome, PIDs, ports, or temp state" → cleanup records the pty action and browser closure attempt; it does not audit ports, temp state, or all leftover processes (script/qa/xterm-live-terminal.mjs:133-176).

DELIVERABLE: edits + /tmp/omo-docs-drift/fix-report-f3.md with FIXED/SKIPPED per item. STOP WHEN all items resolved.
