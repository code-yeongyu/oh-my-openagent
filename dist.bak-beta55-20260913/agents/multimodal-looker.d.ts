import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentMode, AgentPromptMetadata } from "./types";
declare const MODE: AgentMode;
export declare const MULTIMODAL_LOOKER_PROMPT_METADATA: AgentPromptMetadata;
export declare function createMultimodalLookerAgent(model: string): AgentConfig;
export declare namespace createMultimodalLookerAgent {
    export { MODE as mode };
}
export {};
