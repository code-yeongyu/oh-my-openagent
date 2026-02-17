/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type { BackgroundManager } from "../../features/background-agent"
import type { BackgroundTask } from "../../features/background-agent/types"
import type { BackgroundOutputClient } from "../background-task/clients"
import { createAthenaCouncilTool, filterCouncilMembers } from "./tools"

const mockClient = {
  session: {
    messages: async () => ({
      data: [{
        id: "msg-1",
        info: { role: "assistant" },
        parts: [{ type: "text", text: "Test analysis result" }],
      }],
    }),
  },
} as unknown as BackgroundOutputClient

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

function createCompletedTask(id: string): BackgroundTask {
  return {
    id,
    parentSessionID: "session-1",
    parentMessageID: "message-1",
    description: `Council member task ${id}`,
    prompt: "prompt",
    agent: "council-member",
    status: "completed",
    sessionID: `ses-${id}`,
  }
}

describe("filterCouncilMembers", () => {
  test("returns all members when selection is undefined", () => {
    // #given
    const selectedMembers = undefined

    // #when
    const result = filterCouncilMembers(configuredMembers, selectedMembers)

    // #then
    expect(result.members).toEqual(configuredMembers)
    expect(result.error).toBeUndefined()
  })

  test("returns all members when selection is empty", () => {
    // #given
    const selectedMembers: string[] = []

    // #when
    const result = filterCouncilMembers(configuredMembers, selectedMembers)

    // #then
    expect(result.members).toEqual(configuredMembers)
    expect(result.error).toBeUndefined()
  })

  test("filters members using case-insensitive name and model matching", () => {
    // #given
    const selectedMembers = ["gpt", "GOOGLE/GEMINI-3-PRO"]

    // #when
    const result = filterCouncilMembers(configuredMembers, selectedMembers)

    // #then
    expect(result.members).toEqual([configuredMembers[1], configuredMembers[2]])
    expect(result.error).toBeUndefined()
  })

  test("returns helpful error when selected members are not configured", () => {
    // #given
    const selectedMembers = ["mistral", "xai/grok-3"]

    // #when
    const result = filterCouncilMembers(configuredMembers, selectedMembers)

    // #then
    expect(result.members).toEqual([])
    expect(result.error).toBe(
      "Unknown council members: mistral, xai/grok-3. Available members: Claude, GPT, google/gemini-3-pro."
    )
  })

  test("selects named member by model ID when name differs from model", () => {
    // #given - "Claude" has name "Claude" but model "anthropic/claude-sonnet-4-5"
    const selectedMembers = ["anthropic/claude-sonnet-4-5"]

    // #when
    const result = filterCouncilMembers(configuredMembers, selectedMembers)

    // #then - should find the member by model ID even though it has a custom name
    expect(result.members).toEqual([configuredMembers[0]])
    expect(result.error).toBeUndefined()
  })

  test("deduplicates when same member is selected by both name and model", () => {
    // #given
    const selectedMembers = ["Claude", "anthropic/claude-sonnet-4-5"]

    // #when
    const result = filterCouncilMembers(configuredMembers, selectedMembers)

    // #then - should return only one copy
    expect(result.members).toEqual([configuredMembers[0]])
    expect(result.error).toBeUndefined()
  })

  test("returns error listing only unmatched names when partially matched", () => {
    // #given
    const selectedMembers = ["claude", "non-existent"]

    // #when
    const result = filterCouncilMembers(configuredMembers, selectedMembers)

    // #then
    expect(result.members).toEqual([])
    expect(result.error).toBe(
      "Unknown council members: non-existent. Available members: Claude, GPT, google/gemini-3-pro."
    )
  })
})

