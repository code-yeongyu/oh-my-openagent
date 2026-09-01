# F2 Documentation Drift Fix Report

1. FIXED - Added GPT-5.6 Sol to the Sisyphus model-family summary before GLM.
2. FIXED - Documented GPT-5.6 Sol as Hephaestus's only automatic model, with no GPT-5.4/5.5 fallback.
3. FIXED - Removed Prometheus from the built-in GPT-path usage list.
4. FIXED - Recast GPT-5.4/5.4-pro as manual/catalog choices rather than Hephaestus built-in fallbacks.
5. FIXED - Added Atlas and Sisyphus-Junior to the agents with MiniMax fallback rungs.
6. FIXED - Corrected visual-engineering providers and added GPT-5.6 Sol medium as the fourth rung.
7. FIXED - Replaced the Sisyphus substitution row with Kimi K3, GPT-5.6 Sol medium, GLM 5.2, and Big Pickle.
8. FIXED - Replaced the DeepSeek v3.2 claim with the actual Hephaestus and Oracle fallback behavior.
9. FIXED - Added GPT-5.6 Sol medium to the visual-engineering substitution row.
10. FIXED - Expanded the Explore/Librarian post-Luna chain with DeepSeek v4 Flash, Vercel Highspeed, MiniMax M2.7, and GPT-5.4 Nano.
11. FIXED - Added the low variant to the first Luna Fast rung in both Librarian and Explore exact-chain rows.
12. FIXED - Merged duplicate Kimi K3 model-family rows and marked Kimi K2.7 as manual/catalog-only.
13. FIXED - Removed Prometheus from the GPT-5.6 Sol key-fallback description.
14. FIXED - Corrected MiniMax M2.7 providers to opencode-go and vercel.
15. FIXED - Documented MiniMax M2.7 Highspeed as a Vercel-only fallback rung.
16. SKIPPED - The cited Sisyphus chain excludes opencode-go for GLM 5.2, contradicting the instruction to retain Sisyphus in an opencode-go/glm-5.2 usage row.
17. FIXED - Corrected Sisyphus GLM 5.2 providers to zai-coding-plan, opencode, bailian-coding-plan, and vercel.
18. FIXED - Labeled Prometheus-to-GPT-5.6-Sol as an explicit user override, not an automatic fallback.
19. FIXED - Added GPT-5.6 Sol medium to the approved visual-engineering chain.
20. FIXED - Corrected injected core-agent order values to 1, 2, 3, and 4.
21. FIXED - Moved the Ralph Loop VERIFIED-token issue to a historical resolved note and distinguished current Goal behavior.
22. FIXED - Limited the GPT-5.5 reasoning issue to manual custom-provider/upstream OpenCode configurations.
23. FIXED - Marked required-model unpinned-child behavior resolved by agent availability gates.
24. FIXED - Listed .opencode/lsp.json, .omo/lsp.json, .omo/lsp-client.json, and user-level lsp.json as supported LSP config locations.
25. FIXED - Moved Ralph Loop log flooding to a historical resolved note.
26. FIXED - Removed the Windows skill-disable workaround and documented the Node HTTP fallback when Bun.serve is unavailable.
27. FIXED - Changed the LazyCodex installer trigger from npx to bunx.
28. FIXED - Documented trusted-publisher preflight as a hard gate and removed the manual NPM_AUTH_TOKEN publish playbook.
29. FIXED - Separated marketplace-repository sync conditions from previous-npm-payload GitHub Release conditions.
30. FIXED - Documented workflow-calculated versioning, release-state PR stamping/merge, and publication from the prepared SHA.
