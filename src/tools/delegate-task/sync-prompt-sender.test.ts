const {
  describe: bunDescribe,
  test: bunTest,
  expect: bunExpect,
  mock: bunMock,
  afterEach: bunAfterEach,
} = require("bun:test")

const {
  clearSessionPromptParams,
  getSessionPromptParams,
} = require("../../shared/session-prompt-params-state")

bunDescribe("sendSyncPrompt", () => {
  bunAfterEach(() => {
    clearSessionPromptParams("test-session")
  })

  bunTest("passes question=false via tools parameter", async () => {
    //#given
    const { sendSyncPrompt } = require("./sync-prompt-sender")

    let promptArgs: any
    const promptAsync = bunMock(async (input: any) => {
      promptArgs = input
      return { data: {} }
    })

    const mockClient = {
      session: {
        promptAsync,
      },
    }

    const input = {
      sessionID: "test-session",
      agentToUse: "sisyphus-junior",
      args: {
        description: "test task",
        prompt: "test prompt",
        run_in_background: false,
        load_skills: [],
      },
      systemContent: undefined,
      categoryModel: undefined,
      toastManager: null,
      taskId: undefined,
    }

    //#when
    await sendSyncPrompt(mockClient, input)

    //#then
    bunExpect(promptAsync).toHaveBeenCalled()
    bunExpect(promptArgs.body.tools.question).toBe(false)
  })

  bunTest("applies agent tool restrictions for explore agent", async () => {
    //#given
    const { sendSyncPrompt } = require("./sync-prompt-sender")

    let promptArgs: any
    const promptAsync = bunMock(async (input: any) => {
      promptArgs = input
      return { data: {} }
    })

    const mockClient = {
      session: {
        promptAsync,
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
    await sendSyncPrompt(mockClient, input)

    //#then
    bunExpect(promptAsync).toHaveBeenCalled()
    bunExpect(promptArgs.body.tools.call_omo_agent).toBe(false)
  })

  bunTest("applies agent tool restrictions for librarian agent", async () => {
    //#given
    const { sendSyncPrompt } = require("./sync-prompt-sender")

    let promptArgs: any
    const promptAsync = bunMock(async (input: any) => {
      promptArgs = input
      return { data: {} }
    })

    const mockClient = {
      session: {
        promptAsync,
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
    await sendSyncPrompt(mockClient, input)

    //#then
    bunExpect(promptAsync).toHaveBeenCalled()
    bunExpect(promptArgs.body.tools.call_omo_agent).toBe(false)
  })

  bunTest("does not restrict call_omo_agent for sisyphus agent", async () => {
    //#given
    const { sendSyncPrompt } = require("./sync-prompt-sender")

    let promptArgs: any
    const promptAsync = bunMock(async (input: any) => {
      promptArgs = input
      return { data: {} }
    })

    const mockClient = {
      session: {
        promptAsync,
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
    await sendSyncPrompt(mockClient, input)

    //#then
    bunExpect(promptAsync).toHaveBeenCalled()
    bunExpect(promptArgs.body.tools.call_omo_agent).toBe(true)
  })

  bunTest("includes agent alongside explicit category model", async () => {
    //#given
    const { sendSyncPrompt } = require("./sync-prompt-sender")

    let promptArgs: any
    const promptAsync = bunMock(async (input: any) => {
      promptArgs = input
      return { data: {} }
    })

    const mockClient = {
      session: {
        promptAsync,
      },
    }

    const input = {
      sessionID: "test-session",
      agentToUse: "sisyphus-junior",
      args: {
        description: "test task",
        prompt: "test prompt",
        category: "quick",
        run_in_background: false,
        load_skills: [],
      },
      systemContent: undefined,
      categoryModel: {
        providerID: "openai",
        modelID: "gpt-5.4",
        variant: "medium",
      },
      toastManager: null,
      taskId: undefined,
    }

    //#when
    await sendSyncPrompt(mockClient, input)

    //#then
    bunExpect(promptAsync).toHaveBeenCalled()
    bunExpect(promptArgs.body.agent).toBe("sisyphus-junior")
    bunExpect(promptArgs.body.model).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4",
    })
    bunExpect(promptArgs.body.variant).toBe("medium")
  })

  bunTest("passes promoted fallback model settings through supported prompt channels", async () => {
    //#given
    const { sendSyncPrompt } = require("./sync-prompt-sender")

    let promptArgs: any
    const promptWithModelSuggestionRetry = bunMock(async (_client: any, input: any) => {
      promptArgs = input
    })

    const input = {
      sessionID: "test-session",
      agentToUse: "oracle",
      args: {
        description: "test task",
        prompt: "test prompt",
        run_in_background: false,
        load_skills: [],
      },
      systemContent: undefined,
      categoryModel: {
        providerID: "openai",
        modelID: "gpt-5.4",
        variant: "low",
        reasoningEffort: "high",
        temperature: 0.4,
        top_p: 0.7,
        maxTokens: 4096,
        thinking: { type: "disabled" },
      },
      toastManager: null,
      taskId: undefined,
    }

    //#when
    await sendSyncPrompt(
      { session: { promptAsync: bunMock(async () => ({ data: {} })) } },
      input,
      {
        promptWithModelSuggestionRetry,
        promptSyncWithModelSuggestionRetry: bunMock(async () => {}),
      },
    )

    //#then
    bunExpect(promptWithModelSuggestionRetry).toHaveBeenCalledTimes(1)
    bunExpect(promptArgs.body.model).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4",
    })
    bunExpect(promptArgs.body.variant).toBe("low")
    bunExpect(promptArgs.body.options).toEqual({
      reasoningEffort: "high",
      thinking: { type: "disabled" },
      maxTokens: 4096,
    })
    bunExpect(getSessionPromptParams("test-session")).toEqual({
      temperature: 0.4,
      topP: 0.7,
      options: {
        reasoningEffort: "high",
        thinking: { type: "disabled" },
        maxTokens: 4096,
      },
    })
  })

  bunTest("forwards category temperature through the sync prompt body", async () => {
    //#given
    const { sendSyncPrompt } = require("./sync-prompt-sender")

    let promptArgs: any
    const promptWithModelSuggestionRetry = bunMock(async (_client: any, input: any) => {
      promptArgs = input
    })

    const input = {
      sessionID: "test-session",
      agentToUse: "sisyphus-junior",
      args: {
        description: "test task",
        prompt: "test prompt",
        category: "quick",
        run_in_background: false,
        load_skills: [],
      },
      systemContent: undefined,
      categoryModel: {
        providerID: "openai",
        modelID: "gpt-5.4",
        temperature: 0.25,
      },
      toastManager: null,
      taskId: undefined,
    }

    //#when
    await sendSyncPrompt(
      { session: { promptAsync: bunMock(async () => ({ data: {} })) } },
      input,
      {
        promptWithModelSuggestionRetry,
        promptSyncWithModelSuggestionRetry: bunMock(async () => {}),
      },
    )

    //#then
    bunExpect(promptWithModelSuggestionRetry).toHaveBeenCalledTimes(1)
    bunExpect(promptArgs.body.temperature).toBe(0.25)
  })
  bunTest("retries with promptSync for oracle when promptAsync fails with unexpected EOF", async () => {
    //#given
    const { sendSyncPrompt } = require("./sync-prompt-sender")

    const promptWithModelSuggestionRetry = bunMock(async () => {
      throw new Error("JSON Parse error: Unexpected EOF")
    })
    const promptSyncWithModelSuggestionRetry = bunMock(async () => {})

    const input = {
      sessionID: "test-session",
      agentToUse: "oracle",
      args: {
        description: "test task",
        prompt: "test prompt",
        run_in_background: false,
        load_skills: [],
      },
      systemContent: undefined,
      categoryModel: undefined,
      toastManager: null,
      taskId: undefined,
    }

    //#when
    const result = await sendSyncPrompt(
      { session: { promptAsync: bunMock(async () => ({ data: {} })) } },
      input,
      {
        promptWithModelSuggestionRetry,
        promptSyncWithModelSuggestionRetry,
      },
    )

    //#then
    bunExpect(result).toBeNull()
    bunExpect(promptWithModelSuggestionRetry).toHaveBeenCalledTimes(1)
    bunExpect(promptSyncWithModelSuggestionRetry).toHaveBeenCalledTimes(1)
  })

  bunTest("does not retry with promptSync for non-oracle on unexpected EOF", async () => {
    //#given
    const { sendSyncPrompt } = require("./sync-prompt-sender")

    const promptWithModelSuggestionRetry = bunMock(async () => {
      throw new Error("JSON Parse error: Unexpected EOF")
    })
    const promptSyncWithModelSuggestionRetry = bunMock(async () => {})

    const input = {
      sessionID: "test-session",
      agentToUse: "metis",
      args: {
        description: "test task",
        prompt: "test prompt",
        run_in_background: false,
        load_skills: [],
      },
      systemContent: undefined,
      categoryModel: undefined,
      toastManager: null,
      taskId: undefined,
    }

    //#when
    const result = await sendSyncPrompt(
      { session: { promptAsync: bunMock(async () => ({ data: {} })) } },
      input,
      {
        promptWithModelSuggestionRetry,
        promptSyncWithModelSuggestionRetry,
      },
    )

    //#then
    bunExpect(result).toContain("Unexpected EOF")
    bunExpect(promptWithModelSuggestionRetry).toHaveBeenCalledTimes(1)
    bunExpect(promptSyncWithModelSuggestionRetry).toHaveBeenCalledTimes(0)
  })
})
