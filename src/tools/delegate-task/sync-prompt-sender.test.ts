const { describe, test, expect, mock } = require("bun:test")

describe("sendSyncPrompt", () => {
  test("applies agent tool restrictions for explore agent", async () => {
    //#given
    const mockPromptWithModelSuggestionRetry = mock(async () => {})
    mock.module("../../shared/model-suggestion-retry", () => ({
      promptWithModelSuggestionRetry: mockPromptWithModelSuggestionRetry,
    }))

    const { sendSyncPrompt } = require("./sync-prompt-sender")

    const mockClient = {
      session: {
        prompt: mock(async () => ({ data: {} })),
      },
    }

    const input = {
      sessionID: "test-session",
      agentToUse: "explore",
      args: {
        description: "test task",
        prompt: "test prompt",
        category: "quick",
        run_in_background: false,
        load_skills: [],
      },
      systemContent: undefined,
      categoryModel: undefined,
      toastManager: null,
      taskId: undefined,
    }

    //#when
    await sendSyncPrompt(mockClient as any, input)

    //#then
    expect(mockPromptWithModelSuggestionRetry).toHaveBeenCalled()
    const callArgs = mockPromptWithModelSuggestionRetry.mock.calls[0][1]
    expect(callArgs.body.tools.call_omo_agent).toBe(false)
  })

  test("applies agent tool restrictions for librarian agent", async () => {
    //#given
    const mockPromptWithModelSuggestionRetry = mock(async () => {})
    mock.module("../../shared/model-suggestion-retry", () => ({
      promptWithModelSuggestionRetry: mockPromptWithModelSuggestionRetry,
    }))

    const { sendSyncPrompt } = require("./sync-prompt-sender")

    const mockClient = {
      session: {
        prompt: mock(async () => ({ data: {} })),
      },
    }

    const input = {
      sessionID: "test-session",
      agentToUse: "librarian",
      args: {
        description: "test task",
        prompt: "test prompt",
        category: "quick",
        run_in_background: false,
        load_skills: [],
      },
      systemContent: undefined,
      categoryModel: undefined,
      toastManager: null,
      taskId: undefined,
    }

    //#when
    await sendSyncPrompt(mockClient as any, input)

    //#then
    expect(mockPromptWithModelSuggestionRetry).toHaveBeenCalled()
    const callArgs = mockPromptWithModelSuggestionRetry.mock.calls[0][1]
    expect(callArgs.body.tools.call_omo_agent).toBe(false)
  })

  test("does not restrict call_omo_agent for sisyphus agent", async () => {
    //#given
    const mockPromptWithModelSuggestionRetry = mock(async () => {})
    mock.module("../../shared/model-suggestion-retry", () => ({
      promptWithModelSuggestionRetry: mockPromptWithModelSuggestionRetry,
    }))

    const { sendSyncPrompt } = require("./sync-prompt-sender")

    const mockClient = {
      session: {
        prompt: mock(async () => ({ data: {} })),
      },
    }

    const input = {
      sessionID: "test-session",
      agentToUse: "sisyphus",
      args: {
        description: "test task",
        prompt: "test prompt",
        category: "quick",
        run_in_background: false,
        load_skills: [],
      },
      systemContent: undefined,
      categoryModel: undefined,
      toastManager: null,
      taskId: undefined,
    }

    //#when
    await sendSyncPrompt(mockClient as any, input)

    //#then
    expect(mockPromptWithModelSuggestionRetry).toHaveBeenCalled()
    const callArgs = mockPromptWithModelSuggestionRetry.mock.calls[0][1]
    expect(callArgs.body.tools.call_omo_agent).toBe(true)
  })
})