import type { AgentPromptMetadata } from "./types";

export const SISYPHUS_PROMPT_METADATA: AgentPromptMetadata = {
  category: "utility",
  cost: "EXPENSIVE",
  promptAlias: "Sisyphus",
  triggers: [],
};

export { createSisyphusAgent } from "./sisyphus-agent-factory";
