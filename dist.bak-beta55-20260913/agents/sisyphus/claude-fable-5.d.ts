/**
 * Claude Fable 5-native Sisyphus prompt - tuned for Fable 5 behaviors.
 *
 * Design principles (Anthropic Fable 5 guidance: same request surface and
 * behavioral profile direction as Opus 4.8, one tier above Opus):
 * - SILENCE DEFAULT and TERSE WRAP-UPS: counter narration-heavy defaults.
 * - SMALL-DECISION AUTONOMY: decide naming/defaults/equivalent approaches
 *   without asking; reserve questions for scope changes and destructive actions.
 * - BOUNDED exploration/thinking: one exploration pass, sufficient > complete,
 *   act once context is sufficient - same direction as the 4.7/4.8 variants.
 * - EXPLICIT CAPABILITY TRIGGERS: matching trigger → delegate immediately.
 * - LITERAL instruction following: state scope explicitly.
 * - XML-tagged anchors, Phase 0/1/2A/2B/2C/3 mental model, and shared dynamic
 *   helpers identical to the Opus variants so content stays in sync.
 */
import type { AvailableAgent, AvailableTool, AvailableSkill, AvailableCategory } from "../dynamic-agent-prompt-builder";
import { categorizeTools } from "../dynamic-agent-prompt-builder";
export declare function buildClaudeFable5SisyphusPrompt(model: string, availableAgents: AvailableAgent[], availableTools?: AvailableTool[], availableSkills?: AvailableSkill[], availableCategories?: AvailableCategory[], useTaskSystem?: boolean): string;
export { categorizeTools };
