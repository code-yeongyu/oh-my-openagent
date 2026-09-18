/**
 * Shared GPT-5.5/GPT-5.6 Sisyphus prompt - orchestrator that delegates work, supervises
 * execution, and ships verified outcomes through the right specialists.
 */
import type { AvailableAgent, AvailableTool, AvailableSkill, AvailableCategory } from "../dynamic-agent-prompt-builder";
export declare function buildGpt55SisyphusPrompt(model: string, availableAgents: AvailableAgent[], _availableTools?: AvailableTool[], availableSkills?: AvailableSkill[], availableCategories?: AvailableCategory[], useTaskSystem?: boolean): string;
