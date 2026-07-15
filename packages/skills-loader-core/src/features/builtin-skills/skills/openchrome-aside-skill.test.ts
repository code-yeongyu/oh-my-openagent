/// <reference path="../../../../../../bun-test.d.ts" />

import { describe, expect, test } from "bun:test"
import { openchromeAsideSkill } from "./openchrome-aside-skill"

function orderedIndexes(source: string, markers: readonly string[]): readonly number[] {
  return markers.map((marker) => source.indexOf(marker))
}

describe("openchromeAsideSkill", () => {
  test("#given the tiered browser skill #when inspected #then it keeps the canonical playwright name and browser trigger", () => {
    // #then
    expect(openchromeAsideSkill.name).toBe("playwright")
    expect(openchromeAsideSkill.description).toContain("MUST USE")
    expect(openchromeAsideSkill.description.toLowerCase()).toContain("browser")
  })

  test("#given graceful-fallback requirement #when inspecting tooling #then allowedTools is omitted and only Playwright MCP is declared", () => {
    // #then - allowedTools omitted so the agent keeps Bash + Read + skill_mcp
    expect(openchromeAsideSkill.allowedTools).toBeUndefined()
    // only Playwright MCP is declared (always available via npx); aside/openchrome are Bash-driven
    expect(openchromeAsideSkill.mcpConfig?.playwright).toEqual({
      command: "npx",
      args: ["@playwright/mcp@latest"],
    })
    expect(openchromeAsideSkill.mcpConfig?.aside).toBeUndefined()
    expect(openchromeAsideSkill.mcpConfig?.openchrome).toBeUndefined()
  })

  test("#given the ask-first routing #when reading the template #then aside precedes openchrome precedes Playwright MCP fallback", () => {
    // #given
    const template = openchromeAsideSkill.template
    const markers = [
      "# Browser Automation",
      "### 1. aside",
      "### 2. openchrome",
      "### 3. Playwright MCP",
      "## Install",
    ] as const

    // #when
    const markerIndexes = orderedIndexes(template, markers)

    // #then - every tier present, strictly ordered aside -> openchrome -> playwright -> install
    expect(markerIndexes.every((index) => index >= 0)).toBe(true)
    expect(markerIndexes).toEqual([...markerIndexes].sort((left, right) => left - right))
  })

  test("#given detection + install guidance #when reading the template #then command detection, ask mode, CLI, fallback, and install hints are present", () => {
    // #given
    const template = openchromeAsideSkill.template

    // #then
    expect(template).toContain("command -v aside")
    expect(template).toContain("command -v openchrome")
    expect(template).toContain("command -v oc")
    expect(template).toContain('aside "')
    expect(template).toContain("oc navigate")
    expect(template).toContain("skill_mcp")
    expect(template).toContain("cdp_url")
    expect(template).toContain("9222")
    expect(template).toContain("curl -fsSL https://releases.aside.com/install.sh | bash")
    expect(template).toContain("npm install -g openchrome-mcp")
  })
})
