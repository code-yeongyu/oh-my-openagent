import { describe, expect, test } from "bun:test"
import { buildCouncilPrompt } from "./council-prompt"
import { executeCouncil } from "./council-orchestrator"
import type { CouncilConfig } from "./types"

type MockTaskStatus = "completed" | "error" | "cancelled" | "interrupt"

interface MockTask {
  id: string
  status: MockTaskStatus
  result?: string
  error?: string
  completedAt?: Date
}

interface MockLaunchInput {
  description: string
  prompt: string
  agent: string
  parentSessionID: string
  parentMessageID: string
  parentAgent?: string
  model?: { providerID: string; modelID: string; variant?: string }
  temperature?: number
  permission?: Record<string, "ask" | "allow" | "deny">
}

function createMockTask(task: MockTask, launch: MockLaunchInput): MockTask & {
  parentSessionID: string
  parentMessageID: string
  description: string
  prompt: string
  agent: string
} {
  return {
    parentSessionID: launch.parentSessionID,
    parentMessageID: launch.parentMessageID,
    description: launch.description,
    prompt: launch.prompt,
    agent: launch.agent,
    ...task,
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
        return createMockTask(
          {
            id: `task-${launches.length}`,
            status: "completed",
            result: `response-${launches.length}`,
            completedAt: new Date(),
          },
          input
        )
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
    expect(result.completedCount).toBe(3)
    expect(result.failedCount).toBe(0)

    for (const launch of launches) {
      expect(launch.prompt).toBe(expectedPrompt)
      expect(launch.agent).toBe("athena")
      expect(launch.permission).toEqual({ write: "deny", edit: "deny", task: "deny" })
    }

    expect(launches[0]?.model).toEqual({ providerID: "openai", modelID: "gpt-5.3-codex" })
    expect(launches[1]?.model).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4-5" })
    expect(launches[2]?.model).toEqual({ providerID: "google", modelID: "gemini-3-pro" })
  })

  //#given a council with 3 members where 1 member fails
  //#when executeCouncil is called
  //#then partial failures are tolerated and preserved in responses
  test("returns successful result for partial failures", async () => {
    const launcher = {
      launch: async (input: MockLaunchInput) => {
        if (input.model?.providerID === "anthropic") {
          return createMockTask(
            {
              id: "task-failed",
              status: "error",
              error: "Token limit exceeded",
              completedAt: new Date(),
            },
            input
          )
        }

        return createMockTask(
          {
            id: `task-${input.model?.providerID}`,
            status: "completed",
            result: `ok-${input.model?.providerID}`,
            completedAt: new Date(),
          },
          input
        )
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

    expect(result.completedCount).toBe(2)
    expect(result.failedCount).toBe(1)
    expect(result.responses).toHaveLength(3)
    expect(result.responses.filter((response) => response.status === "completed")).toHaveLength(2)
    expect(result.responses.filter((response) => response.status === "error")).toHaveLength(1)
  })

  //#given a council where all members fail
  //#when executeCouncil is called
  //#then it returns structured error result with zero completions
  test("returns all failures when every member fails", async () => {
    const launcher = {
      launch: async (input: MockLaunchInput) =>
        createMockTask(
          {
            id: `task-${input.model?.providerID}`,
            status: "error",
            error: "Model unavailable",
            completedAt: new Date(),
          },
          input
        ),
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

    expect(result.completedCount).toBe(0)
    expect(result.failedCount).toBe(2)
    expect(result.responses).toHaveLength(2)
    expect(result.responses.every((response) => response.status === "error")).toBe(true)
  })

  //#given a council with one invalid model string
  //#when executeCouncil is called
  //#then invalid member becomes an error response while others still execute
  test("handles invalid model strings without crashing council execution", async () => {
    const launches: MockLaunchInput[] = []
    const launcher = {
      launch: async (input: MockLaunchInput) => {
        launches.push(input)
        return createMockTask(
          {
            id: `task-${launches.length}`,
            status: "completed",
            result: "valid-member-response",
            completedAt: new Date(),
          },
          input
        )
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
    expect(result.completedCount).toBe(1)
    expect(result.failedCount).toBe(1)
    expect(result.responses).toHaveLength(2)
    expect(result.responses.find((response) => response.member.model === "invalid-model")?.status).toBe("error")
  })

  //#given members with per-member temperature and variant
  //#when executeCouncil is called
  //#then launch receives those values for each corresponding member
  test("passes member temperature and variant to launch input", async () => {
    const launches: MockLaunchInput[] = []
    const launcher = {
      launch: async (input: MockLaunchInput) => {
        launches.push(input)
        return createMockTask(
          {
            id: `task-${launches.length}`,
            status: "completed",
            result: "ok",
            completedAt: new Date(),
          },
          input
        )
      },
    }

    await executeCouncil({
      question: "Compare architecture options",
      council: {
        members: [
          { model: "openai/gpt-5.3-codex", temperature: 0.1, variant: "high" },
          { model: "anthropic/claude-sonnet-4-5", temperature: 0.3 },
        ],
      },
      launcher,
      parentSessionID: "session-1",
      parentMessageID: "message-1",
    })

    expect(launches).toHaveLength(2)
    expect(launches[0]?.temperature).toBe(0.1)
    expect(launches[0]?.model?.variant).toBe("high")
    expect(launches[1]?.temperature).toBe(0.3)
    expect(launches[1]?.model?.variant).toBeUndefined()
  })
})
