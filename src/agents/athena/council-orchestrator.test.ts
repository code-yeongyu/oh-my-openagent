import { describe, expect, test } from "bun:test"
import { buildCouncilPrompt } from "./council-prompt"
import { executeCouncil } from "./council-orchestrator"
import type { CouncilConfig } from "./types"

interface MockLaunchInput {
  description: string
  prompt: string
  agent: string
  parentSessionID: string
  parentMessageID: string
  parentAgent?: string
  model?: { providerID: string; modelID: string; variant?: string }
}

function createMockTask(id: string, launch: MockLaunchInput) {
  return {
    id,
    status: "pending" as const,
    parentSessionID: launch.parentSessionID,
    parentMessageID: launch.parentMessageID,
    description: launch.description,
    prompt: launch.prompt,
    agent: launch.agent,
  }
}

describe("executeCouncil", () => {
  //#given a council with 3 members and a question
  //#when executeCouncil is called
  //#then all members are launched with the same prompt and parsed model ids
  test("launches all members with identical prompt and model params", async () => {
    const launches: MockLaunchInput[] = []
    const launcher = {
      launch: async (input: MockLaunchInput) => {
        launches.push(input)
        return createMockTask(`task-${launches.length}`, input)
      },
    }

    const council: CouncilConfig = {
      members: [
        { model: "openai/gpt-5.3-codex", name: "openai" },
        { model: "anthropic/claude-sonnet-4-5", name: "anthropic" },
        { model: "google/gemini-3-pro", name: "google" },
      ],
    }

    const question = "How can we improve the retry strategy?"
    const result = await executeCouncil({
      question,
      council,
      launcher,
      parentSessionID: "session-1",
      parentMessageID: "message-1",
      parentAgent: "sisyphus",
    })

    const expectedPrompt = buildCouncilPrompt(question)

    expect(launches).toHaveLength(3)
    expect(result.launched).toHaveLength(3)
    expect(result.failures).toHaveLength(0)
    expect(result.totalMembers).toBe(3)

    for (const launch of launches) {
      expect(launch.prompt).toBe(expectedPrompt)
      expect(launch.agent).toBe("athena")
    }

    expect(launches[0]?.model).toEqual({ providerID: "openai", modelID: "gpt-5.3-codex" })
    expect(launches[1]?.model).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4-5" })
    expect(launches[2]?.model).toEqual({ providerID: "google", modelID: "gemini-3-pro" })
  })

  //#given a council with 3 members where 1 launch throws
  //#when executeCouncil is called
  //#then launch failures are captured separately from successful launches
  test("captures launch failures separately from successful launches", async () => {
    const launcher = {
      launch: async (input: MockLaunchInput) => {
        if (input.model?.providerID === "anthropic") {
          throw new Error("Provider unavailable")
        }
        return createMockTask(`task-${input.model?.providerID}`, input)
      },
    }

    const result = await executeCouncil({
      question: "Find race condition risks",
      council: {
        members: [
          { model: "openai/gpt-5.3-codex" },
          { model: "anthropic/claude-sonnet-4-5" },
          { model: "google/gemini-3-pro" },
        ],
      },
      launcher,
      parentSessionID: "session-1",
      parentMessageID: "message-1",
    })

    expect(result.launched).toHaveLength(2)
    expect(result.failures).toHaveLength(1)
    expect(result.totalMembers).toBe(3)
    expect(result.failures[0]?.member.model).toBe("anthropic/claude-sonnet-4-5")
    expect(result.failures[0]?.error).toContain("Launch failed")
  })

  //#given a council where all launches throw
  //#when executeCouncil is called
  //#then all members appear as failures with zero launched
  test("returns all failures when every launch throws", async () => {
    const launcher = {
      launch: async () => {
        throw new Error("Model unavailable")
      },
    }

    const result = await executeCouncil({
      question: "Analyze unknown module",
      council: {
        members: [
          { model: "openai/gpt-5.3-codex" },
          { model: "anthropic/claude-sonnet-4-5" },
        ],
      },
      launcher,
      parentSessionID: "session-1",
      parentMessageID: "message-1",
    })

    expect(result.launched).toHaveLength(0)
    expect(result.failures).toHaveLength(2)
    expect(result.totalMembers).toBe(2)
    expect(result.failures.every((f) => f.error.includes("Launch failed"))).toBe(true)
  })

  //#given a council with one invalid model string
  //#when executeCouncil is called
  //#then invalid member becomes a failure while others still launch
  test("handles invalid model strings without crashing council execution", async () => {
    const launches: MockLaunchInput[] = []
    const launcher = {
      launch: async (input: MockLaunchInput) => {
        launches.push(input)
        return createMockTask(`task-${launches.length}`, input)
      },
    }

    const result = await executeCouncil({
      question: "Audit dependency graph",
      council: {
        members: [
          { model: "invalid-model" },
          { model: "openai/gpt-5.3-codex" },
        ],
      },
      launcher,
      parentSessionID: "session-1",
      parentMessageID: "message-1",
    })

    expect(launches).toHaveLength(1)
    expect(result.launched).toHaveLength(1)
    expect(result.failures).toHaveLength(1)
    expect(result.failures.find((f) => f.member.model === "invalid-model")?.error).toContain("Launch failed")
  })

  //#given members with per-member variant
  //#when executeCouncil is called
  //#then launch receives variant in model for each corresponding member
  test("passes member variant to launch input model", async () => {
    const launches: MockLaunchInput[] = []
    const launcher = {
      launch: async (input: MockLaunchInput) => {
        launches.push(input)
        return createMockTask(`task-${launches.length}`, input)
      },
    }

    await executeCouncil({
      question: "Compare architecture options",
      council: {
        members: [
          { model: "openai/gpt-5.3-codex", variant: "high" },
          { model: "anthropic/claude-sonnet-4-5" },
        ],
      },
      launcher,
      parentSessionID: "session-1",
      parentMessageID: "message-1",
    })

    expect(launches).toHaveLength(2)
    expect(launches[0]?.model?.variant).toBe("high")
    expect(launches[1]?.model?.variant).toBeUndefined()
  })

  //#given launched members
  //#when executeCouncil returns
  //#then each launched member has a taskId for background_output retrieval
  test("returns task IDs for background_output retrieval", async () => {
    const launcher = {
      launch: async (input: MockLaunchInput) =>
        createMockTask(`bg_${input.model?.providerID}`, input),
    }

    const result = await executeCouncil({
      question: "Review error handling",
      council: {
        members: [
          { model: "openai/gpt-5.3-codex", name: "OpenAI" },
          { model: "google/gemini-3-pro", name: "Gemini" },
        ],
      },
      launcher,
      parentSessionID: "session-1",
      parentMessageID: "message-1",
    })

    expect(result.launched).toHaveLength(2)
    expect(result.launched[0]?.taskId).toBe("bg_openai")
    expect(result.launched[0]?.member.name).toBe("OpenAI")
    expect(result.launched[1]?.taskId).toBe("bg_google")
    expect(result.launched[1]?.member.name).toBe("Gemini")
  })
})
