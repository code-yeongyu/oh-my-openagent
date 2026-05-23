/// <reference types="bun-types" />

import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createSkillTool } from "./tools"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"

function requireFresh<T>(modulePath: string): T {
  const resolvedPath = require.resolve(modulePath)
  if (require.cache?.[resolvedPath]) {
    delete require.cache[resolvedPath]
  }
  return require(modulePath) as T
}

function createFreshSkillTool(...args: Parameters<typeof import("./tools").createSkillTool>): ReturnType<typeof import("./tools").createSkillTool> {
  return requireFresh<typeof import("./tools")>("./tools").createSkillTool(...args)
}

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

    await new Promise<void>((resolve) => setTimeout(resolve, 50))
  }

  throw new Error("Timed out waiting for async skill description refresh")
}

describe("skill tool - async native skill description refresh", () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "skill-async-test-"))
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it("updates description after async native skills resolve", async () => {
    //#given
    let allCallCount = 0
    const tool = createFreshSkillTool({
      directory: testDir,
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
