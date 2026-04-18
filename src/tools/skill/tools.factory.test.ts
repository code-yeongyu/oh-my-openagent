/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"
import * as skillContent from "../../features/opencode-skill-loader/skill-content"

const discoverCommandsSync = mock(() => [])

mock.module("../slashcommand/command-discovery", () => ({
  discoverCommandsSync,
}))

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

function createMockContext(sessionID: string): ToolContext {
  return {
    ...mockContext,
    sessionID,
  }
}

beforeEach(() => {
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
    const { createSkillTool } = await import("./tools")
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
    const { createSkillTool } = await import("./tools")
    const skillTool = createSkillTool({})

    // then
    expect(getAllSkills.mock.calls.length).toBe(baselineGetAllSkillsCalls)

		await skillTool.execute({ name: "lazy-skill" }, mockContext)

    expect(getAllSkills.mock.calls.length).toBe(baselineGetAllSkillsCalls + 1)
  })

  it("clears the shared skill cache once on first execute in a session", async () => {
    // given
    const baselineClearSkillCacheCalls = clearSkillCache.mock.calls.length
    const sessionContext = createMockContext("session-clear-once")

    // when
    const { createSkillTool } = await import("./tools")
    const skillTool = createSkillTool({})
    void skillTool.description
    await flushMicrotasks()
    await skillTool.execute({ name: "lazy-skill" }, sessionContext)
    await skillTool.execute({ name: "lazy-skill" }, sessionContext)

    // then
    expect(clearSkillCache.mock.calls.length).toBe(baselineClearSkillCacheCalls + 1)
  })

  it("clears the skill discovery cache once per session", async () => {
    // given
    const baselineClearSkillCacheCalls = clearSkillCache.mock.calls.length
    const baselineGetAllSkillsCalls = getAllSkills.mock.calls.length
    const sessionAContext = createMockContext("session-a")
    const sessionBContext = createMockContext("session-b")
    const { createSkillTool } = await import("./tools")
    const skillTool = createSkillTool({})

    // when
    await skillTool.execute({ name: "lazy-skill" }, sessionAContext)
    await skillTool.execute({ name: "lazy-skill" }, sessionAContext)
    await skillTool.execute({ name: "lazy-skill" }, sessionBContext)
    await skillTool.execute({ name: "lazy-skill" }, sessionBContext)

    // then
    expect(clearSkillCache.mock.calls.length).toBe(baselineClearSkillCacheCalls + 2)
    expect(getAllSkills.mock.calls.length).toBe(baselineGetAllSkillsCalls + 4)
  })
})
