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
  //#given a council launch input with all fields
  //#when launch is called
  //#then all fields are forwarded to the background manager
  test("forwards all launch input fields to background manager", async () => {
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
    })

    expect(capturedInputs).toHaveLength(1)
    expect(capturedInputs[0]?.description).toBe("Council member: test")
    expect(capturedInputs[0]?.prompt).toBe("Analyze this")
    expect(capturedInputs[0]?.agent).toBe("athena")
    expect(capturedInputs[0]?.parentSessionID).toBe("session-1")
    expect(capturedInputs[0]?.parentMessageID).toBe("message-1")
    expect(capturedInputs[0]?.model).toEqual({ providerID: "openai", modelID: "gpt-5.3-codex" })
  })
})
