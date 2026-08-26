/// <reference path="../../../../../../bun-test.d.ts" />

import { describe, expect, test } from "bun:test"
import { parseFrontmatter } from "../../../shared/frontmatter"
import { agentBrowserSkill as directAgentBrowserSkill } from "./agent-browser-skill"
import * as playwrightFacade from "./playwright"
import { createPlaywrightSkill, playwrightSkill as directPlaywrightSkill } from "./playwright-mcp-skill"

declare const Bun: {
  file(path: string): { text(): Promise<string> }
}

describe("playwright browser skill facade", () => {
  test("#given split browser skill modules #when importing through the facade #then it preserves exported skill identity", () => {
    // given
    const expectedExports = ["agentBrowserSkill", "createPlaywrightSkill", "playwrightSkill"]

    // when
    const exportNames = Object.keys(playwrightFacade).sort()

    // then
    expect(exportNames).toEqual(expectedExports)
    expect(playwrightFacade.agentBrowserSkill).toBe(directAgentBrowserSkill)
    expect(playwrightFacade.playwrightSkill).toBe(directPlaywrightSkill)
    expect(playwrightFacade.createPlaywrightSkill).toBe(createPlaywrightSkill)
  })

  test("#given playwright MCP skill data #when inspected #then metadata and MCP config stay stable", () => {
    // given
    const mcpConfig = playwrightFacade.playwrightSkill.mcpConfig?.playwright

    // then
    expect(playwrightFacade.playwrightSkill.name).toBe("playwright")
    expect(mcpConfig).toEqual({
      command: "npx",
      args: ["@playwright/mcp@latest"],
    })
  })

  test("#given createPlaywrightSkill called with no options #when inspecting mcp args #then result matches the legacy singleton", () => {
    // given
    const skill = createPlaywrightSkill()

    // when
    const mcpConfig = skill.mcpConfig?.playwright

    // then
    expect(skill.name).toBe(directPlaywrightSkill.name)
    expect(skill.description).toBe(directPlaywrightSkill.description)
    expect(skill.template).toBe(directPlaywrightSkill.template)
    expect(mcpConfig).toEqual({
      command: "npx",
      args: ["@playwright/mcp@latest"],
    })
  })

  test("#given createPlaywrightSkill with mcp_args override #when inspecting mcp args #then extra args are appended after @playwright/mcp@latest", () => {
    // given
    const skill = createPlaywrightSkill({
      mcp_args: ["--headless", "--no-sandbox", "--executable-path", "/opt/chromium/chrome"],
    })

    // when
    const mcpArgs = skill.mcpConfig?.playwright?.args

    // then
    expect(mcpArgs).toEqual([
      "@playwright/mcp@latest",
      "--headless",
      "--no-sandbox",
      "--executable-path",
      "/opt/chromium/chrome",
    ])
  })

  test("#given createPlaywrightSkill with an empty mcp_args array #when inspecting mcp args #then default invocation is preserved", () => {
    // given
    const skill = createPlaywrightSkill({ mcp_args: [] })

    // when
    const mcpArgs = skill.mcpConfig?.playwright?.args

    // then
    expect(mcpArgs).toEqual(["@playwright/mcp@latest"])
  })

  test("#given agent-browser source markdown #when exposed through the split skill #then metadata is parsed and tool markers stay stable", async () => {
    // given
    const agentBrowserSkillFile = await Bun.file("packages/omo-opencode/src/features/builtin-skills/agent-browser/SKILL.md").text()
    const { data, hadFrontmatter } = parseFrontmatter<{ readonly name: string }>(agentBrowserSkillFile)

    // when
    const skill = playwrightFacade.agentBrowserSkill

    // then
    expect(data.name).toBe("agent-browser")
    expect(hadFrontmatter).toBe(true)
    expect(skill.name).toBe("agent-browser")
    expect(skill.allowedTools).toEqual(["Bash(agent-browser:*)"])
    expect(parseFrontmatter(skill.template).hadFrontmatter).toBe(false)
    expect(skill.template).toContain("AGENT_BROWSER_SESSION")
  })
})
