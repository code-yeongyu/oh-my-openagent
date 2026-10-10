import type {
  AvailableAgent,
  AvailableTool,
  AvailableSkill,
  AvailableCategory,
} from "../dynamic-agent-prompt-builder";
import { buildClaude5SisyphusPrompt } from "./claude-5-core";

export function buildClaudeHaiku55SisyphusPrompt(
  model: string,
  availableAgents: AvailableAgent[],
  availableTools: AvailableTool[] = [],
  availableSkills: AvailableSkill[] = [],
  availableCategories: AvailableCategory[] = [],
  useTaskSystem = false,
): string {
  return buildClaude5SisyphusPrompt(model, availableAgents, availableTools, availableSkills, availableCategories, useTaskSystem, "haiku-5-5");
}
