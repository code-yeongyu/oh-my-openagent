const { describe, test, expect, mock } = require("bun:test")

type ExecuteSync = typeof import("./sync-executor").executeSync

type PromptAsyncInput = {
  path: { id: string }
  body: {
    agent: string
    tools: Record<string, boolean>
    parts: Array<{ type: string; text: string }>
    model?: { providerID: string; modelID: string }
    variant?: string
    temperature?: number
    topP?: number
    options?: Record<string, unknown>
  }
}

type ToolContext = {
  sessionID: string
  messageID: string
  agent: string
  abort: AbortSignal
  metadata: ReturnType<typeof mock>
}

type Dependencies = {
  createOrGetSession: ReturnType<typeof mock>
  waitForCompletion: ReturnType<typeof mock>
  processMessages: ReturnType<typeof mock>
  setSessionFallbackChain: ReturnType<typeof mock>
  clearSessionFallbackChain: ReturnType<typeof mock>
}

async function importExecuteSync(): Promise<ExecuteSync> {
  const module = await import("./sync-executor")
  return module.executeSync
}

function createDependencies(overrides?: Partial<Dependencies>): Dependencies {
  return {
    createOrGetSession: mock(async () => ({ sessionID: "ses-test-123", isNew: true })),
    waitForCompletion: mock(async () => {}),
    processMessages: mock(async () => "agent response"),
    setSessionFallbackChain: mock(() => {}),
    clearSessionFallbackChain: mock(() => {}),
    ...overrides,
  }
}

function createPromptAsyncRecorder(implementation?: (input: PromptAsyncInput) => Promise<unknown>) {
  let capturedInput: PromptAsyncInput | undefined

  const promptAsync = mock(async (input: PromptAsyncInput) => {
    capturedInput = input
    if (implementation) {
      return implementation(input)
    }

    return { data: {} }
  })

  return {
    promptAsync,
    getCapturedInput(): PromptAsyncInput | undefined {
      return capturedInput
    },
  }
}

function createToolContext(): ToolContext {
  return {
    sessionID: "parent-session",
    messageID: "msg-1",
    agent: "sisyphus",
    abort: new AbortController().signal,
    metadata: mock(async () => {}),
  }
}

function createContext(promptAsync: ReturnType<typeof mock>) {
  return {
    client: {
      session: {
        promptAsync,
      },
    },
  }
}

