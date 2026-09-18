import type { AgentConfig } from "@opencode-ai/sdk";
import type { BrowserAutomationProvider, GitMasterConfig } from "../config/schema";
export declare function resolveAgentSkills(config: AgentConfig, options?: {
    gitMasterConfig?: GitMasterConfig;
    browserProvider?: BrowserAutomationProvider;
    disabledSkills?: Set<string>;
    teamModeEnabled?: boolean;
}): AgentConfig;
