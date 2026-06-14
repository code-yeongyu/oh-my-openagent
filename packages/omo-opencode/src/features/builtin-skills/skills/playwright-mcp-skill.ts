import type { BuiltinSkill } from "../types"

export const playwrightSkill: BuiltinSkill = {
  name: "playwright",
  description: "Browser automation via Playwright MCP — verification, browsing, information gathering, web scraping, testing, screenshots, and all browser interactions.",
  template: `# Playwright Browser Automation

This skill provides browser automation capabilities via the Playwright MCP server.`,
  mcpConfig: {
    playwright: {
      command: "npx",
      args: ["@playwright/mcp@latest"],
    },
  },
}
