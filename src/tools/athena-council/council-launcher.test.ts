import { describe, expect, test } from "bun:test"
import type { BackgroundManager } from "../../features/background-agent"
import type { BackgroundTask, LaunchInput } from "../../features/background-agent/types"
import { createCouncilLauncher } from "./council-launcher"

function createMockTask(id: string): BackgroundTask {
  return {
    id,
    parentSessionID: "session-1",
    parentMessageID: "message-1",
    description: "test",
    prompt: "test",
    agent: "athena",
    status: "running",
  }
}

describe("createCouncilLauncher", () => {
  //#given a council launch input with temperature and permission
  //#when launch is called
  //#then temperature and permission are forwarded to the background manager
  test("forwards temperature and permission to background manager", async () => {
    const capturedInputs: LaunchInput[] = []
    const mockManager = {
      launch: async (input: LaunchInput) => {
        capturedInputs.push(input)
        return createMockTask("bg-1")
      },
      getTask: () => undefined,
    } as unknown as BackgroundManager

    const launcher = createCouncilLauncher(mockManager)

    await launcher.launch({
      description: "Council member: test",
      prompt: "Analyze this",
      agent: "athena",
      parentSessionID: "session-1",
      parentMessageID: "message-1",
      model: { providerID: "openai", modelID: "gpt-5.3-codex" },
      temperature: 0.3,
      permission: { write: "deny", edit: "deny", task: "deny" },
    })

    expect(capturedInputs).toHaveLength(1)
    expect(capturedInputs[0]?.temperature).toBe(0.3)
    expect(capturedInputs[0]?.permission).toEqual({ write: "deny", edit: "deny", task: "deny" })
  })

  //#given a council launch input without temperature and permission
  //#when launch is called
  //#then undefined temperature and permission are forwarded (not dropped)
  test("forwards undefined temperature and permission without error", async () => {
    const capturedInputs: LaunchInput[] = []
    const mockManager = {
      launch: async (input: LaunchInput) => {
        capturedInputs.push(input)
        return createMockTask("bg-2")
      },
      getTask: () => undefined,
    } as unknown as BackgroundManager

    const launcher = createCouncilLauncher(mockManager)

    await launcher.launch({
      description: "Council member: test",
      prompt: "Analyze this",
      agent: "athena",
      parentSessionID: "session-1",
      parentMessageID: "message-1",
    })

    expect(capturedInputs).toHaveLength(1)
    expect(capturedInputs[0]?.temperature).toBeUndefined()
    expect(capturedInputs[0]?.permission).toBeUndefined()
  })
})
