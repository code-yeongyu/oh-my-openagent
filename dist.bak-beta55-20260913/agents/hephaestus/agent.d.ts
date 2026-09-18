import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentMode, AgentPromptMetadata } from "../types";
import type { AvailableAgent, AvailableTool, AvailableSkill, AvailableCategory } from "../dynamic-agent-prompt-builder";
declare const MODE: AgentMode;
export type HephaestusPromptSource = "gpt-5-6" | "gpt-5-5" | "gpt-5-4" | "gpt";
export declare class UnsupportedHephaestusModelError extends Error {
    readonly model: string | undefined;
    constructor(model: string | undefined);
}
export declare function isHephaestusSupportedModel(model: string | undefined): boolean;
export declare function getHephaestusPromptSource(model?: string): HephaestusPromptSource;
export interface HephaestusContext {
    model?: string;
    availableAgents?: AvailableAgent[];
    availableTools?: AvailableTool[];
    availableSkills?: AvailableSkill[];
    availableCategories?: AvailableCategory[];
    useTaskSystem?: boolean;
}
export declare function getHephaestusPrompt(model?: string, useTaskSystem?: boolean): string;
export declare function createHephaestusAgent(model: string, availableAgents?: AvailableAgent[], availableToolNames?: string[], availableSkills?: AvailableSkill[], availableCategories?: AvailableCategory[], useTaskSystem?: boolean): AgentConfig;
export declare namespace createHephaestusAgent {
    export { MODE as mode };
}
export declare const hephaestusPromptMetadata: AgentPromptMetadata;
export {};
