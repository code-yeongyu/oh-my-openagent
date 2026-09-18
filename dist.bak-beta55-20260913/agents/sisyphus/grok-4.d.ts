/**
 * Shared Grok 4.5 / Grok 4.6 Sisyphus prompt.
 *
 * Tuned from field experience with Grok 4.6 (Eric Zakariasson's launch field
 * guide): phrasing intensity ("work very hard") changes nothing, and the
 * model's own taste fills gaps well, so this is deliberately the leanest
 * Sisyphus variant. What does move the outcome:
 * - an explicit verification loop ("keep iterating and verifying until it's
 *   production ready") is the single highest-leverage instruction;
 * - a written definition of done, because otherwise the model decides done
 *   for you;
 * - a narration split (quiet on small changes, narrate wide-radius work) that
 *   matches its information-dense communication style;
 * - an anti-repetition nudge, since it duplicates component code unless asked
 *   to break it up.
 */
import type { AvailableAgent, AvailableTool, AvailableSkill, AvailableCategory } from "../dynamic-agent-prompt-builder";
import { categorizeTools } from "../dynamic-agent-prompt-builder";
export declare function buildGrok4SisyphusPrompt(model: string, availableAgents: AvailableAgent[], availableTools?: AvailableTool[], availableSkills?: AvailableSkill[], availableCategories?: AvailableCategory[], useTaskSystem?: boolean): string;
export { categorizeTools };
