/**
 * Claude Opus 4.8-native Sisyphus prompt - tuned for Opus 4.8 behaviors.
 *
 * Design principles (Anthropic Opus 4.8 migration guidance + 4.7 distillation):
 * - SILENCE DEFAULT: 4.8 narrates more than 4.7 (interim updates, long wrap-ups).
 *   Explicit silence-between-tool-calls instruction restores terse behavior.
 * - SMALL-DECISION AUTONOMY: 4.8 is more deliberate and asks more often on minor
 *   choices. Explicit don't-ask guidance for naming/defaults/equivalent approaches.
 * - EXPLICIT CAPABILITY TRIGGERS: 4.8 under-reaches for subagents and tools that
 *   need a decide-to-use step; triggers fire delegation, but exploration stays
 *   bounded (one pass, sufficient > complete) like the 4.7 variant.
 * - LITERAL instruction following inherited from 4.7: state scope explicitly.
 * - XML-tagged anchors, Phase 0/1/2A/2B/2C/3 mental model, and shared dynamic
 *   helpers identical to the 4.7 variant so content stays in sync.
 */
import type { AvailableAgent, AvailableTool, AvailableSkill, AvailableCategory } from "../dynamic-agent-prompt-builder";
import { categorizeTools } from "../dynamic-agent-prompt-builder";
export declare function buildClaudeOpus48SisyphusPrompt(model: string, availableAgents: AvailableAgent[], availableTools?: AvailableTool[], availableSkills?: AvailableSkill[], availableCategories?: AvailableCategory[], useTaskSystem?: boolean): string;
export { categorizeTools };
