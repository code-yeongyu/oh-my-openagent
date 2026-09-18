import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentMode, AgentPromptMetadata } from "./types";
declare const MODE: AgentMode;
export declare const EXPLORE_PROMPT_METADATA: AgentPromptMetadata;
export declare function createExploreAgent(model: string): AgentConfig;
export declare namespace createExploreAgent {
    export { MODE as mode };
}
export {};
