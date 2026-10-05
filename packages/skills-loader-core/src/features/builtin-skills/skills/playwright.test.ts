/// <reference path="../../../../../../bun-test.d.ts" />

import { describe, expect, test } from "bun:test"
import { createBuiltinSkills } from "../skills"
import * as playwrightFacade from "./playwright"
import { createPlaywrightSkill, playwrightSkill as directPlaywrightSkill } from "./playwright-mcp-skill"

describe("playwright browser skill facade", () => {
  test("#given split browser skill modules #when importing through the facade #then it preserves exported skill identity", () => {
    // given
    const expectedExports = ["createPlaywrightSkill", "playwrightSkill"]

    // when
    const exportNames = Object.keys(playwrightFacade).sort()

    // then
    expect(exportNames).toEqual(expectedExports)
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

  test("#given absent or empty custom args #when creating builtin skills #then the legacy singleton is reused", () => {
    // given - default options and an explicitly empty override

    // when
    const defaultSkill = createBuiltinSkills().find((skill) => skill.name === "playwright")
    const emptyArgsSkill = createBuiltinSkills({
      browserProvider: "playwright",
      playwrightMcpArgs: [],
    }).find((skill) => skill.name === "playwright")

    // then
    expect(defaultSkill).toBe(directPlaywrightSkill)
    expect(emptyArgsSkill).toBe(directPlaywrightSkill)
  })

  test("#given custom MCP args with alternate providers #when creating builtin skills #then the option is ignored", () => {
    for (const browserProvider of ["playwright-cli", "dev-browser"] as const) {
      // when
      const skills = createBuiltinSkills({ browserProvider, playwrightMcpArgs: ["--headless"] })
      const browserSkill = skills.find((skill) =>
        ["playwright", "dev-browser"].includes(skill.name),
      )

      // then
      expect(browserSkill?.mcpConfig).toBeUndefined()
    }
  })

})
