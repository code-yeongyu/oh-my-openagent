/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"
import * as skillContent from "../../features/opencode-skill-loader/skill-content"
import * as commandDiscovery from "../slashcommand/command-discovery"
import { createSkillTool } from "./tools"

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
const mockContext: ToolContext = {
  sessionID: "test-session",
  messageID: "msg-1",
  agent: "test-agent",
  directory: "/test",
  worktree: "/test",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

beforeEach(() => {
  mock.restore()
  spyOn(commandDiscovery, "discoverCommandsSync").mockImplementation(discoverCommandsSync)
  spyOn(skillContent, "getAllSkills").mockImplementation(getAllSkills)
  spyOn(skillContent, "clearSkillCache").mockImplementation(clearSkillCache)
})

afterEach(async () => {
  await flushMicrotasks()
  mock.restore()
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

		await skillTool.execute({ name: "lazy-skill" }, mockContext)

    expect(getAllSkills.mock.calls.length).toBe(baselineGetAllSkillsCalls + 1)
  })

  it("does not clear the shared skill cache during description or execute refresh", async () => {
    // given
    const baselineClearSkillCacheCalls = clearSkillCache.mock.calls.length

    // when
    const skillTool = createSkillTool({})
    void skillTool.description
    await flushMicrotasks()
		await skillTool.execute({ name: "lazy-skill" }, mockContext)

    // then
    expect(clearSkillCache.mock.calls.length).toBe(baselineClearSkillCacheCalls)
  })
})
