import type { AgentPromptMetadata } from "./types";
export interface AvailableAgent {
    name: string;
    description: string;
    metadata: AgentPromptMetadata;
}
export interface AvailableTool {
    name: string;
    category: "lsp" | "ast" | "search" | "session" | "command" | "other";
}
export interface AvailableSkill {
    name: string;
    description: string;
    location: "user" | "project" | "plugin";
}
export interface AvailableCategory {
    name: string;
    description: string;
    model?: string;
}
export declare function categorizeTools(toolNames: string[]): AvailableTool[];
export declare function buildKeyTriggersSection(agents: AvailableAgent[], _skills?: AvailableSkill[]): string;
export declare function buildToolSelectionTable(agents: AvailableAgent[], tools?: AvailableTool[], _skills?: AvailableSkill[]): string;
export declare function buildExploreSection(agents: AvailableAgent[]): string;
export declare function buildLibrarianSection(agents: AvailableAgent[]): string;
export declare function buildDelegationTable(agents: AvailableAgent[]): string;
export declare function buildCategorySkillsDelegationGuide(categories: AvailableCategory[], skills: AvailableSkill[]): string;
export declare function buildOracleSection(agents: AvailableAgent[]): string;
export declare function buildHardBlocksSection(): string;
export declare function buildAntiPatternsSection(): string;
export declare function buildToolCallFormatSection(): string;
export declare function buildNonClaudePlannerSection(model: string): string;
export declare function buildParallelDelegationSection(model: string, categories: AvailableCategory[]): string;
export declare function buildUltraworkSection(agents: AvailableAgent[], categories: AvailableCategory[], skills: AvailableSkill[]): string;
export declare function buildAntiDuplicationSection(): string;
