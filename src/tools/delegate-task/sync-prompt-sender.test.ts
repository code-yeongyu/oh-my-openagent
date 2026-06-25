const {
  describe: bunDescribe,
  test: bunTest,
  expect: bunExpect,
  mock: bunMock,
} = require("bun:test")

bunDescribe("sendSyncPrompt", () => {
  bunTest("passes question=false via tools parameter", async () => {
    //#given
    const { sendSyncPrompt } = require("./sync-prompt-sender")

    let promptArgs: unknown
    const promptAsync = bunMock(async (input: unknown) => {
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

    let promptArgs: unknown
    const promptAsync = bunMock(async (input: unknown) => {
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
      agentToUse: "trinity",
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
    bunExpect(promptArgs.body.tools.delegate_agent).toBe(false)
  })

  bunTest("applies agent tool restrictions for librarian agent", async () => {
    //#given
    const { sendSyncPrompt } = require("./sync-prompt-sender")

    let promptArgs: unknown
    const promptAsync = bunMock(async (input: unknown) => {
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
      agentToUse: "operator",
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
    bunExpect(promptArgs.body.tools.delegate_agent).toBe(false)
  })

  bunTest("does not restrict delegate_agent for morpheus agent", async () => {
    //#given
    const { sendSyncPrompt } = require("./sync-prompt-sender")

    let promptArgs: unknown
    const promptAsync = bunMock(async (input: unknown) => {
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
      agentToUse: "morpheus",
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
    bunExpect(promptArgs.body.tools.delegate_agent).toBe(true)
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
    bunExpect(result).toContain("JSON Parse error: Unexpected EOF")
    bunExpect(promptWithModelSuggestionRetry).toHaveBeenCalledTimes(1)
    bunExpect(promptSyncWithModelSuggestionRetry).toHaveBeenCalledTimes(0)
  })
})
