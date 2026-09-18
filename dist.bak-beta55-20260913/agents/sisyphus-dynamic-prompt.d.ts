import type { AvailableAgent, AvailableCategory, AvailableSkill, AvailableTool } from "./dynamic-agent-prompt-builder";
export declare function buildDynamicSisyphusPrompt(model: string, availableAgents: AvailableAgent[], availableTools?: AvailableTool[], availableSkills?: AvailableSkill[], availableCategories?: AvailableCategory[], useTaskSystem?: boolean): string;
export declare function buildFallbackSisyphusPrompt(model: string, agents: AvailableAgent[], tools: AvailableTool[], skills: AvailableSkill[], categories: AvailableCategory[], useTaskSystem?: boolean): string;
