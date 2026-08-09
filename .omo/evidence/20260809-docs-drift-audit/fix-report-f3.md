# F3 Documentation Drift Fix Report

1. FIXED - Added `(low)` to the first GPT-5.6 Luna Fast rung for Librarian and Explore.
2. FIXED - Removed the unsupported Atlas delegation restriction row.
3. FIXED - Corrected Momus restrictions to write/edit only and stated that `task` is not denied.
4. FIXED - Documented 14 tool-producing directories plus the shared helper directory, 12-38 registry tools, and MCP-served LSP aliases.
5. FIXED - Updated hook composition to 58 slots, about 50-51 active by default, and 62 maximum with direct Team Mode handlers.
6. FIXED - Updated Tier-1 MCPs to three remote servers plus local stdio `lsp` and `codegraph`, including codegraph gating.
7. FIXED - Replaced the fixed manager count with the always-created and optional manager/controller fields.
8. SKIPPED - The cited schema does not mark `thinking` deprecated, so the requested combined schema rewrite is not fully supported.
9. FIXED - Removed `/init-deep` from built-in commands, added `/remove-ai-slops` and `/hyperplan`, and moved init-deep guidance to skills.
10. FIXED - Enumerated the 14 registered built-in skill names and explained browser selection and Team Mode gating.
11. FIXED - Changed the registry tool range to 12-38.
12. FIXED - Added `lsp_status` and `lsp_install_decision` and stated that all eight aliases come from the built-in `lsp` MCP.
13. FIXED - Added optional `repoURL` and `parentID` fields to the Task schema.
14. FIXED - Corrected default task storage to the OpenCode config directory and documented `sisyphus.tasks.storage_path`.
15. FIXED - Replaced shell `&` guidance with the managed background-session/Monitor mechanism.
16. FIXED - Updated all hook tier counts and the 58/62 totals.
17. FIXED - Documented category-skill-reminder as PostToolUse, message transform, and event handling.
18. FIXED - Replaced the nonexistent thinking-block-validator row with tool-pair-validator.
19. FIXED - Scoped claude-code-hooks to supported message and tool handlers instead of all OMO hook events.
20. FIXED - Updated both built-in MCP inventories to the five-server set and documented codegraph gating.
21. FIXED - Added the `lazycodex` bin alias.
22. FIXED - Added the `setup`, `config migrate`, and `ulw-loop` commands.
23. FIXED - Added the Bailian and two MiniMax install options.
24. FIXED - Documented both LazyCodex bin aliases as Codex-defaulting and separated repository identity.
25. FIXED - Updated cleanup default-Codex aliases to both `lazycodex` and `lazycodex-ai`.
26. FIXED - Listed all current OpenCode doctor groups and noted separate Codex checks.
27. FIXED - Added doctor `--platform <opencode|codex>`.
28. FIXED - Added the terminal-batch 60-second active-defer exception to idle mode.
29. FIXED - Added the same terminal-batch defer-ceiling exception to live_safe mode.
30. FIXED - Narrowed the cleanup receipt claim to recorded pty cleanup and browser closure attempts.
