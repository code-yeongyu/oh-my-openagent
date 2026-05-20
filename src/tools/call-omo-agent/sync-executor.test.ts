import { unsafeTestValue } from "../../../test-support/unsafe-test-value"
import { describe, test, expect, mock } from "bun:test"

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
    maxOutputTokens?: number
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

function createContext(
  promptAsync: ReturnType<typeof mock>,
  status?: () => Promise<unknown>,
) {
  return {
    client: {
      session: {
        prompt: promptAsync,
        promptAsync,
        ...(status ? { status } : {}),
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

  test("removes invisible agent characters before sending the sync prompt", async () => {
    //#given
    const executeSync = await importExecuteSync()
    const deps = createDependencies()
    const toolContext = createToolContext()
    const recorder = createPromptAsyncRecorder()
    const args = {
      subagent_type: "\u200BSisyphus\u200B - Ultraworker",
      description: "test task",
      prompt: "find something",
      run_in_background: false,
    }

    //#when
    await executeSync(args, toolContext, createContext(recorder.promptAsync) as never, deps)

    //#then
    const promptInput = recorder.getCapturedInput()
    expect(promptInput?.body.agent).toBe("Sisyphus - Ultraworker")
  })

  test("#given subagent_type is the lowercase config key 'hephaestus' #when executeSync runs #then prompt receives the registered display name 'Hephaestus - Deep Agent'", async () => {
    //#given
    const executeSync = await importExecuteSync()
    const deps = createDependencies()
    const toolContext = createToolContext()
    const recorder = createPromptAsyncRecorder()
    const args = {
      subagent_type: "hephaestus",
      description: "task",
      prompt: "do the thing",
      run_in_background: false,
    }

    //#when
    await executeSync(args, toolContext, createContext(recorder.promptAsync) as never, deps)

    //#then — SDK rejects raw config keys with UnknownError; the dispatch must translate
    const promptInput = recorder.getCapturedInput()
    expect(promptInput?.body.agent).toBe("Hephaestus - Deep Agent")
  })

  test("#given subagent_type is the lowercase config key 'sisyphus-junior' #when executeSync runs #then prompt receives the registered display name 'Sisyphus-Junior'", async () => {
    //#given
    const executeSync = await importExecuteSync()
    const deps = createDependencies()
    const toolContext = createToolContext()
    const recorder = createPromptAsyncRecorder()
    const args = {
      subagent_type: "sisyphus-junior",
      description: "task",
      prompt: "do the thing",
      run_in_background: false,
    }

    //#when
    await executeSync(args, toolContext, createContext(recorder.promptAsync) as never, deps)

    //#then
    const promptInput = recorder.getCapturedInput()
    expect(promptInput?.body.agent).toBe("Sisyphus-Junior")
  })

  test("#given subagent_type is already a display name like 'explore' (config key == display name) #when executeSync runs #then prompt receives 'explore' unchanged", async () => {
    //#given a same-keyed agent must not be double-translated
    const executeSync = await importExecuteSync()
    const deps = createDependencies()
    const toolContext = createToolContext()
    const recorder = createPromptAsyncRecorder()
    const args = {
      subagent_type: "explore",
      description: "task",
      prompt: "do the thing",
      run_in_background: false,
    }

    //#when
    await executeSync(args, toolContext, createContext(recorder.promptAsync) as never, deps)

    //#then
    const promptInput = recorder.getCapturedInput()
    expect(promptInput?.body.agent).toBe("explore")
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

  test("registers child-session bootstrap and tracked prompt state before sync prompt dispatch", async () => {
    //#given
    const executeSync = await importExecuteSync()
    const { _resetForTesting, getSessionAgent } = require("../../features/claude-code-session-state")
    const { clearAllDelegatedChildSessionBootstrap, getDelegatedChildSessionBootstrap } = require("../../shared/delegated-child-session-bootstrap")
    const { clearSessionTools, getSessionTools } = require("../../shared/session-tools-store")
    const deps = createDependencies({
      createOrGetSession: mock(async () => ({ sessionID: "ses-call-bootstrap", isNew: true })),
    })
    const toolContext = createToolContext()
    const observed: Array<{
      agent: string | undefined
      tools: Record<string, boolean> | undefined
      bootstrap: ReturnType<typeof getDelegatedChildSessionBootstrap>
    }> = []
    const recorder = createPromptAsyncRecorder(async () => {
      observed.push({
        agent: getSessionAgent("ses-call-bootstrap"),
        tools: getSessionTools("ses-call-bootstrap"),
        bootstrap: getDelegatedChildSessionBootstrap("ses-call-bootstrap"),
      })
      return { data: {} }
    })
    const args = {
      subagent_type: "explore",
      description: "bootstrap state",
      prompt: "collect bootstrap evidence",
      run_in_background: false,
    }
    const fallbackChain = [
      { providers: ["openai"], model: "gpt-5.4", variant: "high" },
    ]

    try {
      //#when
      await executeSync(
        args,
        toolContext,
        createContext(recorder.promptAsync) as never,
        deps,
        fallbackChain
      )

      //#then
      expect(observed[0]?.agent).toBe("explore")
      expect(observed[0]?.tools?.question).toBe(false)
      expect(observed[0]?.tools?.task).toBe(false)
      expect(observed[0]?.bootstrap?.retryParts[0]?.text).toContain("collect bootstrap evidence")
      expect(observed[0]?.bootstrap?.tools?.question).toBe(false)
      expect(observed[0]?.bootstrap?.fallbackChain?.[0]?.model).toBe("gpt-5.4")
      expect(getDelegatedChildSessionBootstrap("ses-call-bootstrap")).toBeUndefined()
      // session-agent state for a sync session we created must be cleared after dispatch
      expect(getSessionAgent("ses-call-bootstrap")).toBeUndefined()
    } finally {
      clearAllDelegatedChildSessionBootstrap()
      clearSessionTools()
      _resetForTesting()
    }
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

  test("strips invisible sort prefixes before sending sync prompts", async () => {
    //#given
    const executeSync = await importExecuteSync()
    const deps = createDependencies()
    const toolContext = createToolContext()
    const recorder = createPromptAsyncRecorder()
    const args = {
      subagent_type: "\u200BSisyphus - Ultraworker",
      description: "prefixed agent",
      prompt: "find something",
      run_in_background: false,
    }

    //#when
    await executeSync(args, toolContext, createContext(recorder.promptAsync) as never, deps)

    //#then
    const promptInput = recorder.getCapturedInput()
    expect(promptInput?.body.agent).toBe("Sisyphus - Ultraworker")
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

  test("#given sync prompt returns ambiguous EOF after dispatch #when executeSync runs #then it waits for the existing session result", async () => {
    //#given
    const executeSync = await importExecuteSync()
    const deps = createDependencies({
      createOrGetSession: mock(async () => ({ sessionID: "ses-ambiguous-prompt", isNew: true })),
      waitForCompletion: mock(async () => {}),
      processMessages: mock(async () => "accepted response"),
    })
    const toolContext = createToolContext()
    const recorder = createPromptAsyncRecorder(async () => {
      throw new Error("JSON Parse error: Unexpected EOF")
    })
    const args = {
      subagent_type: "librarian",
      description: "ambiguous prompt",
      prompt: "find docs",
      run_in_background: false,
    }

    //#when
    const result = await executeSync(args, toolContext, createContext(recorder.promptAsync) as never, deps)

    //#then
    expect(result).toContain("accepted response")
    expect(result).toContain("session_id: ses-ambiguous-prompt")
    expect(deps.waitForCompletion).toHaveBeenCalledWith(
      "ses-ambiguous-prompt",
      toolContext,
      expect.objectContaining({ client: expect.anything() }),
    )
    expect(deps.processMessages).toHaveBeenCalledTimes(1)
  })

  test("does not send a duplicate sync prompt when a reused session is active", async () => {
    //#given
    const executeSync = await importExecuteSync()
    const deps = createDependencies({
      createOrGetSession: mock(async () => ({ sessionID: "ses-active-reuse", isNew: false })),
    })
    const toolContext = createToolContext()
    const recorder = createPromptAsyncRecorder()
    const args = {
      subagent_type: "explore",
      description: "active reuse",
      prompt: "find something",
      run_in_background: false,
      session_id: "ses-active-reuse",
    }

    //#when
    const result = await executeSync(
      args,
      toolContext,
      createContext(
        recorder.promptAsync,
        async () => ({ data: { "ses-active-reuse": { type: "busy" } } }),
      ) as never,
      deps,
    )

    //#then
    expect(recorder.promptAsync).toHaveBeenCalledTimes(0)
    expect(result).toContain("Error: Failed to send prompt")
    expect(result).toContain("session_id: ses-active-reuse")
    expect(deps.waitForCompletion).not.toHaveBeenCalled()
    expect(deps.processMessages).not.toHaveBeenCalled()
  })

  test("#given a reused sync session was just prompted #when executeSync is called again immediately #then the second prompt is rejected by the shared gate", async () => {
    //#given
    const executeSync = await importExecuteSync()
    const deps = createDependencies({
      createOrGetSession: mock(async () => ({ sessionID: "ses-reused-hold", isNew: false })),
    })
    const toolContext = createToolContext()
    const recorder = createPromptAsyncRecorder()
    const args = {
      subagent_type: "explore",
      description: "reused hold",
      prompt: "find something",
      run_in_background: false,
      session_id: "ses-reused-hold",
    }
    const context = createContext(recorder.promptAsync) as never

    //#when
    const first = await executeSync(args, toolContext, context, deps)
    const second = await executeSync(args, toolContext, context, deps)

    //#then
    expect(first).toContain("agent response")
    expect(second).toContain("prompt skipped by gate: reserved")
    expect(recorder.promptAsync).toHaveBeenCalledTimes(1)
    expect(deps.waitForCompletion).toHaveBeenCalledTimes(1)
    expect(deps.processMessages).toHaveBeenCalledTimes(1)
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
          prompt: mock(async () => ({ data: {} })),
          promptAsync: mock(async () => ({ data: {} })),
        },
      },
    }

    //#when
    await executeSync(args, toolContext, unsafeTestValue(ctx), deps, undefined, spawnReservation)

    //#then
    expect(spawnReservation.commit).toHaveBeenCalledTimes(1)
    expect(spawnReservation.rollback).toHaveBeenCalledTimes(0)
  })

  test("strips legacy ZWSP-prefixed agent names from persisted sync prompt body (GH-3259)", async () => {
    //#given - persisted sync invocation from v3.14.0-v3.16.0 with ZWSP prefix on subagent_type
    const executeSync = await importExecuteSync()
    const deps = createDependencies()
    const toolContext = createToolContext()
    const recorder = createPromptAsyncRecorder()
    const args = {
      subagent_type: "\u200B\u200BHephaestus - Deep Agent",
      description: "legacy zwsp",
      prompt: "find something",
      run_in_background: false,
    }

    //#when
    await executeSync(args, toolContext, createContext(recorder.promptAsync) as never, deps)

    //#then
    expect(recorder.getCapturedInput()?.body.agent).toBe("Hephaestus - Deep Agent")
  })
})

export {}
