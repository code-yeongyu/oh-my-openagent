# F2 Fix Instructions — models-misc report files

Worktree (edit ONLY here): <worktree>
Files you own (edit NOTHING else): docs/guide/agent-model-matching.md, docs/reference/known-issues.md, docs/reference/codex-telemetry.md, docs/reference/lazycodex-npm-reservation.md, docs/reference/release-process.md
Report: /tmp/omo-docs-drift/models-misc.md

Global rules: same as other fixers — re-verify each citation before editing, skip+report mismatches, smallest edit, ASCII, no em dashes, UNVERIFIABLE items untouched.

## docs/guide/agent-model-matching.md
1. :51 — "Sisyphus uses Claude, Kimi, and GLM" → add GPT-5.6 Sol (third automatic rung before GLM; agent-model-requirements.ts:26).
2. :165 — "Hephaestus requires the GPT-5.x family" → Hephaestus has exactly one automatic model, GPT-5.6 Sol (agent-model-requirements.ts:32-41); no GPT-5.4/5.5 fallback.
3. :253 — remove Prometheus from GPT paths list (its chain is Fable 5 xhigh then Kimi K3 max only; agent-model-requirements.ts:102-110).
4. :260 — remove the GPT-5.4/5.4-pro built-in-fallback claim (built-in Hephaestus is Sol-only).
5. :262 — "MiniMax is used only in Explore and Librarian" → also Atlas and Sisyphus-Junior (agent-model-requirements.ts:157-185, minimax-m3/MiniMax-M3/minimax-m2.7 rungs).
6. :268-274 — visual-engineering chain: add the fourth rung gpt-5.6-sol (medium); Opus providers are anthropic/anthropic-api/github-copilot/opencode/vercel; GLM rung providers are zai-coding-plan/opencode-go/vercel (category-model-requirements.ts:4-26).
7. :284 — "Losing Claude should fall back Kimi K3, Kimi K2.7, GLM 5.2, Big Pickle and avoid GPT" → for Sisyphus the chain is Kimi K3 → GPT-5.6 Sol (medium) → GLM 5.2 → big-pickle; K2.7 is not an automatic rung (agent-model-requirements.ts:12-28).
8. :285 — "Losing GPT-5.4/5.5/5.6 should fall back to DeepSeek v3.2" → no built-in deep-agent chain uses DeepSeek v3.2; replace with actual per-agent chains (Hephaestus Sol-only; Oracle Sol→Gemini 3.1 Pro→Opus 5→GLM 5.2).
9. :286 — visual-engineering "only Opus 5, Kimi K3, GLM 5.2" → add gpt-5.6-sol medium fourth rung.
10. :287 — Explore/Librarian after Luna Fast: insert deepseek-v4-flash (max) immediately after Luna Fast; providers for M2.7 Highspeed = vercel; include minimax-m2.7 and gpt-5.4-nano rungs (agent-model-requirements.ts:68-92).
11. :302/:303 — add the `(low)` variant to the first gpt-5.6-luna-fast rung in the Librarian and Explore exact-chain rows (agent-model-requirements.ts:69-70, 82-83).
12. :325 — merge the two duplicate Kimi K3 rows into one accurate row; fix the Kimi K2.7 row: K2.7 is a manual/catalog option, NOT in any active built-in chain (all chains use K3 now; agent-model-requirements.ts:12-25).
13. :338 — remove Prometheus from "GPT-5.6 Sol is a key fallback" (only Atlas has that GPT fallback among the named agents).
14. :350 — "MiniMax M2.7 is used through OpenCode Go and OpenCode Zen" → providers are opencode-go and vercel (agent-model-requirements.ts:76,89,168,182).
15. :351 — "MiniMax M2.7 Highspeed is an OpenCode catalog entry" → it is a vercel-only fallback rung (agent-model-requirements.ts:73,86).
16. :363 — OpenCode Go GLM 5.2 usage list → remove Prometheus, Metis, ultrabrain (their chains have no GLM rung); active GLM rows: Sisyphus, Oracle, Momus, visual-engineering.
17. :245 — Sisyphus GLM 5.2 providers → zai-coding-plan, opencode, bailian-coding-plan, vercel (remove opencode-go; agent-model-requirements.ts:27).
18. :534 — "Prometheus can safely switch Opus to GPT-5.6 Sol as a built-in-style fallback" → call it an explicit user override, not an automatic/source-backed fallback.
19. :552 — approved visual chain → add gpt-5.6-sol medium as the final built-in rung.
20. :570 — injected order values 0,1,2,3 → 1,2,3,4 (plugin-handlers/agent-priority-order.ts:15-33, index+1).
NOTE: report items :259 and :335-337 (unspecified-low Luna default) are REJECTED — the category default genuinely is openai/gpt-5.6-luna:xhigh (delegate-task/openai-categories.ts:171-175); only the requirement chain starts at Terra high. Leave those lines.

## docs/reference/known-issues.md
21. :19-24 — Ralph-loop/`<promise>VERIFIED</promise>` issue → move to a historical/resolved note: Ralph Loop is not wired in current session hooks and Goal does not use that detector (plugin/hooks/create-session-hooks.ts; hooks/ralph-loop retained but unwired).
22. :54-59 — "Built-in GPT-5.5 agent configurations may send reasoning effort to incompatible providers" → built-ins now use GPT-5.6 Sol; retain only as a manual custom-provider/upstream OpenCode caveat.
23. :61-66 — required-model unpinned-child issue → mark resolved: required agents are skipped when their availability gates fail (agents/builtin-agents/sisyphus-agent.ts:46-60).
24. :115-120 — LSP config locations → current supported files: .opencode/lsp.json, .omo/lsp.json, .omo/lsp-client.json, or the user-level lsp.json (mcp/lsp.ts:14 PROJECT_LSP_CONFIGS).
25. :192-197 — Ralph Loop log flooding → historical/resolved note (Goal replaced Ralph Loop).
26. :199-214 — Windows Bun.serve workaround → remove/resolve: the runtime skill source server falls back to Node HTTP when Bun.serve is unavailable (features/opencode-runtime-skills/source-server.test.ts:58-80).

## docs/reference/codex-telemetry.md
27. :25 — `npx lazycodex-ai install` → `bunx lazycodex-ai install` (repo runtime policy is Bun-first; publish.yml ships the lazycodex-ai bin).

## docs/reference/lazycodex-npm-reservation.md
28. :7-9 — trusted-publisher preflight is now a HARD gate for all selected release packages including lazycodex-ai (publish.yml:178-240 preflight-trust); missing trusted publishing fails preflight and blocks the release. Remove the manual `npm publish` with NPM_AUTH_TOKEN playbook; instruct configuring trusted publishing first and publishing through the workflow.
29. :15 — split behaviors: marketplace repository push occurs when generated files differ from the marketplace repo; GitHub Release occurs only when comparison with the previous npm payload says changed (publish.yml:923-1013).

## docs/reference/release-process.md
30. :9 — "version bump and package metadata must already be present on the release branch" → the workflow calculates the version, stamps package metadata on a release-state branch, opens/merges a release-state PR, then republishes from the prepared SHA (publish.yml:271-305,336-480).

DELIVERABLE: edits + /tmp/omo-docs-drift/fix-report-f2.md with FIXED/SKIPPED per item. STOP WHEN all items resolved.
