import agentBrowserSkillFile from "../agent-browser/SKILL.md" with { type: "text" }
import { parseFrontmatter } from "../../../shared/frontmatter"

const EM_DASH = "\u2014"

export function createAgentBrowserTemplate(markdown: string): string {
  const { body } = parseFrontmatter(markdown)
  return body.trim().replaceAll(` ${EM_DASH} `, " - ")
}

export const agentBrowserTemplate = createAgentBrowserTemplate(agentBrowserSkillFile)
