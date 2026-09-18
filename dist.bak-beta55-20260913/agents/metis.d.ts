import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentMode, AgentPromptMetadata } from "./types";
declare const MODE: AgentMode;
/**
 * Metis - Plan Consultant Agent
 *
 * Named after the Greek goddess of wisdom, prudence, and deep counsel.
 * Metis analyzes user requests BEFORE planning to prevent AI failures.
 *
 * Core responsibilities:
 * - Identify hidden intentions and unstated requirements
 * - Detect ambiguities that could derail implementation
 * - Flag potential AI-slop patterns (over-engineering, scope creep)
 * - Generate clarifying questions for the user
 * - Prepare directives for the planner agent
 */
export declare const METIS_SYSTEM_PROMPT: string;
export declare const METIS_K2_7_SYSTEM_PROMPT: string;
export declare function createMetisAgent(model: string): AgentConfig;
export declare namespace createMetisAgent {
    export { MODE as mode };
}
export declare const metisPromptMetadata: AgentPromptMetadata;
export {};
