/// <reference path="../../../../../../bun-test.d.ts" />

import { describe, expect, test } from "bun:test"
import { parseFrontmatter } from "../../../shared/frontmatter"
import { agentBrowserSkill as directAgentBrowserSkill } from "./agent-browser-skill"
import * as playwrightFacade from "./playwright"
import { createPlaywrightSkill, playwrightSkill as directPlaywrightSkill } from "./playwright-mcp-skill"

declare const Bun: {
  file(path: string): { text(): Promise<string> }
}

function orderedIndexes(source: string, markers: readonly string[]): readonly number[] {
  return markers.map((marker) => source.indexOf(marker))
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

  test("#given playwright MCP skill data #when inspected #then metadata and MCP frontmatter markers stay stable", () => {
    // given
    const mcpConfig = playwrightFacade.playwrightSkill.mcpConfig?.playwright

    // when
    const template = playwrightFacade.playwrightSkill.template

    // then
    expect(playwrightFacade.playwrightSkill.name).toBe("playwright")
    expect(playwrightFacade.playwrightSkill.description).toContain("MUST USE")
    expect(template).toStartWith("# Playwright Browser Automation")
    expect(template).not.toContain("---")
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

  test("#given agent-browser source markdown #when exposed through the split skill #then frontmatter is stripped and tool markers stay stable", async () => {
    // given
    const agentBrowserSkillFile = await Bun.file("packages/omo-opencode/src/features/builtin-skills/agent-browser/SKILL.md").text()
    const { data, hadFrontmatter } = parseFrontmatter<{ readonly name: string; readonly description: string }>(agentBrowserSkillFile)

    // when
    const skill = playwrightFacade.agentBrowserSkill

    // then
    expect(data.name).toBe("agent-browser")
    expect(data.description).toContain("browser interactions")
    expect(hadFrontmatter).toBe(true)
    expect(skill.name).toBe("agent-browser")
    expect(skill.allowedTools).toEqual(["Bash(agent-browser:*)"])
    expect(skill.template).toStartWith("# Browser Automation with agent-browser")
    expect(skill.template.startsWith("---\n")).toBe(false)
    expect(skill.template).toContain("AGENT_BROWSER_SESSION")
  })

  test("#given agent-browser prompt sections #when reading the split template #then critical browser workflow order is preserved", () => {
    // given
    const markers = [
      "# Browser Automation with agent-browser",
      "## Quick start",
      "## Core workflow",
      "## Commands",
      "### Navigation",
      "### Snapshot (page analysis)",
      "### Interactions (use @refs from snapshot)",
      "## Global Options",
      "## Example: Form submission",
      "## Sessions & Persistent Profiles",
      "## JSON output (for parsing)",
      "## Local files",
      "## CDP Mode",
      "## Cloud providers",
    ] as const

    // when
    const markerIndexes = orderedIndexes(playwrightFacade.agentBrowserSkill.template, markers)

    // then
    expect(markerIndexes.every((index) => index >= 0)).toBe(true)
    expect(markerIndexes).toEqual([...markerIndexes].sort((left, right) => left - right))
  })
})
