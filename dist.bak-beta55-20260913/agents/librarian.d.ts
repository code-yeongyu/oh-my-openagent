import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentMode, AgentPromptMetadata } from "./types";
declare const MODE: AgentMode;
export declare const LIBRARIAN_PROMPT_METADATA: AgentPromptMetadata;
export declare function createLibrarianAgent(model: string): AgentConfig;
export declare namespace createLibrarianAgent {
    export { MODE as mode };
}
export {};
