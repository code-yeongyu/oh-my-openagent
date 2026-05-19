import { afterEach, describe, expect, test } from "bun:test"
import { createUnstableAgentBabysitter } from "./unstable-agent-babysitter"
import type { BackgroundTask } from "../features/background-agent"
import { _resetForTesting, setMainSession } from "../features/claude-code-session-state"
import { releaseAllPromptAsyncReservationsForTesting } from "../hooks/shared/prompt-async-gate"
import { unsafeTestValue } from "../../test-support/unsafe-test-value"

function createTask(): BackgroundTask {
  return {
    id: "task-1",
    sessionId: "bg-1",
    parentSessionId: "main-1",
    parentMessageId: "msg-1",
    description: "unstable task",
    prompt: "run work",
    agent: "test-agent",
    status: "running",
    progress: {
      toolCalls: 1,
      lastUpdate: new Date(Date.now() - 121000),
      lastMessage: "still working",
      lastMessageAt: new Date(Date.now() - 121000),
    },
    model: { providerID: "google", modelID: "gemini-1.5" },
  }
}

describe("createUnstableAgentBabysitter", () => {
  afterEach(() => {
    _resetForTesting()
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("#given wrapper-created babysitter hook #when injecting a stale-task reminder #then the real SDK promptAsync is called once", async () => {
    // given
    setMainSession("main-1")
    const promptAsyncCalls: unknown[] = []
    const babysitter = createUnstableAgentBabysitter({
      ctx: unsafeTestValue({
        directory: process.cwd(),
        client: {
          session: {
            messages: async ({ path }: { path: { id: string } }) => ({
              data: path.id === "main-1"
                ? [
                    {
                      info: {
                        role: "assistant",
                        agent: "sisyphus",
                        model: { providerID: "openai", modelID: "gpt-4" },
                      },
                    },
                  ]
                : [
                    {
                      info: { role: "assistant" },
                      parts: [{ type: "thinking", thinking: "deep thought" }],
                    },
                  ],
            }),
            status: async () => ({ data: { "main-1": { type: "idle" } } }),
            promptAsync: async (input: unknown) => {
              promptAsyncCalls.push(input)
              return {}
            },
          },
        },
      }),
      backgroundManager: unsafeTestValue({
        getTasksByParentSession: () => [createTask()],
      }),
      pluginConfig: unsafeTestValue({ babysitting: { timeout_ms: 120000 } }),
    })

    // when
    await babysitter.event({
      event: {
        type: "session.idle",
        properties: { sessionID: "main-1" },
      },
    })

    // then
    expect(promptAsyncCalls).toHaveLength(1)
  })
})
