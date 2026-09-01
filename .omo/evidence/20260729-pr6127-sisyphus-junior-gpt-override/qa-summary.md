# QA Evidence - PR #6127 sisyphus-junior GPT variant/reasoningEffort overrides

## What was tested
- Unit RED->GREEN on `createSisyphusJuniorAgentWithOverrides` + `getSisyphusJuniorPromptSource` (worktree at PR head, then merged with dev + corrected impl).
  - RED 1 (PR head 0a43f7922e): 3 failures - reasoningEffort-only override fabricates `variant`; variant-only override contaminates `reasoningEffort`; gpt-5.6 misroutes to generic "gpt" prompt (accidental revert).
  - RED 2 (post dev-merge, PR impl kept): 3 failures - both cross-contamination cases + Claude variant override ignored.
  - GREEN (corrected impl): 62 pass / 0 fail; `bunx tsgo --noEmit -p packages/omo-opencode` exit 0.
  - Adjacent suites: agents/ 375 pass, plugin-handlers/ 227 pass.
- REAL OpenCode surface (AGENTS.md mandate): runtime bundle `dist/index.js` (bun build + require-shim patch) loaded into real `opencode serve` v1.18.7 in an isolated XDG sandbox; two projects under $HOME:
  - override project `.omo/omo.jsonc`: agents.sisyphus-junior = { model: openai/gpt-5.6-sol, variant: xhigh, reasoningEffort: xhigh }
  - control project: same model, no variant/reasoningEffort.
  - Asserted via `GET /config?directory=...` (merged agent config) and `GET /agent?directory=...`.

## What was observed
- override: `variant: "xhigh"`, `reasoningEffort: "xhigh"`, model `openai/gpt-5.6-sol` in merged agent config (real-opencode-config.json); `/agent` shows `variant: "xhigh"` reaching the runtime agent surface.
- control: NO `variant` key, `reasoningEffort: "medium"` (default preserved - negative control proving no cross-contamination and unchanged default behavior).
- GPT-5.6 prompt routing restored: rendered Sisyphus-Junior prompt begins "...based on GPT-5.6 Sol" (gpt-5-5 model-aware family), not the generic GPT prompt.
- Isolation: server ran with sandboxed XDG_*; real `~/.local/share/opencode/opencode.db` session count 21932 before, 21932 after (unchanged). Server pid terminated; sandbox dirs removed.

## Why it is enough
The change is confined to `createSisyphusJuniorAgentWithOverrides` output. The unit RED->GREEN pins each override field independently (distinct values, so cross-contamination cannot pass), plus gpt-5.6 routing and Claude-variant honoring. The real-OpenCode probe proves the exact user-visible contract end to end: a user's `.omo/omo.jsonc` override lands in the merged agent config OpenCode serves, and the default stays "medium" when unset. Adjacent agent/plugin-handler suites cover regression risk in the assembly path.

## What was omitted
- No secrets involved; sandbox served with a throwaway password, never logged. Raw serve logs discarded with the sandbox (contained only startup noise).
- reasoningEffort is not surfaced by `GET /agent` options on opencode 1.18.7 (empty for every agent incl. Hephaestus/Momus); the merged-config endpoint is the authoritative surface for it and was used instead.

Generated: 2026-07-29T11:37:30.801487
