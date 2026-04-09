/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { createSkillTool } from "./tools"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"

function createMockSkill(name: string): LoadedSkill {
  return {
    name,
    path: `/test/skills/${name}/SKILL.md`,
    resolvedPath: `/test/skills/${name}`,
    definition: {
      name,
      description: `Test skill ${name}`,
      template: `Test skill template for ${name}`,
    },
    scope: "opencode-project",
  }
}

async function waitForRefresh(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) {
      return
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }

  throw new Error("Timed out waiting for async skill description refresh")
}

describe("skill tool - async native skill description refresh", () => {
  it("updates description after async native skills resolve", async () => {
    //#given
    let allCallCount = 0
    const tool = createSkillTool({
      skills: [createMockSkill("seeded-skill")],
      commands: [],
      nativeSkills: {
        async all() {
          allCallCount += 1

          return [{
            name: "async-native-skill",
            description: "Async native skill from plugin input",
            location: "/external/skills/async-native-skill/SKILL.md",
            content: "Async native skill body",
          }]
        },
        async get() {
          return undefined
        },
        async dirs() {
          return []
        },
      },
    })

    expect(tool.description).toContain("seeded-skill")
    expect(tool.description).not.toContain("async-native-skill")

    //#when
    await waitForRefresh(() => tool.description.includes("async-native-skill"))

    //#then
    expect(allCallCount).toBeGreaterThanOrEqual(1)
    expect(tool.description).toContain("seeded-skill")
    expect(tool.description).toContain("async-native-skill")
  })
})
