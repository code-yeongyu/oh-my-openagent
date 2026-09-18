import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentMode, AgentPromptMetadata } from "./types";
declare const MODE: AgentMode;
export declare const ORACLE_PROMPT_METADATA: AgentPromptMetadata;
export declare function createOracleAgent(model: string): AgentConfig;
export declare namespace createOracleAgent {
    export { MODE as mode };
}
export {};
