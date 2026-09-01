import type { BuiltinSkill } from "../types"
import { agentBrowserTemplate } from "./agent-browser-template"

export const agentBrowserSkill: BuiltinSkill = {
  name: "agent-browser",
  description: "MUST USE for any browser-related tasks. Browser automation via agent-browser CLI - verification, browsing, information gathering, web scraping, testing, screenshots, and all browser interactions.",
  template: agentBrowserTemplate,
  allowedTools: ["Bash(agent-browser:*)"],
}
