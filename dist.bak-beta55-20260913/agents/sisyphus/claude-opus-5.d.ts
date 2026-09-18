/**
 * Claude Opus 5-native Sisyphus prompt - tuned for Opus 5 behaviors.
 *
 * Design principles (Anthropic "Prompting Claude Opus 5" guidance, applied to
 * the Opus 4.8 skeleton - Opus 5 runs well on 4.8 prompts, so only the
 * documented behavior deltas are tuned):
 * - SCOPE CONSTRAINT replaces 4.8's over-asking counter: Opus 5 does not
 *   under-ask, it over-does - it expands scope and adds unrequested steps.
 *   Explicit "deliver what was asked, at the scope intended" calibration.
 * - DELEGATION CAP replaces 4.8's capability under-reach counter: Opus 5
 *   delegates to subagents MORE readily than prior models, so the 4.8
 *   "DEFAULT BIAS: DELEGATE" push is inverted into domain-and-size gating,
 *   with an explicit ban on verify-my-own-work subagents.
 * - OVER-VERIFICATION REMOVAL: Opus 5 self-verifies without being told.
 *   Evidence gates stay (they define WHAT counts as done) but run ONCE;
 *   repeat-verification scaffolding is removed per Anthropic guidance.
 * - NARRATION CADENCE: Opus 5 narrates readily and writes long responses;
 *   effort controls thinking volume, not response length. One-sentence
 *   opener, silence between tool calls, outcome-first wrap-ups, and a
 *   closing <tone_preference> reminder (Anthropic-recommended for long
 *   system prompts).
 * - CORRECTION NARRATION limited to corrections that change the user's
 *   code, conclusions, or decisions.
 * - WRITTEN DELIVERABLE length calibrated: no filler sections or boilerplate.
 * - LITERAL instruction following inherited from 4.7/4.8: state scope
 *   explicitly.
 * - XML-tagged anchors, Phase 0/1/2A/2B/2C/3 mental model, and shared dynamic
 *   helpers identical to the other Claude variants so content stays in sync.
 */
import type { AvailableAgent, AvailableTool, AvailableSkill, AvailableCategory } from "../dynamic-agent-prompt-builder";
import { categorizeTools } from "../dynamic-agent-prompt-builder";
export declare function buildClaudeOpus5SisyphusPrompt(model: string, availableAgents: AvailableAgent[], availableTools?: AvailableTool[], availableSkills?: AvailableSkill[], availableCategories?: AvailableCategory[], useTaskSystem?: boolean): string;
export { categorizeTools };