describe("executeSync", () => {
  test("sends sync prompt with question and task tools disabled", async () => {
    //#given
    const executeSync = await importExecuteSync()
    const deps = createDependencies()
    const toolContext = createToolContext()
    const recorder = createPromptAsyncRecorder()
    const args = {
      subagent_type: "explore",
      description: "test task",
      prompt: "find something",
      run_in_background: false,
    }

    //#when
    await executeSync(args, toolContext, createContext(recorder.promptAsync) as never, deps)

    //#then
    const promptInput = recorder.getCapturedInput()
    expect(promptInput).toBeDefined()
    expect(promptInput?.path.id).toBe("ses-test-123")
    expect(promptInput?.body.agent).toBe("explore")
    expect(promptInput?.body.tools.question).toBe(false)
    expect(promptInput?.body.tools.task).toBe(false)
    expect(promptInput?.body.parts).toEqual([{ type: "text", text: "find something" }])
  })

  test("returns processed response with task metadata footer", async () => {
    //#given
    const executeSync = await importExecuteSync()
    const deps = createDependencies({
      createOrGetSession: mock(async () => ({ sessionID: "ses-test-456", isNew: true })),
      processMessages: mock(async () => "final answer"),
    })
    const toolContext = createToolContext()
    const recorder = createPromptAsyncRecorder()
    const args = {
      subagent_type: "librarian",
      description: "search docs",
      prompt: "find docs",
      run_in_background: false,
    }

    //#when
    const result = await executeSync(args, toolContext, createContext(recorder.promptAsync) as never, deps)

    //#then
    expect(result).toContain("final answer")
    expect(result).toContain("<task_metadata>")
    expect(result).toContain("session_id: ses-test-456")
    expect(result).toContain("</task_metadata>")
    expect(deps.waitForCompletion).toHaveBeenCalledWith(
      "ses-test-456",
      toolContext,
      expect.objectContaining({ client: expect.anything() })
    )
  })

  test("forwards delegated model tuning params in the sync prompt body", async () => {
    //#given
    const executeSync = await importExecuteSync()
    const deps = createDependencies()
    const toolContext = createToolContext()
    const recorder = createPromptAsyncRecorder()
    const args = {
      subagent_type: "explore",
      description: "test task",
      prompt: "find something",
      run_in_background: false,
    }
    const model = {
      providerID: "openai",
      modelID: "gpt-5.4",
      variant: "high",
      temperature: 0.12,
      top_p: 0.34,
      maxTokens: 5678,
      reasoningEffort: "medium",
      thinking: { type: "disabled" as const },
    }

    //#when
    await executeSync(
      args,
      toolContext,
      createContext(recorder.promptAsync) as never,
      deps,
      undefined,
      undefined,
      model,
    )

    //#then
    const promptInput = recorder.getCapturedInput()
    expect(promptInput?.body.model).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4",
    })
    expect(promptInput?.body.variant).toBe("high")
    expect(promptInput?.body.temperature).toBe(0.12)
    expect(promptInput?.body.topP).toBe(0.34)
    expect(promptInput?.body.options).toEqual({
      reasoningEffort: "medium",
      thinking: { type: "disabled" },
    })
    expect(promptInput?.body.maxOutputTokens).toBe(5678)
  })

  test("records metadata with description and created session id", async () => {
    //#given
    const executeSync = await importExecuteSync()
    const deps = createDependencies({
      createOrGetSession: mock(async () => ({ sessionID: "ses-metadata", isNew: true })),
    })
    const toolContext = createToolContext()
    const recorder = createPromptAsyncRecorder()
    const args = {
      subagent_type: "explore",
      description: "metadata title",
      prompt: "collect evidence",
      run_in_background: false,
    }

    //#when
    await executeSync(args, toolContext, createContext(recorder.promptAsync) as never, deps)

    //#then
    expect(toolContext.metadata).toHaveBeenCalledWith({
      title: "metadata title",
      metadata: { sessionId: "ses-metadata" },
    })
  })

  test("applies fallback chain to sync sessions before completion polling", async () => {
    //#given
    const executeSync = await importExecuteSync()
    const deps = createDependencies({
      createOrGetSession: mock(async () => ({ sessionID: "ses-fallback", isNew: true })),
    })
    const toolContext = createToolContext()
    const recorder = createPromptAsyncRecorder()
    const args = {
      subagent_type: "explore",
      description: "test task",
      prompt: "find something",
      run_in_background: false,
    }
    const fallbackChain = [
      { providers: ["quotio"], model: "kimi-k2.5", variant: undefined },
      { providers: ["openai"], model: "gpt-5.2", variant: "high" },
    ]

    //#when
    await executeSync(
      args,
      toolContext,
      createContext(recorder.promptAsync) as never,
      deps,
      fallbackChain
    )

    //#then
    expect(deps.setSessionFallbackChain).toHaveBeenCalledWith("ses-fallback", fallbackChain)
  })

  test("returns dedicated agent-not-found error with task metadata", async () => {
    //#given
    const executeSync = await importExecuteSync()
    const deps = createDependencies({
      createOrGetSession: mock(async () => ({ sessionID: "ses-missing-agent", isNew: true })),
    })
    const toolContext = createToolContext()
    const recorder = createPromptAsyncRecorder(async () => {
      throw new Error("agent.name is undefined")
    })
    const args = {
      subagent_type: "explore",
      description: "missing agent",
      prompt: "find something",
      run_in_background: false,
    }

    //#when
    const result = await executeSync(args, toolContext, createContext(recorder.promptAsync) as never, deps)

    //#then
    expect(result).toContain('Error: Agent "explore" not found')
    expect(result).toContain("session_id: ses-missing-agent")
    expect(deps.waitForCompletion).not.toHaveBeenCalled()
    expect(deps.processMessages).not.toHaveBeenCalled()
  })

  test("returns generic prompt failure with task metadata", async () => {
    //#given
    const executeSync = await importExecuteSync()
    const deps = createDependencies({
      createOrGetSession: mock(async () => ({ sessionID: "ses-prompt-error", isNew: true })),
    })
    const toolContext = createToolContext()
    const recorder = createPromptAsyncRecorder(async () => {
      throw new Error("network exploded")
    })
    const args = {
      subagent_type: "librarian",
      description: "generic failure",
      prompt: "find docs",
      run_in_background: false,
    }

    //#when
    const result = await executeSync(args, toolContext, createContext(recorder.promptAsync) as never, deps)

    //#then
    expect(result).toContain("Error: Failed to send prompt: network exploded")
    expect(result).toContain("session_id: ses-prompt-error")
    expect(deps.waitForCompletion).not.toHaveBeenCalled()
    expect(deps.processMessages).not.toHaveBeenCalled()
  })

  test("commits reserved descendant quota after creating a new sync session", async () => {
    //#given
    const { executeSync } = require("./sync-executor")

    const deps = {
      createOrGetSession: mock(async () => ({ sessionID: "ses-test-789", isNew: true })),
      waitForCompletion: mock(async () => {}),
      processMessages: mock(async () => "agent response"),
      setSessionFallbackChain: mock(() => {}),
      clearSessionFallbackChain: mock(() => {}),
    }

    const spawnReservation = {
      commit: mock(() => 1),
      rollback: mock(() => {}),
    }

    const args = {
      subagent_type: "explore",
      description: "test task",
      prompt: "find something",
    }

    const toolContext = {
      sessionID: "parent-session",
      messageID: "msg-4",
      agent: "sisyphus",
      abort: new AbortController().signal,
      metadata: mock(async () => {}),
    }

    const ctx = {
      client: {
        session: {
          promptAsync: mock(async () => ({ data: {} })),
        },
      },
    }

    //#when
    await executeSync(args, toolContext, ctx as any, deps, undefined, spawnReservation)

    //#then
    expect(spawnReservation.commit).toHaveBeenCalledTimes(1)
    expect(spawnReservation.rollback).toHaveBeenCalledTimes(0)
  })
})

export {}
