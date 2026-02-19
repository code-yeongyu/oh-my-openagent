import type { GitMasterConfig, BrowserAutomationProvider } from "../../config/schema"
import { resolveMultipleSkillsAsync, getAllSkills } from "../../features/opencode-skill-loader/skill-content"

export async function resolveSkillContent(
  skills: string[],
  options: { gitMasterConfig?: GitMasterConfig; browserProvider?: BrowserAutomationProvider; disabledSkills?: Set<string>; directory?: string }
): Promise<{ content: string | undefined; error: string | null }> {
  if (skills.length === 0) {
    return { content: undefined, error: null }
  }

  const { resolved, notFound } = await resolveMultipleSkillsAsync(skills, options)
  if (notFound.length > 0) {
    const allSkills = await getAllSkills(options)
    const available = allSkills.map(s => s.name).join(", ")
    return { content: undefined, error: `Skills not found: ${notFound.join(", ")}. Available: ${available}` }
  }

  return { content: Array.from(resolved.values()).join("\n\n"), error: null }
}