describe("createAthenaCouncilTool", () => {
  test("returns error when councilConfig is undefined", async () => {
    // #given
    const athenaCouncilTool = createAthenaCouncilTool({
      backgroundManager: mockManager,
      councilConfig: undefined,
      client: mockClient,
    })

    // #when
    const result = await athenaCouncilTool.execute({ question: "How should we proceed?" }, mockToolContext)

    // #then
    expect(result).toBe("Athena council not configured. Add agents.athena.council.members to your config.")
  })

  test("returns error when councilConfig has empty members", async () => {
    // #given
    const athenaCouncilTool = createAthenaCouncilTool({
      backgroundManager: mockManager,
      councilConfig: { members: [] },
      client: mockClient,
    })

    // #when
    const result = await athenaCouncilTool.execute({ question: "Any concerns?" }, mockToolContext)

    // #then
    expect(result).toBe("Athena council not configured. Add agents.athena.council.members to your config.")
  })

  test("uses expected description and question arg schema", () => {
    // #given
    const athenaCouncilTool = createAthenaCouncilTool({
      backgroundManager: mockManager,
      councilConfig: { members: [{ model: "openai/gpt-5.3-codex" }] },
      client: mockClient,
    })

    // #then - description should be dynamic and include the member model
    expect(athenaCouncilTool.description).toContain("openai/gpt-5.3-codex")
    expect(athenaCouncilTool.description).toContain("Available council members:")
    expect((athenaCouncilTool as { args: Record<string, unknown> }).args.question).toBeDefined()
    expect((athenaCouncilTool as { args: Record<string, unknown> }).args.members).toBeDefined()
  })

  test("returns helpful error when members contains invalid names", async () => {
    // #given
    const athenaCouncilTool = createAthenaCouncilTool({
      backgroundManager: mockManager,
      councilConfig: { members: configuredMembers },
      client: mockClient,
    })
    const toolArgs = {
      question: "Who should investigate this?",
      members: ["unknown-model"],
    }

    // #when
    const result = await athenaCouncilTool.execute(toolArgs, mockToolContext)

    // #then
    expect(result).toBe("Unknown council members: unknown-model. Available members: Claude, GPT, google/gemini-3-pro.")
  })

  test("returns collected markdown results for all configured council members", async () => {
    // #given
    let launchCount = 0
    const taskStore = new Map<string, BackgroundTask>()
    const launchManager = {
      launch: async () => {
        launchCount += 1
        const task = createCompletedTask(`bg-${launchCount}`)
        taskStore.set(task.id, task)
        return task
      },
      getTask: (id: string) => taskStore.get(id),
    } as unknown as BackgroundManager
    const athenaCouncilTool = createAthenaCouncilTool({
      backgroundManager: launchManager,
      councilConfig: { members: configuredMembers },
      client: mockClient,
    })

    // #when
    const result = await athenaCouncilTool.execute({ question: "How should we proceed?" }, mockToolContext)

    // #then - returns markdown with council results, one section per member
    expect(result).toContain("## Council Results")
    expect(result).toContain("How should we proceed?")
    expect(result).toContain("### Claude (anthropic/claude-sonnet-4-5)")
    expect(result).toContain("### GPT (openai/gpt-5.3-codex)")
    expect(result).toContain("### google/gemini-3-pro (google/gemini-3-pro)")
    expect(result).toContain("Test analysis result")
  })

  test("returns collected results only for selected members", async () => {
    // #given
    let launchCount = 0
    const taskStore = new Map<string, BackgroundTask>()
    const launchManager = {
      launch: async () => {
        launchCount += 1
        const task = createCompletedTask(`bg-${launchCount}`)
        taskStore.set(task.id, task)
        return task
      },
      getTask: (id: string) => taskStore.get(id),
    } as unknown as BackgroundManager
    const athenaCouncilTool = createAthenaCouncilTool({
      backgroundManager: launchManager,
      councilConfig: { members: configuredMembers },
      client: mockClient,
    })

    // #when
    const result = await athenaCouncilTool.execute(
      {
        question: "Who should investigate this?",
        members: ["GPT", "google/gemini-3-pro"],
      },
      mockToolContext
    )

    // #then - only selected members appear in output
    expect(result).toContain("### GPT (openai/gpt-5.3-codex)")
    expect(result).toContain("### google/gemini-3-pro (google/gemini-3-pro)")
    expect(result).not.toContain("### Claude")
    expect(launchCount).toBe(2)
  })

  test("includes launch failures alongside successful member results", async () => {
    // #given
    let launchCount = 0
    const taskStore = new Map<string, BackgroundTask>()
    const launchManager = {
      launch: async () => {
        launchCount += 1
        if (launchCount === 2) {
          throw new Error("provider outage")
        }
        const task = createCompletedTask(`bg-${launchCount}`)
        taskStore.set(task.id, task)
        return task
      },
      getTask: (id: string) => taskStore.get(id),
    } as unknown as BackgroundManager
    const athenaCouncilTool = createAthenaCouncilTool({
      backgroundManager: launchManager,
      councilConfig: { members: configuredMembers },
      client: mockClient,
    })

    // #when
    const result = await athenaCouncilTool.execute({ question: "Any concerns?" }, mockToolContext)

    // #then - successful members have results, failed member listed in failures section
    expect(result).toContain("### Claude (anthropic/claude-sonnet-4-5)")
    expect(result).toContain("### google/gemini-3-pro (google/gemini-3-pro)")
    expect(result).toContain("### Launch Failures")
    expect(result).toContain("**GPT**")
    expect(result).toContain("provider outage")
  })

  test("returns dedup error when council is already running in same session", async () => {
    // #given - use a never-resolving launch to keep the first execution in-flight
    const pendingLaunch = new Promise<BackgroundTask>(() => {})
    const launchManager = {
      launch: async () => pendingLaunch,
      getTask: () => undefined,
    } as unknown as BackgroundManager
    const athenaCouncilTool = createAthenaCouncilTool({
      backgroundManager: launchManager,
      councilConfig: { members: [{ model: "openai/gpt-5.3-codex" }] },
      client: mockClient,
    })

    // #when - first call starts but never resolves (stuck in launch)
    // second call should be rejected by session guard
    const _firstExecution = athenaCouncilTool.execute({ question: "First run" }, mockToolContext)

    // Allow microtask queue to process so markCouncilRunning is called
    await new Promise((resolve) => setTimeout(resolve, 0))

    const secondExecution = await athenaCouncilTool.execute({ question: "Second run" }, mockToolContext)

    // #then
    expect(secondExecution).toBe("Council is already running for this session. Wait for the current council execution to complete.")
  })
})
