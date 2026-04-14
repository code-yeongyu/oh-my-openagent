declare const require: (name: string) => unknown
const { describe, test, expect, afterEach } = require("bun:test") as {
  describe: (name: string, fn: () => void) => void
  test: (name: string, fn: () => void) => void
  afterEach: (fn: () => void) => void
  expect: (value: unknown) => {
    toBe: (expected: unknown) => void
    toBeLessThanOrEqual: (expected: number) => void
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
import { estimateTokenCount } from "./token-limiter"
import type { AvailableSkill, AvailableCategory } from "../../agents/dynamic-agent-prompt-builder"
import {
  _resetMemCacheForTesting,
  writeProviderModelsCache,
} from "../../shared/connected-providers-cache"

describe("prompt-builder", () => {
  afterEach(() => {
    _resetMemCacheForTesting()
  })

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
          { name: "code-review", description: "Review code quality", location: "project" },
        ]

        // when
        const result = buildSystemContent({
          agentName: "explore",
          availableSkills,
        })

        // then
        expect(result).toBeDefined()
        expect(result).toContain("code-review")
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

      test("#when model has a 16k context window #then examples are trimmed before required instructions", () => {
        // given
        writeProviderModelsCache({
          connected: ["ollama"],
          models: {
            ollama: [{ id: "qwen2.5:14b", context: 16_384 }],
          },
        })

        const result = buildSystemContent({
          agentName: "sisyphus-junior",
          model: { providerID: "ollama", modelID: "qwen2.5:14b" },
          agentsContext: [
            "MANDATORY: Keep this instruction.",
            Array.from({ length: 2000 }, () => [
              "Example walkthrough:",
              "```typescript",
              "task(subagent_type=\"explore\", run_in_background=true)",
              "```",
              "WRONG: do the slow thing",
            ].join("\n")).join("\n\n"),
          ].join("\n\n"),
        })

        // then
        expect(result).toBeDefined()
        expect(result).toContain("MANDATORY: Keep this instruction.")
        expect(estimateTokenCount(result ?? "")).toBeLessThanOrEqual(8_192)
      })
    })
  })
})
