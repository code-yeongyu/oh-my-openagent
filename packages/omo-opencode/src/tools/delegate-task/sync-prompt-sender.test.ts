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

type PromptArgs = {
  body: {
    agent?: string
    model?: unknown
    variant?: string
    tools: Record<string, boolean>
    options?: unknown
    maxOutputTokens?: number
    temperature?: number
  }
}

bunDescribe("sendSyncPrompt", () => {
  bunAfterEach(() => {
    clearSessionPromptParams("test-session")
  })

  bunTest("#given sync task result is polled separately #when sending the child prompt #then it starts with promptAsync instead of holding the sync stream", async () => {
    //#given
    const { sendSyncPrompt } = require("./sync-prompt-sender")

    const prompt = bunMock(async () => {
      throw new Error("sync prompt stream should not be used")
    })
    const promptAsync = bunMock(async () => undefined)
    const mockClient = {
      session: {
        prompt,
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
    const result = await sendSyncPrompt(mockClient, input)

    //#then
    bunExpect(result).toBeNull()
    bunExpect(prompt).toHaveBeenCalledTimes(0)
    bunExpect(promptAsync).toHaveBeenCalledTimes(1)
  })

  bunTest("passes question=false via tools parameter", async () => {
    //#given
    const { sendSyncPrompt } = require("./sync-prompt-sender")

    let promptArgs!: PromptArgs
    const promptAsync = bunMock(async (input: PromptArgs) => {
      promptArgs = input
      return { data: {} }
    })

    const mockClient = {
      session: {
        prompt: promptAsync,
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

    let promptArgs!: PromptArgs
    const promptAsync = bunMock(async (input: PromptArgs) => {
      promptArgs = input
      return { data: {} }
    })

    const mockClient = {
      session: {
        prompt: promptAsync,
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

    let promptArgs!: PromptArgs
    const promptAsync = bunMock(async (input: PromptArgs) => {
      promptArgs = input
      return { data: {} }
    })

    const mockClient = {
      session: {
        prompt: promptAsync,
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

    let promptArgs!: PromptArgs
    const promptAsync = bunMock(async (input: PromptArgs) => {
      promptArgs = input
      return { data: {} }
    })

    const mockClient = {
      session: {
        prompt: promptAsync,
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

  bunTest("disables call_omo_agent for an Anthropic-backed sync task", async () => {
    //#given
    const { sendSyncPrompt } = require("./sync-prompt-sender")
    let promptArgs!: PromptArgs
    const promptAsync = bunMock(async (input: PromptArgs) => {
      promptArgs = input
      return { data: {} }
    })
    const input = {
      sessionID: "test-session",
      agentToUse: "sisyphus",
      args: {
        description: "test task",
        prompt: "test prompt",
        run_in_background: false,
        load_skills: [],
      },
      systemContent: undefined,
      categoryModel: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
      toastManager: null,
      taskId: undefined,
    }

    //#when
    await sendSyncPrompt({ session: { prompt: promptAsync, promptAsync } }, input)

    //#then
    bunExpect(promptArgs.body.tools.call_omo_agent).toBe(false)
  })

  bunTest("includes agent alongside explicit category model", async () => {
    //#given
    const { sendSyncPrompt } = require("./sync-prompt-sender")

    let promptArgs!: PromptArgs
    const promptAsync = bunMock(async (input: PromptArgs) => {
      promptArgs = input
      return { data: {} }
    })

    const mockClient = {
      session: {
        prompt: promptAsync,
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

    let promptArgs!: PromptArgs
    const promptWithModelSuggestionRetry = bunMock(async (_client: unknown, input: PromptArgs) => {
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
      { session: { prompt: bunMock(async () => ({ data: {} })) } },
      input,
      {
        promptWithModelSuggestionRetry,
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
    })
    bunExpect(promptArgs.body.maxOutputTokens).toBe(4096)
    bunExpect(getSessionPromptParams("test-session")).toEqual({
      temperature: 0.4,
      topP: 0.7,
      maxOutputTokens: 4096,
      options: {
        reasoningEffort: "high",
        thinking: { type: "disabled" },
      },
    })
  })

  bunTest("forwards category temperature through the sync prompt body", async () => {
    //#given
    const { sendSyncPrompt } = require("./sync-prompt-sender")

    let promptArgs!: PromptArgs
    const promptWithModelSuggestionRetry = bunMock(async (_client: unknown, input: PromptArgs) => {
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
      { session: { prompt: bunMock(async () => ({ data: {} })) } },
      input,
      {
        promptWithModelSuggestionRetry,
      },
    )

    //#then
    bunExpect(promptWithModelSuggestionRetry).toHaveBeenCalledTimes(1)
    bunExpect(promptArgs.body.temperature).toBe(0.25)
  })
  bunTest("#given oracle prompt starter returns unexpected EOF #when sending a sync prompt #then the prompt is treated as started", async () => {
    //#given
    const { sendSyncPrompt } = require("./sync-prompt-sender")

    const promptWithModelSuggestionRetry = bunMock(async () => {
      throw new Error("JSON Parse error: Unexpected EOF")
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
      },
    )

    //#then
    bunExpect(result).toBeNull()
    bunExpect(promptWithModelSuggestionRetry).toHaveBeenCalledTimes(1)
  })

  bunTest("returns non-oracle unexpected EOF from the prompt starter", async () => {
    //#given
    const { sendSyncPrompt } = require("./sync-prompt-sender")

    const promptWithModelSuggestionRetry = bunMock(async () => {
      throw new Error("JSON Parse error: Unexpected EOF")
    })

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
      },
    )

    //#then
    bunExpect(result).toContain("Unexpected EOF")
    bunExpect(promptWithModelSuggestionRetry).toHaveBeenCalledTimes(1)
  })

  bunTest("#given prompt starter rejects an invalid payload #when sending a sync prompt #then the task error is surfaced and toast is removed", async () => {
    //#given
    const { sendSyncPrompt } = require("./sync-prompt-sender")

    const promptWithModelSuggestionRetry = bunMock(async () => {
      throw new Error("Bad request: parts is required")
    })
    const removeTask = bunMock(() => undefined)

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
      toastManager: { removeTask },
      taskId: "task-123",
    }

    //#when
    const result = await sendSyncPrompt(
      { session: { promptAsync: bunMock(async () => ({ data: {} })) } },
      input,
      {
        promptWithModelSuggestionRetry,
      },
    )

    //#then
    bunExpect(result).toContain("Bad request: parts is required")
    bunExpect(removeTask).toHaveBeenCalledWith("task-123")
    bunExpect(promptWithModelSuggestionRetry).toHaveBeenCalledTimes(1)
  })

  bunTest("#given oracle prompt starter is blocked by the prompt gate #when sending a sync prompt #then the gate error is preserved", async () => {
    //#given
    const { sendSyncPrompt } = require("./sync-prompt-sender")

    const promptWithModelSuggestionRetry = bunMock(async () => {
      throw new Error("prompt skipped by gate: reserved")
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
      },
    )

    //#then
    bunExpect(result).toContain("prompt skipped by gate")
    bunExpect(promptWithModelSuggestionRetry).toHaveBeenCalledTimes(1)
  })
})
