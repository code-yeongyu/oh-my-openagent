/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type { BackgroundManager } from "../../features/background-agent"
import type { BackgroundTask } from "../../features/background-agent/types"
import { createAthenaCouncilTool, filterCouncilMembers } from "./tools"

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

function createRunningTask(id: string): BackgroundTask {
  return {
    id,
    parentSessionID: "session-1",
    parentMessageID: "message-1",
    description: `Council member task ${id}`,
    prompt: "prompt",
    agent: "athena",
    status: "running",
  }
}

function parseLaunchResult(result: unknown): {
  launched: number
  members: Array<{ task_id: string; name: string; model: string; status: string }>
  failed: Array<{ name: string; model: string; error: string }>
} {
  expect(typeof result).toBe("string")
  return JSON.parse(result as string)
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

  test("returns launched task_ids and member mapping for configured council", async () => {
    // #given
    let launchCount = 0
    const launchManager = {
      launch: async () => {
        launchCount += 1
        return createRunningTask(`bg-${launchCount}`)
      },
      getTask: () => undefined,
    } as unknown as BackgroundManager
    const athenaCouncilTool = createAthenaCouncilTool({
      backgroundManager: launchManager,
      councilConfig: { members: configuredMembers },
    })

    // #when
    const result = await athenaCouncilTool.execute({ question: "How should we proceed?" }, mockToolContext)
    const parsed = parseLaunchResult(result)

    // #then
    expect(parsed.launched).toBe(3)
    expect(parsed.failed).toEqual([])
    expect(parsed.members).toEqual([
      {
        task_id: "bg-1",
        name: "Claude",
        model: "anthropic/claude-sonnet-4-5",
        status: "running",
      },
      {
        task_id: "bg-2",
        name: "GPT",
        model: "openai/gpt-5.3-codex",
        status: "running",
      },
      {
        task_id: "bg-3",
        name: "google/gemini-3-pro",
        model: "google/gemini-3-pro",
        status: "running",
      },
    ])
  })

  test("returns task_ids length matching selected members", async () => {
    // #given
    let launchCount = 0
    const launchManager = {
      launch: async () => {
        launchCount += 1
        return createRunningTask(`bg-${launchCount}`)
      },
      getTask: () => undefined,
    } as unknown as BackgroundManager
    const athenaCouncilTool = createAthenaCouncilTool({
      backgroundManager: launchManager,
      councilConfig: { members: configuredMembers },
    })

    // #when
    const result = await athenaCouncilTool.execute(
      {
        question: "Who should investigate this?",
        members: ["GPT", "google/gemini-3-pro"],
      },
      mockToolContext
    )
    const parsed = parseLaunchResult(result)

    // #then
    expect(parsed.launched).toBe(2)
    expect(parsed.members).toHaveLength(2)
    expect(parsed.members.map((member) => member.name)).toEqual(["GPT", "google/gemini-3-pro"])
  })

  test("returns failed launches inline while keeping successful task mappings", async () => {
    // #given
    let launchCount = 0
    const launchManager = {
      launch: async () => {
        launchCount += 1
        if (launchCount === 2) {
          throw new Error("provider outage")
        }

        return createRunningTask(`bg-${launchCount}`)
      },
      getTask: () => undefined,
    } as unknown as BackgroundManager
    const athenaCouncilTool = createAthenaCouncilTool({
      backgroundManager: launchManager,
      councilConfig: { members: configuredMembers },
    })

    // #when
    const result = await athenaCouncilTool.execute({ question: "Any concerns?" }, mockToolContext)
    const parsed = parseLaunchResult(result)

    // #then
    expect(parsed.launched).toBe(2)
    expect(parsed.members).toHaveLength(2)
    expect(parsed.failed).toHaveLength(1)
    expect(parsed.failed[0]).toEqual({
      name: "GPT",
      model: "openai/gpt-5.3-codex",
      error: "Launch failed: Error: provider outage",
    })
  })

  test("returns dedup error when council is already running in same session", async () => {
    // #given
    let resolveLaunch: ((task: BackgroundTask) => void) | undefined
    const pendingLaunch = new Promise<BackgroundTask>((resolve) => {
      resolveLaunch = resolve
    })
    const launchManager = {
      launch: async () => pendingLaunch,
      getTask: () => undefined,
    } as unknown as BackgroundManager
    const athenaCouncilTool = createAthenaCouncilTool({
      backgroundManager: launchManager,
      councilConfig: { members: [{ model: "openai/gpt-5.3-codex" }] },
    })

    // #when
    const firstExecution = athenaCouncilTool.execute({ question: "First run" }, mockToolContext)
    const secondExecution = await athenaCouncilTool.execute({ question: "Second run" }, mockToolContext)

    resolveLaunch?.(createRunningTask("bg-dedup"))
    const firstResult = parseLaunchResult(await firstExecution)

    // #then
    expect(secondExecution).toBe("Council is already running for this session. Wait for the current council execution to complete.")
    expect(firstResult.launched).toBe(1)
  })
})
