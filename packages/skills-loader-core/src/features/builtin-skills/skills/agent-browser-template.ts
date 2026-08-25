import agentBrowserSkillFile from "../agent-browser/SKILL.md" with { type: "text" }
import { parseFrontmatter } from "@oh-my-opencode/utils"

const EM_DASH = "\u2014"

export function createAgentBrowserTemplate(markdown: string): string {
  const { body } = parseFrontmatter(markdown)
  return body.trim().replaceAll(` ${EM_DASH} `, " - ")
}

/**
 * Body of the agent-browser skill (frontmatter stripped).
 * Profile/session rule from the imported SKILL.md: NEVER point `--profile` /
 * `AGENT_BROWSER_PROFILE` at the user's real/main browser profile when any
 * cookie, cache, or site-data clear might happen (`Network.clearBrowserCookies`,
 * `Storage.clearCookies`, `chrome.browsingData.remove`). Clone first
 * (`rsync -a <profile>/ <tmp-clone>/`) and launch against the clone; run any
 * clearing there only.
 */
export const agentBrowserTemplate = createAgentBrowserTemplate(agentBrowserSkillFile)
