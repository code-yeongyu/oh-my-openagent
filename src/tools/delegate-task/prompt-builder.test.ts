declare const require: (name: string) => unknown
const { describe, test, expect } = require("bun:test") as {
  describe: (name: string, fn: () => void) => void
  test: (name: string, fn: () => void) => void
  expect: (value: unknown) => {
    toBe: (expected: unknown) => void
    toContain: (expected: string) => void
    toBeUndefined: () => void
    toBeDefined: () => void
    not: {
      toContain: (expected: string) => void
      toBeUndefined: () => void
    }
  }
}

import { buildSystemContent } from "./prompt-builder"
import type { AvailableSkill, AvailableCategory } from "../../agents/dynamic-agent-prompt-builder"

describe("prompt-builder", () => {
  describe("buildSystemContent", () => {
    describe("#given non-plan agent with availableSkills", () => {
      test("#when availableSkills contains project-level skills #then system content includes available_skills section", () => {
        // given
        const availableSkills: AvailableSkill[] = [
          { name: "git-master", description: "Git workflow automation", location: "plugin" },
          { name: "my-project-skill", description: "Project-specific deployment", location: "project" },
        ]
        const availableCategories: AvailableCategory[] = [
          { name: "quick", description: "Trivial tasks", model: "openai/gpt-5.4-mini" },
        ]

        // when
        const result = buildSystemContent({
          agentName: "sisyphus-junior",
          availableSkills,
          availableCategories,
        })

        // then
        expect(result).toBeDefined()
        expect(result).toContain("my-project-skill")
        expect(result).toContain("git-master")
      })

      test("#when agent is explore #then system content includes available_skills section", () => {
        // given
        const availableSkills: AvailableSkill[] = [
          { name: "review-work", description: "Review code quality", location: "project" },
        ]

        // when
        const result = buildSystemContent({
          agentName: "explore",
          availableSkills,
        })

        // then
        expect(result).toBeDefined()
        expect(result).toContain("review-work")
      })

      test("#when availableSkills is empty #then system content does not include available_skills section", () => {
        // given
        const availableSkills: AvailableSkill[] = []

        // when
        const result = buildSystemContent({
          agentName: "sisyphus-junior",
          availableSkills,
          categoryPromptAppend: "some category context",
        })

        // then
        expect(result).toBeDefined()
        expect(result).not.toContain("available_skills")
      })
    })

    describe("#given plan agent with availableSkills", () => {
      test("#when availableSkills provided #then system content includes plan agent prepend with skills", () => {
        // given
        const availableSkills: AvailableSkill[] = [
          { name: "git-master", description: "Git workflow automation", location: "plugin" },
        ]
        const availableCategories: AvailableCategory[] = [
          { name: "quick", description: "Trivial tasks", model: "openai/gpt-5.4-mini" },
        ]

        // when
        const result = buildSystemContent({
          agentName: "plan",
          availableSkills,
          availableCategories,
        })

        // then
        expect(result).toBeDefined()
        expect(result).toContain("git-master")
        expect(result).toContain("AVAILABLE SKILLS")
      })
    })

    describe("#given non-plan agent with agentsContext override", () => {
      test("#when agentsContext is provided #then it takes precedence and skills section is appended", () => {
        // given
        const availableSkills: AvailableSkill[] = [
          { name: "deploy-skill", description: "Deployment automation", location: "project" },
        ]

        // when
        const result = buildSystemContent({
          agentName: "sisyphus-junior",
          agentsContext: "Custom agent context here",
          availableSkills,
        })

        // then
        expect(result).toBeDefined()
        expect(result).toContain("Custom agent context here")
        expect(result).toContain("deploy-skill")
      })
    })
  })
})

describe("buildSystemContent — nativeSkillInfos merging", () => {
  test("#given a nativeSkill name not in availableSkills #when block is built #then native name appears", () => {
    // given
    const availableSkills: AvailableSkill[] = [
      { name: "omo-skill", description: "From OMO disk", location: "project" },
    ]
    const nativeSkillInfos = [
      { name: "test-driven-development", description: "TDD discipline", location: "/fake/SKILL.md" },
    ]

    // when
    const result = buildSystemContent({
      agentName: "explore",
      availableSkills,
      nativeSkillInfos,
    })

    // then
    expect(result).toBeDefined()
    expect(result).toContain("omo-skill")
    expect(result).toContain("test-driven-development")
    expect(result).toContain("TDD discipline")
  })

  test("#given a name in BOTH availableSkills AND nativeSkillInfos #when block is built #then OMO description wins", () => {
    // given
    const availableSkills: AvailableSkill[] = [
      { name: "shared", description: "omo-version-of-shared", location: "project" },
    ]
    const nativeSkillInfos = [
      { name: "shared", description: "native-version-of-shared", location: "/fake/SKILL.md" },
    ]

    // when
    const result = buildSystemContent({
      agentName: "explore",
      availableSkills,
      nativeSkillInfos,
    })

    // then
    expect(result).toBeDefined()
    expect(result).toContain("omo-version-of-shared")
    expect(result).not.toContain("native-version-of-shared")
  })

  test("#given empty availableSkills and a nativeSkillInfo #when block is built #then native skill renders", () => {
    // given
    const nativeSkillInfos = [
      { name: "brainstorming", description: "Use before any creative work", location: "/fake/SKILL.md" },
    ]

    // when
    const result = buildSystemContent({
      agentName: "explore",
      availableSkills: [],
      nativeSkillInfos,
    })

    // then
    expect(result).toBeDefined()
    expect(result).toContain("brainstorming")
  })
})
