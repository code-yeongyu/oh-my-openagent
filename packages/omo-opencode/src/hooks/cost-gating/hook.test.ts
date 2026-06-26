import type { PluginInput } from "@opencode-ai/plugin"
import { describe, expect, test, mock, spyOn } from "bun:test"
import { createCostGatingHook } from "./hook"
import type { OhMyOpenCodeConfig } from "../../config"

describe("cost-gating hook", () => {
  function mockPluginInput() {
    const mockSessionGet = mock(() => Promise.resolve({ data: { directory: "/fake/dir", title: "Test Sisyphus Work" } }))
    const mockSessionMessages = mock(() => Promise.resolve([
      { info: { role: "user" }, parts: [{ type: "text", text: "Please fix X." }] },
      { info: { role: "assistant" }, parts: [{ type: "thinking", text: "I need to look at X." }, { type: "text", text: "I will edit X." }] },
    ]))
    const mockSessionCreate = mock(() => Promise.resolve({ data: { id: "ses_new_rolled" } }))
    const mockSessionPromptAsync = mock(() => Promise.resolve({}))
    const mockSessionAbort = mock(() => Promise.resolve({}))
    const mockSelectSession = mock(() => Promise.resolve({}))
    const mockShowToast = mock(() => Promise.resolve({}))

    const client = {
      session: {
        get: mockSessionGet,
        messages: mockSessionMessages,
        create: mockSessionCreate,
        promptAsync: mockSessionPromptAsync,
        abort: mockSessionAbort,
      },
      tui: {
        selectSession: mockSelectSession,
        showToast: mockShowToast,
      },
    }

    const ctx = {
      directory: "/fake/dir",
      client,
    } as unknown as PluginInput

    return {
      ctx,
      client,
      mockSessionGet,
      mockSessionMessages,
      mockSessionCreate,
      mockSessionPromptAsync,
      mockSessionAbort,
      mockSelectSession,
      mockShowToast,
    }
  }

  function mockConfig(threshold = 200000): OhMyOpenCodeConfig {
    return {
      cost_gating_threshold_tokens: threshold,
    } as OhMyOpenCodeConfig
  }

  test("should NOT trigger rollover if token count is below threshold", async () => {
    const mocks = mockPluginInput()
    const hook = createCostGatingHook(mocks.ctx, mockConfig(200000))
    const sessionID = "ses_active"

    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          sessionID,
          info: {
            role: "assistant",
            tokens: { input: 150000, output: 2000 },
          },
        },
      },
    })

    // Allow async microtasks to run (since runSessionRollover runs in background)
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(mocks.mockSessionCreate).not.toHaveBeenCalled()
  })

  test("should trigger rollover if token count reaches threshold", async () => {
    const mocks = mockPluginInput()
    const hook = createCostGatingHook(mocks.ctx, mockConfig(200000))
    const sessionID = "ses_active"

    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          sessionID,
          info: {
            role: "assistant",
            tokens: { input: 199000, output: 2000 }, // 201k total
          },
        },
      },
    })

    // Allow async rollover tasks to run
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(mocks.mockSessionGet).toHaveBeenCalledWith({ path: { id: sessionID } })
    expect(mocks.mockSessionMessages).toHaveBeenCalledWith({ path: { id: sessionID }, query: { limit: 15 } })
    expect(mocks.mockSessionCreate).toHaveBeenCalledWith({
      body: {
        parentID: sessionID,
        title: "Test Sisyphus Work (Rollover)",
        permission: "allow",
      },
      query: { directory: "/fake/dir" },
    })
    expect(mocks.mockSessionPromptAsync).toHaveBeenCalled()
    expect(mocks.mockSelectSession).toHaveBeenCalledWith({ body: { sessionID: "ses_new_rolled" } })
    expect(mocks.mockSessionAbort).toHaveBeenCalledWith({ path: { id: sessionID } })
    expect(mocks.mockShowToast).toHaveBeenCalled()
  })
})
