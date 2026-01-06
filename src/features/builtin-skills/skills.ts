import type { BuiltinSkill } from "./types"

const playwrightSkill: BuiltinSkill = {
  name: "playwright",
  description: "MUST USE for any browser-related tasks. Browser automation via Playwright MCP - verification, browsing, information gathering, web scraping, testing, screenshots, and all browser interactions.",
  template: `# Playwright Browser Automation

This skill provides browser automation capabilities via the Playwright MCP server.`,
  mcpConfig: {
    playwright: {
      command: "npx",
      args: ["@playwright/mcp@latest"],
    },
  },
}

export function createBuiltinSkills(): BuiltinSkill[] {
  return [playwrightSkill]
}
