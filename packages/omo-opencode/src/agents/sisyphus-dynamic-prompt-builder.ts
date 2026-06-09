import type {
  AvailableAgent,
  AvailableCategory,
  AvailableSkill,
  AvailableTool,
} from "./dynamic-agent-prompt-builder";
import { renderExecutionSections } from "./sisyphus-dynamic-prompt-execution";
import { renderExplorationSection } from "./sisyphus-dynamic-prompt-exploration";
import { renderRoleAndIntentSections } from "./sisyphus-dynamic-prompt-role";
import { buildSisyphusDynamicPromptSections } from "./sisyphus-dynamic-prompt-sections";
import { renderToneAndConstraintsSection } from "./sisyphus-dynamic-prompt-style";

export function buildSisyphusDynamicPromptContent(
  model: string,
  availableAgents: AvailableAgent[],
  availableTools: AvailableTool[],
  availableSkills: AvailableSkill[],
  availableCategories: AvailableCategory[],
  useTaskSystem: boolean,
): string {
  const sections = buildSisyphusDynamicPromptSections(
    model,
    availableAgents,
    availableTools,
    availableSkills,
    availableCategories,
    useTaskSystem,
  );

  return `${renderRoleAndIntentSections(sections)}

${renderExplorationSection(sections)}

${renderExecutionSections(sections)}

${renderToneAndConstraintsSection(sections)}`;
}
