import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentMode, AgentFactory } from "../types";

import {
  PROMETHEUS_CREDIT_SYSTEM_PROMPT,
  PROMETHEUS_CREDIT_PERMISSION,
} from "./system-prompt";

const MODE: AgentMode = "subagent";

/**
 * Creates a Prometheus-Credit agent configuration.
 * Credit-specialized planning agent for loan servicing features.
 */
export function createPrometheusCreditAgent(model: string): AgentConfig {
  return {
    description:
      "Credit-specialized planning agent for loan servicing features",
    mode: MODE,
    model,
    temperature: 0.1,
    prompt: PROMETHEUS_CREDIT_SYSTEM_PROMPT,
    tools: { webfetch: true },
    permission: PROMETHEUS_CREDIT_PERMISSION,
  } as AgentConfig;
}

createPrometheusCreditAgent.mode = MODE;

export default createPrometheusCreditAgent;
export type { AgentFactory };
