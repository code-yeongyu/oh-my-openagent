/**
 * Claude Opus 4.7-native Sisyphus prompt - tuned for Opus 4.7 behaviors.
 *
 * Design principles (Anthropic Opus 4.7 prompting best practices + SMART distillation):
 * - LITERAL instruction following: state scope explicitly. 4.7 does not silently
 *   generalize "first item" into "every item".
 * - BOUNDED exploration/thinking: 4.7 tends to explore and deliberate longer than
 *   4.5/4.6 in practice, so this prompt caps exploration passes and steers
 *   adaptive thinking toward acting once context is sufficient.
 * - PARALLEL tool calling re-enabled via canonical `<use_parallel_tool_calls>` snippet.
 * - DIRECT tone, strong directives. Reinforced with bold/CAPS for load-bearing rules.
 * - PROSE-DENSE sections borrowed from SMART production agent prompt
 *   (autonomy/persistence, investigation, subagents, verification, pragmatism,
 *   reversibility, file links) - rewritten tighter and stronger.
 * - XML-tagged anchors throughout, Phase 0/1/2A/2B/2C/3 mental model preserved.
 * - Shared dynamic helpers (key triggers, tool selection, delegation tables)
 *   reused so content stays in sync across variants.
 */
import type { AvailableAgent, AvailableTool, AvailableSkill, AvailableCategory } from "../dynamic-agent-prompt-builder";
import { categorizeTools } from "../dynamic-agent-prompt-builder";
export declare function buildClaudeOpus47SisyphusPrompt(model: string, availableAgents: AvailableAgent[], availableTools?: AvailableTool[], availableSkills?: AvailableSkill[], availableCategories?: AvailableCategory[], useTaskSystem?: boolean): string;
export { categorizeTools };
