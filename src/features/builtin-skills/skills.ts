import type { BuiltinSkill } from "./types"

const playwrightSkill: BuiltinSkill = {
  name: "playwright",
  description: "Browser automation with Playwright MCP. Use for web scraping, testing, screenshots, and browser interactions.",
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
