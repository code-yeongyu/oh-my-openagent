import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OhMyOpenCodeConfigSchema } from "../config"
import * as mcpLoader from "../features/claude-code-mcp-loader"
import * as skillLoader from "../features/opencode-skill-loader"
import * as opencodeConfigDir from "../shared/opencode-config-dir"
import { createSkillContext } from "./skill-context"

describe("createSkillContext", () => {
  const testDirectory = join(tmpdir(), `skill-context-test-${Date.now()}`)
  // Isolated "global" opencode config dir so the developer's real
  // ~/.config/opencode/opencode.jsonc never leaks into these tests.
  let mockGlobalConfigDir: string
  let getOpenCodeConfigDirSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    mkdirSync(testDirectory, { recursive: true })
    mockGlobalConfigDir = mkdtempSync(join(tmpdir(), "skill-context-global-"))
    getOpenCodeConfigDirSpy = spyOn(opencodeConfigDir, "getOpenCodeConfigDir").mockReturnValue(
      mockGlobalConfigDir,
    )
  })

  afterEach(() => {
    getOpenCodeConfigDirSpy.mockRestore()
    rmSync(testDirectory, { recursive: true, force: true })
    rmSync(mockGlobalConfigDir, { recursive: true, force: true })
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

  it("discovers skills from host opencode.jsonc skills.paths", async () => {
    // given - a host-config skill registered via opencode.jsonc skills.paths
    const hostSkillsDir = join(testDirectory, "host-skills")
    const hostSkillDir = join(hostSkillsDir, "host-skill")
    mkdirSync(hostSkillDir, { recursive: true })
    writeFileSync(
      join(hostSkillDir, "SKILL.md"),
      [
        "---",
        "name: host-skill",
        "description: Skill registered via host opencode.jsonc skills.paths",
        "---",
        "Host skill body.",
        "",
      ].join("\n"),
    )

    const opencodeDir = join(testDirectory, ".opencode")
    mkdirSync(opencodeDir, { recursive: true })
    writeFileSync(
      join(opencodeDir, "opencode.jsonc"),
      JSON.stringify({ skills: { paths: [hostSkillsDir] } }),
    )

    const discoverUserClaudeSkillsSpy = spyOn(
      skillLoader,
      "discoverUserClaudeSkills",
    ).mockResolvedValue([])
    const discoverProjectClaudeSkillsSpy = spyOn(
      skillLoader,
      "discoverProjectClaudeSkills",
    ).mockResolvedValue([])
    const discoverOpencodeGlobalSkillsSpy = spyOn(
      skillLoader,
      "discoverOpencodeGlobalSkills",
    ).mockResolvedValue([])
    const discoverOpencodeProjectSkillsSpy = spyOn(
      skillLoader,
      "discoverOpencodeProjectSkills",
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

    const pluginConfig = OhMyOpenCodeConfigSchema.parse({})

    try {
      // when
      const result = await createSkillContext({
        directory: testDirectory,
        pluginConfig,
      })

      // then
      expect(result.mergedSkills.some((skill) => skill.name === "host-skill")).toBe(true)
      expect(result.availableSkills.some((skill) => skill.name === "host-skill")).toBe(true)
    } finally {
      discoverUserClaudeSkillsSpy.mockRestore()
      discoverProjectClaudeSkillsSpy.mockRestore()
      discoverOpencodeGlobalSkillsSpy.mockRestore()
      discoverOpencodeProjectSkillsSpy.mockRestore()
      discoverProjectAgentsSkillsSpy.mockRestore()
      discoverGlobalAgentsSkillsSpy.mockRestore()
      getSystemMcpServerNamesSpy.mockRestore()
    }
  })

  it("excludes discovered dev-browser skill when browser provider is playwright", async () => {
    // given
    const discoveredDevBrowserSkill = {
      name: "dev-browser",
      definition: { description: "Discovered dev-browser skill" },
      scope: "user" as const,
    }

    const discoverConfigSourceSkillsSpy = spyOn(
      skillLoader,
      "discoverConfigSourceSkills",
    ).mockResolvedValue([])
    const discoverUserClaudeSkillsSpy = spyOn(
      skillLoader,
      "discoverUserClaudeSkills",
    ).mockResolvedValue([discoveredDevBrowserSkill])
    const discoverProjectClaudeSkillsSpy = spyOn(
      skillLoader,
      "discoverProjectClaudeSkills",
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
      browser_automation_engine: { provider: "playwright" },
    })

    try {
      // when
      const result = await createSkillContext({
        directory: testDirectory,
        pluginConfig,
      })

      // then
      expect(result.browserProvider).toBe("playwright")
      expect(result.mergedSkills.some((skill) => skill.name === "playwright")).toBe(true)
      expect(result.mergedSkills.some((skill) => skill.name === "dev-browser")).toBe(false)
      expect(result.availableSkills.some((skill) => skill.name === "dev-browser")).toBe(false)
    } finally {
      discoverConfigSourceSkillsSpy.mockRestore()
      discoverUserClaudeSkillsSpy.mockRestore()
      discoverProjectClaudeSkillsSpy.mockRestore()
      discoverOpencodeGlobalSkillsSpy.mockRestore()
      discoverProjectAgentsSkillsSpy.mockRestore()
      discoverGlobalAgentsSkillsSpy.mockRestore()
      getSystemMcpServerNamesSpy.mockRestore()
    }
  })

  it("prefers host-config skill when plugin-config declares the same name", async () => {
    // given - plugin-config "shared-skill" and host-config "shared-skill"
    // are both loaded with scope "config". Host should win because
    // opencode.jsonc is the user's source of truth.
    const pluginConfigSkill = {
      name: "shared-skill",
      definition: { description: "from plugin config" },
      scope: "config" as const,
    }
    const hostConfigSkill = {
      name: "shared-skill",
      definition: { description: "from host opencode.jsonc" },
      scope: "config" as const,
    }

    const discoverConfigSourceSkillsSpy = spyOn(skillLoader, "discoverConfigSourceSkills")
      .mockResolvedValueOnce([pluginConfigSkill]) // first call -> plugin config
      .mockResolvedValueOnce([hostConfigSkill]) // second call -> host config
    const discoverUserClaudeSkillsSpy = spyOn(
      skillLoader,
      "discoverUserClaudeSkills",
    ).mockResolvedValue([])
    const discoverProjectClaudeSkillsSpy = spyOn(
      skillLoader,
      "discoverProjectClaudeSkills",
    ).mockResolvedValue([])
    const discoverOpencodeGlobalSkillsSpy = spyOn(
      skillLoader,
      "discoverOpencodeGlobalSkills",
    ).mockResolvedValue([])
    const discoverOpencodeProjectSkillsSpy = spyOn(
      skillLoader,
      "discoverOpencodeProjectSkills",
    ).mockResolvedValue([])
    const discoverProjectAgentsSkillsSpy = spyOn(
      skillLoader,
      "discoverProjectAgentsSkills",
    ).mockResolvedValue([])
    const discoverGlobalAgentsSkillsSpy = spyOn(
      skillLoader,
      "discoverGlobalAgentsSkills",
    ).mockResolvedValue([])
    const readOpencodeConfigSkillsSpy = spyOn(
      skillLoader,
      "readOpencodeConfigSkills",
    ).mockReturnValue({ paths: ["/fake/host/skills"] })
    const getSystemMcpServerNamesSpy = spyOn(
      mcpLoader,
      "getSystemMcpServerNames",
    ).mockReturnValue(new Set<string>())

    const pluginConfig = OhMyOpenCodeConfigSchema.parse({})

    try {
      // when
      const result = await createSkillContext({
        directory: testDirectory,
        pluginConfig,
      })

      // then - the merged skill comes from host-config, not plugin-config
      const sharedSkill = result.mergedSkills.find((skill) => skill.name === "shared-skill")
      expect(sharedSkill).toBeDefined()
      expect(sharedSkill?.definition.description).toBe("from host opencode.jsonc")
    } finally {
      discoverConfigSourceSkillsSpy.mockRestore()
      discoverUserClaudeSkillsSpy.mockRestore()
      discoverProjectClaudeSkillsSpy.mockRestore()
      discoverOpencodeGlobalSkillsSpy.mockRestore()
      discoverOpencodeProjectSkillsSpy.mockRestore()
      discoverProjectAgentsSkillsSpy.mockRestore()
      discoverGlobalAgentsSkillsSpy.mockRestore()
      readOpencodeConfigSkillsSpy.mockRestore()
      getSystemMcpServerNamesSpy.mockRestore()
    }
  })
})
