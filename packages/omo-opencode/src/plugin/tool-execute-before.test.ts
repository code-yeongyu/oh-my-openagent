const { afterEach, describe, expect, test } = require("bun:test")
const { createToolExecuteBeforeHandler } = require("./tool-execute-before")
const { createToolRegistry } = require("./tool-registry")
const { resetStorageClient } = require("../tools/session-manager/storage")
const { _resetForTesting: resetClaudeCodeSessionState, setMainSession } = require("../features/claude-code-session-state")
const {
  clearAllTurnHoldStateForTesting,
  hasPlanInCurrentTurn,
} = require("../features/background-agent/subagent-turn-hold-state")

describe("createToolExecuteBeforeHandler", () => {
  afterEach(() => {
    resetClaudeCodeSessionState()
    clearAllTurnHoldStateForTesting()
  })

  test("does not execute subagent question blocker hook for question tool", async () => {
    //#given
    const ctx = {
      client: {
        session: {
          messages: async () => ({ data: [] }),
        },
      },
    }

    const hooks = {
      subagentQuestionBlocker: {
        "tool.execute.before": async () => {
          throw new Error("subagentQuestionBlocker should not run")
        },
      },
    }

    const handler = createToolExecuteBeforeHandler({ ctx, hooks })
    const input = { tool: "question", sessionID: "ses_sub", callID: "call_1" }
    const output = { args: { questions: [] } as Record<string, unknown> }

    //#when
    const run = handler(input, output)

    //#then
    await expect(run).resolves.toBeUndefined()
  })

  test("triggers session notification hook for question tools", async () => {
    let called = false
    const ctx = {
      client: {
        session: {
          messages: async () => ({ data: [] }),
        },
      },
    }

    const hooks = {
      sessionNotification: async (input: { event: { type: string; properties?: Record<string, unknown> } }) => {
        called = true
        expect(input.event.type).toBe("tool.execute.before")
        expect(input.event.properties?.sessionID).toBe("ses_q")
        expect(input.event.properties?.tool).toBe("question")
      },
    }

    const handler = createToolExecuteBeforeHandler({ ctx, hooks })
    const input = { tool: "question", sessionID: "ses_q", callID: "call_q" }
    const output = { args: { questions: [{ question: "Proceed?", options: [{ label: "Yes" }] }] } as Record<string, unknown> }

    await handler(input, output)

    expect(called).toBe(true)
  })

  test("does not trigger session notification hook for non-question tools", async () => {
    let called = false
    const ctx = {
      client: {
        session: {
          messages: async () => ({ data: [] }),
        },
      },
    }

    const hooks = {
      sessionNotification: async () => {
        called = true
      },
    }

    const handler = createToolExecuteBeforeHandler({ ctx, hooks })

    await handler(
      { tool: "bash", sessionID: "ses_b", callID: "call_b" },
      { args: { command: "pwd" } as Record<string, unknown> },
    )

    expect(called).toBe(false)
  })

  test("runs compaction todo preserver before hook for todowrite", async () => {
    //#given
    let called = false
    const ctx = {
      client: {
        session: {
          messages: async () => ({ data: [] }),
        },
      },
    }
    const preservedTodos = [
      { content: "Preserved detailed task", status: "pending", priority: "high" },
    ]
    const hooks = {
      compactionTodoPreserver: {
        "tool.execute.before": async (
          input: { tool: string; sessionID: string; callID: string },
          output: { args: Record<string, unknown> },
        ) => {
          called = true
          expect(input.tool).toBe("todowrite")
          output.args.todos = preservedTodos
        },
      },
    }
    const handler = createToolExecuteBeforeHandler({ ctx, hooks })
    const output = { args: { todos: [] } as Record<string, unknown> }

    //#when
    await handler({ tool: "todowrite", sessionID: "ses_compact", callID: "call_todo" }, output)

    //#then
    expect(called).toBe(true)
    expect(output.args.todos).toBe(preservedTodos)
  })

  describe("task tool subagent_type normalization", () => {
    const emptyHooks = {}

    function createCtxWithSessionMessages(messages: Array<{ info?: { agent?: string; role?: string } }> = []) {
      return {
        client: {
          session: {
            messages: async () => ({ data: messages }),
          },
        },
      }
    }

    test("sets subagent_type to sisyphus-junior when category is provided without subagent_type", async () => {
      //#given
      const ctx = createCtxWithSessionMessages()
      const handler = createToolExecuteBeforeHandler({ ctx, hooks: emptyHooks })
      const input = { tool: "task", sessionID: "ses_123", callID: "call_1" }
      const output = { args: { category: "quick", description: "Test" } as Record<string, unknown> }

      //#when
      await handler(input, output)

      //#then
      expect(output.args.subagent_type).toBe("sisyphus-junior")
    })

    test("preserves existing subagent_type when explicitly provided", async () => {
      //#given
      const ctx = createCtxWithSessionMessages()
      const handler = createToolExecuteBeforeHandler({ ctx, hooks: emptyHooks })
      const input = { tool: "task", sessionID: "ses_123", callID: "call_1" }
      const output = { args: { subagent_type: "plan", description: "Plan test" } as Record<string, unknown> }

      //#when
      await handler(input, output)

      //#then
      expect(output.args.subagent_type).toBe("plan")
    })

    test("sets subagent_type to sisyphus-junior when category provided with different subagent_type", async () => {
      //#given
      const ctx = createCtxWithSessionMessages()
      const handler = createToolExecuteBeforeHandler({ ctx, hooks: emptyHooks })
      const input = { tool: "task", sessionID: "ses_123", callID: "call_1" }
      const output = { args: { category: "quick", subagent_type: "oracle", description: "Test" } as Record<string, unknown> }

      //#when
      await handler(input, output)

      //#then
      expect(output.args.subagent_type).toBe("sisyphus-junior")
    })

    test("resolves subagent_type from session first message when task_id is provided without subagent_type", async () => {
      //#given
      const ctx = createCtxWithSessionMessages([
        { info: { role: "user" } },
        { info: { role: "assistant", agent: "explore" } },
        { info: { role: "assistant", agent: "oracle" } },
      ])
      const handler = createToolExecuteBeforeHandler({ ctx, hooks: emptyHooks })
      const input = { tool: "task", sessionID: "ses_123", callID: "call_1" }
      const output = { args: { task_id: "ses_abc123", description: "Continue task", prompt: "fix it" } as Record<string, unknown> }

      //#when
      await handler(input, output)

      //#then
      expect(output.args.subagent_type).toBe("explore")
    })

    test("normalizes task_id into the canonical resume argument", async () => {
      //#given
      const ctx = createCtxWithSessionMessages([
        { info: { role: "assistant", agent: "oracle" } },
      ])
      const handler = createToolExecuteBeforeHandler({ ctx, hooks: emptyHooks })
      const input = { tool: "task", sessionID: "ses_123", callID: "call_1" }
      const output = { args: { task_id: "ses_resume_123", description: "Continue task", prompt: "fix it" } as Record<string, unknown> }

      //#when
      await handler(input, output)

      //#then
      expect(output.args.task_id).toBe("ses_resume_123")
      expect(output.args.subagent_type).toBe("oracle")
    })

    test("falls back to 'continue' when session has no agent info", async () => {
      //#given
      const ctx = createCtxWithSessionMessages([
        { info: { role: "user" } },
        { info: { role: "assistant" } },
      ])
      const handler = createToolExecuteBeforeHandler({ ctx, hooks: emptyHooks })
      const input = { tool: "task", sessionID: "ses_123", callID: "call_1" }
      const output = { args: { task_id: "ses_abc123", description: "Continue task", prompt: "fix it" } as Record<string, unknown> }

      //#when
      await handler(input, output)

      //#then
      expect(output.args.subagent_type).toBe("continue")
    })

    test("preserves subagent_type when task_id is provided with explicit subagent_type", async () => {
      //#given
      const ctx = createCtxWithSessionMessages()
      const handler = createToolExecuteBeforeHandler({ ctx, hooks: emptyHooks })
      const input = { tool: "task", sessionID: "ses_123", callID: "call_1" }
      const output = { args: { task_id: "ses_abc123", subagent_type: "explore", description: "Continue explore" } as Record<string, unknown> }

      //#when
      await handler(input, output)

      //#then
      expect(output.args.subagent_type).toBe("explore")
    })

    test("does not modify args for non-task tools", async () => {
      //#given
      const ctx = createCtxWithSessionMessages()
      const handler = createToolExecuteBeforeHandler({ ctx, hooks: emptyHooks })
      const input = { tool: "bash", sessionID: "ses_123", callID: "call_1" }
      const output = { args: { command: "ls" } as Record<string, unknown> }

      //#when
      await handler(input, output)

      //#then
      expect(output.args.subagent_type).toBeUndefined()
    })

    test("does not set subagent_type when neither category nor task_id is provided and subagent_type is present", async () => {
      //#given
      const ctx = createCtxWithSessionMessages()
      const handler = createToolExecuteBeforeHandler({ ctx, hooks: emptyHooks })
      const input = { tool: "task", sessionID: "ses_123", callID: "call_1" }
      const output = { args: { subagent_type: "oracle", description: "Oracle task" } as Record<string, unknown> }

      //#when
      await handler(input, output)

      //#then
      expect(output.args.subagent_type).toBe("oracle")
    })

    test("records a plan launch only for the main session", async () => {
      //#given
      setMainSession("ses_main")
      const ctx = createCtxWithSessionMessages()
      const handler = createToolExecuteBeforeHandler({ ctx, hooks: emptyHooks })
      const mainOutput = { args: { subagent_type: "plan", description: "Plan task" } as Record<string, unknown> }
      const childOutput = { args: { subagent_type: "plan", description: "Child plan task" } as Record<string, unknown> }

      //#when
      await handler({ tool: "task", sessionID: "ses_main", callID: "call_main" }, mainOutput)
      await handler({ tool: "task", sessionID: "ses_child", callID: "call_child" }, childOutput)

      //#then
      expect(hasPlanInCurrentTurn("ses_main")).toBe(true)
      expect(hasPlanInCurrentTurn("ses_child")).toBe(false)
    })

    test("awaits dropping held tasks for a normalized main-session plan before returning", async () => {
      //#given
      setMainSession("ses_main")
      let resolveDrop: (() => void) | undefined
      let dropCalls = 0
      let dropSettled = false
      const backgroundManager = {
        dropHeldTasks: async (sessionID: string) => {
          expect(sessionID).toBe("ses_main")
          dropCalls += 1
          await new Promise<void>((resolve) => {
            resolveDrop = resolve
          })
          dropSettled = true
        },
      }
      const handler = createToolExecuteBeforeHandler({
        ctx: createCtxWithSessionMessages(),
        hooks: emptyHooks,
        backgroundManager,
      })
      const run = handler(
        { tool: "task", sessionID: "ses_main", callID: "call_main" },
        { args: { subagent_type: "plan", description: "Plan task" } as Record<string, unknown> },
      )

      //#when
      await new Promise((resolve) => setTimeout(resolve, 0))

      //#then
      expect(dropCalls).toBe(1)
      expect(dropSettled).toBe(false)
      resolveDrop?.()
      await run
      expect(dropSettled).toBe(true)
    })

    test("does not drop main held tasks for a non-main plan", async () => {
      //#given
      setMainSession("ses_main")
      let dropCalls = 0
      const handler = createToolExecuteBeforeHandler({
        ctx: createCtxWithSessionMessages(),
        hooks: emptyHooks,
        backgroundManager: { dropHeldTasks: async () => { dropCalls += 1 } },
      })

      //#when
      await handler(
        { tool: "task", sessionID: "ses_child", callID: "call_child" },
        { args: { subagent_type: "plan", description: "Child plan task" } as Record<string, unknown> },
      )

      //#then
      expect(dropCalls).toBe(0)
      expect(hasPlanInCurrentTurn("ses_main")).toBe(false)
      expect(hasPlanInCurrentTurn("ses_child")).toBe(false)
    })

    test("records main explore and librarian launches without dropping held tasks", async () => {
      //#given
      setMainSession("ses_main")
      let dropCalls = 0
      const handler = createToolExecuteBeforeHandler({
        ctx: createCtxWithSessionMessages(),
        hooks: emptyHooks,
        backgroundManager: { dropHeldTasks: async () => { dropCalls += 1 } },
      })

      //#when
      await handler(
        { tool: "task", sessionID: "ses_main", callID: "call_explore" },
        { args: { subagent_type: "explore", description: "Explore task" } as Record<string, unknown> },
      )
      await handler(
        { tool: "task", sessionID: "ses_main", callID: "call_librarian" },
        { args: { subagent_type: "librarian", description: "Librarian task" } as Record<string, unknown> },
      )

      //#then
      expect(dropCalls).toBe(0)
      expect(hasPlanInCurrentTurn("ses_main")).toBe(false)
    })

    test("propagates a held-task drop failure after recording a main-session plan", async () => {
      //#given
      setMainSession("ses_main")
      const dropError = new Error("drop failed")
      const handler = createToolExecuteBeforeHandler({
        ctx: createCtxWithSessionMessages(),
        hooks: emptyHooks,
        backgroundManager: { dropHeldTasks: async () => { throw dropError } },
      })

      //#when
      const run = handler(
        { tool: "task", sessionID: "ses_main", callID: "call_main" },
        { args: { subagent_type: "plan", description: "Plan task" } as Record<string, unknown> },
      )

      //#then
      await expect(run).rejects.toBe(dropError)
      expect(hasPlanInCurrentTurn("ses_main")).toBe(true)
    })
  })
})

