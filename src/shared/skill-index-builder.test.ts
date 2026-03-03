import { describe, expect, test } from "bun:test"
import { formatSkillLine, buildSkillIndex } from "./skill-index-builder"
import type { LoadedSkill } from "../features/opencode-skill-loader/types"

function makeSkill(overrides: Partial<LoadedSkill> = {}): LoadedSkill {
  return {
    name: "test-skill",
    scope: "project",
    definition: { description: "Does something useful" },
    ...overrides,
  } as unknown as LoadedSkill
}

describe("formatSkillLine", () => {
  describe("#given a basic skill", () => {
    test("#when no chains_to or memory_tags, #then produces standard line", () => {
      //#given
      const skill = makeSkill()

      //#when
      const line = formatSkillLine(skill)

      //#then
      expect(line).toBe("- test-skill (project): Does something useful")
      expect(line).not.toContain("chains to")
      expect(line).not.toContain("memory")
    })
  })

  describe("#given a skill with chains_to", () => {
    test("#when chainedTo is set, #then appends chains to suffix", () => {
      //#given
      const skill = makeSkill({ chainedTo: ["writing-plans", "git-master"] })

      //#when
      const line = formatSkillLine(skill)

      //#then
      expect(line).toContain("→ chains to: [writing-plans, git-master]")
    })

    test("#when chainedTo is empty array, #then no suffix", () => {
      //#given
      const skill = makeSkill({ chainedTo: [] })

      //#when
      const line = formatSkillLine(skill)

      //#then
      expect(line).not.toContain("chains to")
    })
  })

  describe("#given a skill with memory_tags", () => {
    test("#when memoryTags is set, #then appends memory suffix", () => {
      //#given
      const skill = makeSkill({ memoryTags: ["docker", "container"] })

      //#when
      const line = formatSkillLine(skill)

      //#then
      expect(line).toContain("(memory: docker, container)")
    })

    test("#when memoryTags is empty array, #then no suffix", () => {
      //#given
      const skill = makeSkill({ memoryTags: [] })

      //#when
      const line = formatSkillLine(skill)

      //#then
      expect(line).not.toContain("memory")
    })
  })

  describe("#given a skill with both fields", () => {
    test("#when both set, #then memory appears before chains", () => {
      //#given
      const skill = makeSkill({ memoryTags: ["git"], chainedTo: ["writing-plans"] })

      //#when
      const line = formatSkillLine(skill)

      //#then
      const memIdx = line.indexOf("(memory:")
      const chainIdx = line.indexOf("→ chains to:")
      expect(memIdx).toBeGreaterThan(-1)
      expect(chainIdx).toBeGreaterThan(memIdx)
    })
  })
})

describe("buildSkillIndex", () => {
  describe("#given skills with memory_tags", () => {
    test("#when compact format, #then memory tags shown in line", () => {
      //#given
      const skills = [makeSkill({ name: "docker-ops", memoryTags: ["docker", "compose"] })]

      //#when
      const index = buildSkillIndex(skills, "compact")

      //#then
      expect(index).toContain("(memory: docker, compose)")
    })

    test("#when enforcement format, #then 1% rule text present", () => {
      //#given
      const skills = [makeSkill({ chainedTo: ["git-master"] })]

      //#when
      const index = buildSkillIndex(skills, "enforcement")

      //#then
      expect(index).toContain("1% RULE")
      expect(index).toContain("→ chains to: [git-master]")
    })
  })
})
