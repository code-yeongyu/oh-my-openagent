const { describe, test, expect, mock } = require("bun:test")

describe("sendSyncPrompt", () => {
  test("passes question=false via tools parameter", async () => {
    //#given
    const { sendSyncPrompt } = require("./sync-prompt-sender")

    let promptArgs: any
    const promptAsync = mock(async (input: any) => {
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
    await sendSyncPrompt(mockClient as any, input)

    //#then
    expect(promptAsync).toHaveBeenCalled()
    expect(promptArgs.body.tools.question).toBe(false)
  })

  test("applies agent tool restrictions for explore agent", async () => {
    //#given
    const { sendSyncPrompt } = require("./sync-prompt-sender")

    let promptArgs: any
    const promptAsync = mock(async (input: any) => {
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
    await sendSyncPrompt(mockClient as any, input)

    //#then
    expect(promptAsync).toHaveBeenCalled()
    expect(promptArgs.body.tools.call_omo_agent).toBe(false)
  })

  test("applies agent tool restrictions for librarian agent", async () => {
    //#given
    const { sendSyncPrompt } = require("./sync-prompt-sender")

    let promptArgs: any
    const promptAsync = mock(async (input: any) => {
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
    await sendSyncPrompt(mockClient as any, input)

    //#then
    expect(promptAsync).toHaveBeenCalled()
    expect(promptArgs.body.tools.call_omo_agent).toBe(false)
  })

  test("does not restrict call_omo_agent for sisyphus agent", async () => {
    //#given
    const { sendSyncPrompt } = require("./sync-prompt-sender")

    let promptArgs: any
    const promptAsync = mock(async (input: any) => {
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
    await sendSyncPrompt(mockClient as any, input)

    //#then
    expect(promptAsync).toHaveBeenCalled()
    expect(promptArgs.body.tools.call_omo_agent).toBe(true)
  })
})
