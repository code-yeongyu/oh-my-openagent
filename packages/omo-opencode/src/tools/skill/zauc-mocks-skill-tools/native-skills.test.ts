/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import type { LoadedSkill } from "../../../features/opencode-skill-loader/types"
import { createMockSkill, createSkillTool, mockContext } from "./test-support"

describe("skill tool - nativeSkills integration", () => {
  it("includes native skills in the description even when skills are pre-seeded", async () => {
    const tool = createSkillTool({
      skills: [createMockSkill("seeded-skill")],
      includeSkillsInDescription: true,
      nativeSkills: {
        all() {
          return [{
            name: "native-visible-skill",
            description: "Native skill exposed from config",
            location: "/external/skills/native-visible-skill/SKILL.md",
            content: "Native visible skill body",
          }]
        },
        get() { return undefined },
        dirs() { return [] },
      },
    })

    expect(tool.description).toContain("seeded-skill")
    expect(tool.description).toContain("native-visible-skill")
    await tool.execute({ name: "native-visible-skill" }, mockContext)

    expect(tool.description).toContain("seeded-skill")
    expect(tool.description).toContain("native-visible-skill")
  })

  it("keeps OpenCode-injected native skills in the description after the shared/ prefix cutover", () => {
    const tool = createSkillTool({
      skills: [],
      includeSkillsInDescription: true,
      nativeSkills: {
        all() {
          return [
            {
              name: "opencode/customize-opencode",
              description: "Qualified OpenCode customize entry",
              location: "<built-in>",
              content: "Qualified customize body",
            },
            {
              name: "customize-opencode",
              description: "Customize OpenCode",
              location: "<built-in>",
              content: "Customize body",
            },
          ]
        },
        get() { return undefined },
        dirs() { return [] },
      },
    })

    const description = tool.description

    expect(description).toContain("<name>/customize-opencode</name>")
    expect(description).toContain("Customize OpenCode")
  })

  it("merges native skills exposed by PluginInput.skills.all()", async () => {
    const tool = createSkillTool({
      skills: [],
      nativeSkills: {
        async all() {
          return [{
            name: "external-plugin-skill",
            description: "Skill from config.skills.paths",
            location: "/external/skills/external-plugin-skill/SKILL.md",
            content: "External plugin skill body",
          }]
        },
        async get() { return undefined },
        async dirs() { return [] },
      },
    })

    const result = await tool.execute({ name: "external-plugin-skill" }, mockContext)

    expect(result).toContain("external-plugin-skill")
    expect(result).toContain("External plugin skill body")
  })

  it("does not reintroduce disabled native skills from PluginInput.skills.all()", async () => {
    const tool = createSkillTool({
      directory: "/test",
      skills: [],
      disabledSkills: new Set(["blocked-native-skill"]),
      includeSkillsInDescription: true,
      nativeSkills: {
        all() {
          return [{
            name: "blocked-native-skill",
            description: "Blocked native skill from config.skills.paths",
            location: "/external/skills/blocked-native-skill/SKILL.md",
            content: "BYPASS_CONFIRMED",
          }]
        },
        get() { return undefined },
        dirs() { return [] },
      },
    })

    expect(tool.description).not.toContain("blocked-native-skill")
    await expect(tool.execute({ name: "blocked-native-skill" }, mockContext)).rejects.toThrow(
      'Skill or command "blocked-native-skill" not found',
    )
  })
})
