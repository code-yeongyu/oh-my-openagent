# 20260905-task-async-first-sweep - remaining run_in_background surfaces rendered through their real builders

WHAT WAS TESTED: every model-facing surface that still prescribed `run_in_background=false` after #7795, rendered through the real builders on mengmotaMac (`bun render-dump.ts --repo <checkout> --out render/`): `buildGpt55SisyphusPrompt` (embeds the category/skills delegation guide), `buildGpt55SisyphusJuniorPrompt`, `createDelegateTaskPresentation().description`, the delegate tool's Zod `run_in_background` schema description via `createDelegateTask()`, `atlasPromptVariants.gpt`, `ULTRAWORK_GPT_PROMPT`, and delegate-core's `missing_run_in_background` fix hint. The task-resume-info hook's continuation line is pinned by its unit test (RED against the unmodified hook, GREEN after).

WHAT WAS OBSERVED: see render-check.txt (every expected phrase PASS, every forbidden phrase PASS) and the rendered files beside it; unit gates in green.txt (bun test over hooks/task-resume-info, hooks/atlas, hooks/delegate-task-retry, agents, tools/delegate-task, delegate-core, prompts-core; tsgo for omo-opencode, delegate-core, prompts-core).

WHY IT IS ENOUGH: the change is prompt text; the builders are the only path from these sources to a model, so their rendered output is the surface. Not driven: a live OpenCode or Codex session (opencode-qa / codex-qa harness drives) - the runtime behavior of the flag is unchanged and the earlier live gpt-6-astra backtest (`.omo/evidence/omo-senpi-adapter/20260905-task-async-first/`) already showed the model following the same wording on the senpi side.

WHAT WAS OMITTED: nothing secret-bearing was produced; rendered prompts contain no credentials.
