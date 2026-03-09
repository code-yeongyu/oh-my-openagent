import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OhMyOpenCodeConfigSchema } from "../config"
import * as mcpLoader from "../features/claude-code-mcp-loader"
import * as skillLoader from "../features/opencode-skill-loader"
import { createSkillContext } from "./skill-context"

describe("createSkillContext", () => {
  const testDirectory = join(tmpdir(), `skill-context-test-${Date.now()}`)

  beforeEach(() => {
    mkdirSync(testDirectory, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDirectory, { recursive: true, force: true })
  })

  it("excludes discovered playwright skill when browser provider is agent-browser", async () => {
    // given
    const discoveredPlaywrightDir = join(testDirectory, ".claude", "skills", "playwright")
    mkdirSync(discoveredPlaywrightDir, { recursive: true })
    writeFileSync(
      join(discoveredPlaywrightDir, "SKILL.md"),
      [
        "---",
        "name: playwright",
        "description: Discovered playwright skill",
        "---",
        "Discovered playwright body.",
        "",
      ].join("\n"),
    )

    const discoverConfigSourceSkillsSpy = spyOn(
      skillLoader,
      "discoverConfigSourceSkills",
    ).mockResolvedValue([])
    const discoverUserClaudeSkillsSpy = spyOn(
      skillLoader,
      "discoverUserClaudeSkills",
    ).mockResolvedValue([])
    const discoverOpencodeGlobalSkillsSpy = spyOn(
      skillLoader,
      "discoverOpencodeGlobalSkills",
    ).mockResolvedValue([])
    const discoverProjectAgentsSkillsSpy = spyOn(
      skillLoader,
      "discoverProjectAgentsSkills",
    ).mockResolvedValue([])
    const discoverGlobalAgentsSkillsSpy = spyOn(
      skillLoader,
      "discoverGlobalAgentsSkills",
    ).mockResolvedValue([])
    const getSystemMcpServerNamesSpy = spyOn(
      mcpLoader,
      "getSystemMcpServerNames",
    ).mockReturnValue(new Set<string>())

    const pluginConfig = OhMyOpenCodeConfigSchema.parse({
      browser_automation_engine: { provider: "agent-browser" },
    })

    try {
      // when
      const result = await createSkillContext({
        directory: testDirectory,
        pluginConfig,
      })

      // then
      expect(result.browserProvider).toBe("agent-browser")
      expect(result.mergedSkills.some((skill) => skill.name === "agent-browser")).toBe(true)
      expect(result.mergedSkills.some((skill) => skill.name === "playwright")).toBe(false)
      expect(result.availableSkills.some((skill) => skill.name === "playwright")).toBe(false)
    } finally {
      discoverConfigSourceSkillsSpy.mockRestore()
      discoverUserClaudeSkillsSpy.mockRestore()
      discoverOpencodeGlobalSkillsSpy.mockRestore()
      discoverProjectAgentsSkillsSpy.mockRestore()
      discoverGlobalAgentsSkillsSpy.mockRestore()
      getSystemMcpServerNamesSpy.mockRestore()
    }
  })
})
