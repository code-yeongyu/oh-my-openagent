import type { GitMasterConfig, BrowserAutomationProvider } from "../../config/schema"
import { resolveMultipleSkillsAsync } from "../../features/opencode-skill-loader/skill-content"
import { discoverSkills } from "../../features/opencode-skill-loader"

export async function resolveSkillContent(
  skills: string[],
  options: { gitMasterConfig?: GitMasterConfig; browserProvider?: BrowserAutomationProvider, disabledSkills?: Set<string>, directory?: string }
): Promise<{ content: string | undefined; contents: string[]; error: string | null }> {
  if (skills.length === 0) {
    return { content: undefined, contents: [], error: null }
  }

  const { resolved, notFound } = await resolveMultipleSkillsAsync(skills, options)
  if (notFound.length > 0) {
    const allSkills = await discoverSkills({ includeClaudeCodePaths: true, directory: options?.directory })
    const available = allSkills.map(s => s.name).join(", ")
    return { content: undefined, contents: [], error: `Skills not found: ${notFound.join(", ")}. Available: ${available}` }
  }

  const contents = Array.from(resolved.values())
  return { content: contents.join("\n\n"), contents, error: null }
}