describe("createToolRegistry", () => {
  afterEach(() => {
    resetStorageClient()
    resetClaudeCodeSessionState()
    clearAllTurnHoldStateForTesting()
  })

  function createRegistryInput(overrides = {}) {
    return {
      ctx: {
        directory: process.cwd(),
        client: {
          session: {
            messages: async () => ({ data: [] }),
          },
        },
      },
      pluginConfig: {
        ...overrides,
      },
      managers: {
        backgroundManager: {},
        tmuxSessionManager: {},
        skillMcpManager: {},
      },
      skillContext: {
        mergedSkills: [],
        availableSkills: [],
        browserProvider: "playwright",
        disabledSkills: new Set(),
      },
      availableCategories: [],
    }
  }

  describe("#given hashline_edit is undefined", () => {
    describe("#when creating tool registry", () => {
      test("#then should not register edit tool", () => {
        const result = createToolRegistry(createRegistryInput())

        expect(result.filteredTools.edit).toBeUndefined()
      })
    })
  })

  describe("#given hashline_edit is true", () => {
    describe("#when creating tool registry", () => {
      test("#then should register edit tool", () => {
        const result = createToolRegistry(
          createRegistryInput({
            hashline_edit: true,
          }),
        )

        expect(result.filteredTools.edit).toBeDefined()
      })
    })
  })

  describe("#given max_tools is lower than or equal to builtin tool count", () => {
    describe("#when creating the tool registry", () => {
      test("#then it trims to the exact configured cap", () => {
        const baseline = createToolRegistry(createRegistryInput())
        const baselineToolCount = Object.keys(baseline.filteredTools).length

        const result = createToolRegistry(
          createRegistryInput({
            experimental: { max_tools: baselineToolCount },
          }),
        )

        expect(Object.keys(result.filteredTools)).toHaveLength(baselineToolCount)
      })
    })
  })

  describe("#given max_tools is set below the full plugin tool count", () => {
    describe("#when creating the tool registry", () => {
      test("#then it enforces the exact cap deterministically", () => {
        const result = createToolRegistry(
          createRegistryInput({
            experimental: { max_tools: 10 },
          }),
        )

        expect(Object.keys(result.filteredTools)).toHaveLength(10)
      })

      test("#then it keeps the task tool when lower-priority tools can satisfy the cap", () => {
        const result = createToolRegistry(
          createRegistryInput({
            experimental: { max_tools: 10 },
          }),
        )

        expect(result.filteredTools.task).toBeDefined()
      })
    })
  })
})

export {}
