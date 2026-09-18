/**
 * Kimi K2.7-native Sisyphus prompt.
 *
 * Authored for K2.7 from the ground up — not a tune of another model's prompt.
 * K2.7 is the Kimi base distilled toward Opus 4.8 steerability and GPT-5.5
 * directness: restrained, outcome-first, steerable. The whole prompt is written
 * in that register — decision rules and terminal conditions over absolutes and
 * repetition, Claude-family XML anchors for structure, and the agent's
 * analytical depth reserved for where correctness is genuinely at risk. The
 * runtime-injected capability sections (tool/delegation/category tables, key
 * triggers, explore/librarian guidance) are the shared builders every variant
 * uses; everything else here is authored for this model.
 */
import type { AvailableAgent, AvailableTool, AvailableSkill, AvailableCategory } from "../dynamic-agent-prompt-builder";
import { categorizeTools } from "../dynamic-agent-prompt-builder";
export declare function buildKimiK27SisyphusPrompt(model: string, availableAgents: AvailableAgent[], availableTools?: AvailableTool[], availableSkills?: AvailableSkill[], availableCategories?: AvailableCategory[], useTaskSystem?: boolean): string;
export { categorizeTools };
