---
name: sisyphus-junior-agent
description: Sisyphus-Junior factory, shared Native model core, and OpenCode role composition.
---

# Sisyphus-Junior

The category-spawned executor renders its model core through
`native-model-prompt.ts` and appends its OpenCode role through
`opencode-role-append.ts`. There are no local per-model prompt files or routing tables.
The public Senpi preset contract owns both selection and content.

- `agent.ts` owns the factory, defaults, permission merging and user appends.
- `index.ts` exports the factory and prompt entrypoints.
- `index.test.ts` covers configuration and permission behavior.
- The parent `per-agent-prompt-parity.test.ts` compares rendered content over the catalog.

Mode remains subagent, the default model is claude-sonnet-5, temperature is
0.1 and maxTokens is 64000. The task tool is denied for every model;
call_omo_agent remains allowed for research. GPT uses medium reasoning by
default; GLM has no injected thinking, and the existing Claude thinking
configuration applies elsewhere. User file-backed prompt appends still
resolve through the existing URI boundary and remain last.
