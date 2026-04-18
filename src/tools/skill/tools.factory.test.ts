/// <reference types="bun-types" />

import { afterEach, describe, expect, it, mock } from "bun:test"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"

function createMockSkill(name: string): LoadedSkill {
  return {
    name,
    definition: {
      name,
      description: `Test skill ${name}`,
      template: `Test skill template for ${name}`,
    },
    scope: "config",
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

const loadedSkill = createMockSkill("lazy-skill")
const discoverCommandsSync = mock(() => [])
const getAllSkills = mock(async () => [loadedSkill])
const clearSkillCache = mock(() => {})

const skillContentModuleFactory = () => ({
  clearSkillCache,
  getAllSkills,
  extractSkillTemplate: () => loadedSkill.definition.template ?? "",
  injectGitMasterConfig: (body: string) => body,
})
const commandDiscoveryModuleFactory = () => ({
  discoverCommandsSync,
})

mock.module("../../features/opencode-skill-loader/skill-content", skillContentModuleFactory)
mock.module("../../features/opencode-skill-loader/skill-content.ts", skillContentModuleFactory)
mock.module("../slashcommand/command-discovery", commandDiscoveryModuleFactory)
mock.module("../slashcommand/command-discovery.ts", commandDiscoveryModuleFactory)

const { createSkillTool } = await import("./tools")

afterEach(async () => {
  await flushMicrotasks()
})

describe("createSkillTool", () => {
  it("delays command discovery until the description getter is accessed", async () => {
    // given
    const baselineDiscoverCommandsSyncCalls = discoverCommandsSync.mock.calls.length

    // when
    const skillTool = createSkillTool({})

    // then
    expect(discoverCommandsSync.mock.calls.length).toBe(baselineDiscoverCommandsSyncCalls)

    void skillTool.description
    await flushMicrotasks()

    expect(discoverCommandsSync.mock.calls.length).toBe(baselineDiscoverCommandsSyncCalls + 1)
  })

  it("delays skill loading until execute is invoked", async () => {
    // given
    const baselineGetAllSkillsCalls = getAllSkills.mock.calls.length

    // when
    const skillTool = createSkillTool({})

    // then
    expect(getAllSkills.mock.calls.length).toBe(baselineGetAllSkillsCalls)

    await skillTool.execute({ name: "lazy-skill" })

    expect(getAllSkills.mock.calls.length).toBe(baselineGetAllSkillsCalls + 1)
  })

  it("does not clear the shared skill cache during description or execute refresh", async () => {
    // given
    const baselineClearSkillCacheCalls = clearSkillCache.mock.calls.length

    // when
    const skillTool = createSkillTool({})
    void skillTool.description
    await flushMicrotasks()
    await skillTool.execute({ name: "lazy-skill" })

    // then
    expect(clearSkillCache.mock.calls.length).toBe(baselineClearSkillCacheCalls)
  })
})
