/**
 * Kimi K3-native Sisyphus prompt.
 *
 * K3 inherits K2.7's restrained, outcome-first steerability, but its thinking
 * policy is tuned even harder for long-horizon reasoning. The resulting value
 * is real on ambiguous architecture, multi-step debugging, and failure
 * diagnosis. The cost is a tendency to keep thinking once the decisive
 * condition is already met — re-deriving given facts, enumerating unused
 * alternatives, and second-guessing settled choices.
 *
 * This prompt does not suppress reasoning. It gives the reasoning a stop
 * condition: terminal conditions, commitment framing, and an explicit
 * "go work" rule. Everything else is the same shared builder surface as the
 * other Sisyphus variants.
 */
import type { AvailableAgent, AvailableTool, AvailableSkill, AvailableCategory } from "../dynamic-agent-prompt-builder";
import { categorizeTools } from "../dynamic-agent-prompt-builder";
export declare function buildKimiK3SisyphusPrompt(model: string, availableAgents: AvailableAgent[], availableTools?: AvailableTool[], availableSkills?: AvailableSkill[], availableCategories?: AvailableCategory[], useTaskSystem?: boolean): string;
export { categorizeTools };
