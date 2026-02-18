/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type { BackgroundManager } from "../../features/background-agent"
import type { BackgroundTask } from "../../features/background-agent/types"
import { createAthenaCouncilTool } from "./tools"
import { filterCouncilMembers } from "./tool-helpers"

const mockManager = {
  getTask: () => undefined,
  launch: async () => {
    throw new Error("launch should not be called in config validation tests")
  },
} as unknown as BackgroundManager

const mockToolContext = {
  sessionID: "session-1",
  messageID: "message-1",
  agent: "athena",
  abort: new AbortController().signal,
}

const configuredMembers = [
  { name: "Claude", model: "anthropic/claude-sonnet-4-5" },
  { name: "GPT", model: "openai/gpt-5.3-codex" },
  { model: "google/gemini-3-pro" },
]

function createRunningTask(id: string, sessionID = `ses-${id}`): BackgroundTask {
  return {
    id,
    parentSessionID: "session-1",
    parentMessageID: "message-1",
    description: `Council member task ${id}`,
    prompt: "prompt",
    agent: "council-member",
    status: "running",
    sessionID,
  }
}

describe("filterCouncilMembers", () => {
  test("returns selection error when selection is undefined", () => {
    const result = filterCouncilMembers(configuredMembers, undefined)
    expect(result.members).toEqual([])
    expect(result.error).toBe(
      "athena_council runs one member per call. Pass exactly one member in members (single-item array). Available members: Claude, GPT, google/gemini-3-pro."
    )
  })

  test("returns selection error when selection is empty", () => {
    const result = filterCouncilMembers(configuredMembers, [])
    expect(result.members).toEqual([])
    expect(result.error).toBe(
      "athena_council runs one member per call. Pass exactly one member in members (single-item array). Available members: Claude, GPT, google/gemini-3-pro."
    )
  })

  test("filters members using case-insensitive name and model matching", () => {
    const result = filterCouncilMembers(configuredMembers, ["gpt", "GOOGLE/GEMINI-3-PRO"])
    expect(result.members).toEqual([configuredMembers[1], configuredMembers[2]])
    expect(result.error).toBeUndefined()
  })

  test("returns helpful error when selected members are not configured", () => {
    const result = filterCouncilMembers(configuredMembers, ["mistral", "xai/grok-3"])
    expect(result.members).toEqual([])
    expect(result.error).toBe(
      "Unknown council members: mistral, xai/grok-3. Available: Claude (anthropic/claude-sonnet-4-5), GPT (openai/gpt-5.3-codex), google/gemini-3-pro."
    )
  })

  test("deduplicates when same member is selected by both name and model", () => {
    const result = filterCouncilMembers(configuredMembers, ["Claude", "anthropic/claude-sonnet-4-5"])
    expect(result.members).toEqual([configuredMembers[0]])
    expect(result.error).toBeUndefined()
  })
})

describe("createAthenaCouncilTool", () => {
  test("returns error when councilConfig is undefined", async () => {
    const athenaCouncilTool = createAthenaCouncilTool({
      backgroundManager: mockManager,
      councilConfig: undefined,
    })

    const result = await athenaCouncilTool.execute({ question: "How should we proceed?" }, mockToolContext)

    expect(result).toBe("Athena council is not configured. Add council members to agents.athena.council.members in .opencode/oh-my-opencode.jsonc.")
  })

  test("returns error when councilConfig has empty members", async () => {
    const athenaCouncilTool = createAthenaCouncilTool({
      backgroundManager: mockManager,
      councilConfig: { members: [] },
    })

    const result = await athenaCouncilTool.execute({ question: "Any concerns?" }, mockToolContext)

    expect(result).toBe("Athena council is not configured. Add council members to agents.athena.council.members in .opencode/oh-my-opencode.jsonc.")
  })

  test("returns helpful error when members contains invalid names", async () => {
    const athenaCouncilTool = createAthenaCouncilTool({
      backgroundManager: mockManager,
      councilConfig: { members: configuredMembers },
    })

    const result = await athenaCouncilTool.execute(
      { question: "Who should investigate this?", members: ["unknown-model"] },
      mockToolContext
    )

    expect(result).toBe("Unknown council members: unknown-model. Available: Claude (anthropic/claude-sonnet-4-5), GPT (openai/gpt-5.3-codex), google/gemini-3-pro.")
  })

  test("returns selection error when members are omitted", async () => {
    const athenaCouncilTool = createAthenaCouncilTool({
      backgroundManager: mockManager,
      councilConfig: { members: configuredMembers },
    })

    const result = await athenaCouncilTool.execute({ question: "How should we proceed?" }, mockToolContext)

    expect(result).toBe(
      "athena_council runs one member per call. Pass exactly one member in members (single-item array). Available members: Claude, GPT, google/gemini-3-pro."
    )
  })

  test("returns selection error when multiple members are provided", async () => {
    const athenaCouncilTool = createAthenaCouncilTool({
      backgroundManager: mockManager,
      councilConfig: { members: configuredMembers },
    })

    const result = await athenaCouncilTool.execute(
      { question: "How should we proceed?", members: ["Claude", "GPT"] },
      mockToolContext
    )

    expect(result).toBe(
      "athena_council runs one member per call. Pass exactly one member in members (single-item array). Available members: Claude, GPT, google/gemini-3-pro."
    )
  })

  test("launches selected member and returns background task metadata", async () => {
    let launchCount = 0
    const taskStore = new Map<string, BackgroundTask>()
    const launchManager = {
      launch: async () => {
        launchCount += 1
        const task = createRunningTask(`bg-${launchCount}`)
        taskStore.set(task.id, task)
        return task
      },
      getTask: (id: string) => taskStore.get(id),
    } as unknown as BackgroundManager

    const athenaCouncilTool = createAthenaCouncilTool({
      backgroundManager: launchManager,
      councilConfig: { members: configuredMembers },
    })

    const result = await athenaCouncilTool.execute(
      { question: "Who should investigate this?", members: ["GPT"] },
      mockToolContext
    )

    expect(launchCount).toBe(1)
    expect(result).toContain("Council member launched in background.")
    expect(result).toContain("Task ID: bg-1")
    expect(result).toContain("Session ID: ses-bg-1")
    expect(result).toContain("Member: GPT")
    expect(result).toContain("Model: openai/gpt-5.3-codex")
    expect(result).toContain("Status: running")
    expect(result).toContain("background_output")
    expect(result).toContain("task_id=\"bg-1\"")
    expect(result).toContain("<task_metadata>")
    expect(result).toContain("session_id: ses-bg-1")
  })

  test("returns launch failure details when selected member fails", async () => {
    const launchManager = {
      launch: async () => {
        throw new Error("provider outage")
      },
      getTask: () => undefined,
    } as unknown as BackgroundManager

    const athenaCouncilTool = createAthenaCouncilTool({
      backgroundManager: launchManager,
      councilConfig: { members: configuredMembers },
    })

    const result = await athenaCouncilTool.execute(
      { question: "Any concerns?", members: ["GPT"] },
      mockToolContext
    )

    expect(result).toContain("Failed to launch council member.")
    expect(result).toContain("### Launch Failures")
    expect(result).toContain("**GPT**")
    expect(result).toContain("provider outage")
  })
})
