const bunTest = require("bun:test")
const describeFn = bunTest.describe
const testFn = bunTest.test
const expectFn = bunTest.expect
const beforeEachFn = bunTest.beforeEach
const afterEachFn = bunTest.afterEach

const { executeBackgroundTask } = require("./background-task")
const { __setTimingConfig, __resetTimingConfig } = require("./timing")
const { SessionCategoryRegistry } = require("../../shared/session-category-registry")

describeFn("executeBackgroundTask output/session metadata compatibility", () => {
  beforeEachFn(() => {
    //#given - reduce waiting to keep tests fast
    __setTimingConfig({
      WAIT_FOR_SESSION_INTERVAL_MS: 1,
      WAIT_FOR_SESSION_TIMEOUT_MS: 50,
    })
  })

  afterEachFn(() => {
    __resetTimingConfig()
    SessionCategoryRegistry.clear()
  })

  testFn("does not emit synthetic pending session metadata when session id is unresolved", async () => {
    //#given - launched task without resolved subagent session id
    const metadataCalls: any[] = []
    const manager = {
      launch: async () => ({
        id: "bg_unresolved",
        sessionID: undefined,
        description: "Unresolved session",
        agent: "explore",
        status: "running",
      }),
      getTask: () => undefined,
    }

    const result = await executeBackgroundTask(
      {
        description: "Unresolved session",
        prompt: "check",
        run_in_background: true,
        load_skills: [],
      },
      {
        sessionID: "ses_parent",
        callID: "call_1",
        metadata: async (value: any) => metadataCalls.push(value),
        abort: new AbortController().signal,
      },
      { manager },
      { sessionID: "ses_parent", messageID: "msg_1" },
      "explore",
      undefined,
      undefined,
      undefined,
    )

    //#then - output and metadata should avoid fake session markers
    expectFn(result).not.toContain("<task_metadata>")
    expectFn(result).not.toContain("session_id: undefined")
    expectFn(result).not.toContain("session_id: pending")
    expectFn(metadataCalls).toHaveLength(1)
    expectFn("sessionId" in metadataCalls[0].metadata).toBe(false)
  })

  testFn("emits task metadata session_id when real session id is available", async () => {
    //#given - launched task with resolved subagent session id
    const metadataCalls: any[] = []
    const manager = {
      launch: async () => ({
        id: "bg_resolved",
        sessionID: "ses_sub_123",
        description: "Resolved session",
        agent: "explore",
        status: "running",
      }),
      getTask: () => ({ sessionID: "ses_sub_123" }),
    }

    const result = await executeBackgroundTask(
      {
        description: "Resolved session",
        prompt: "check",
        run_in_background: true,
        load_skills: [],
      },
      {
        sessionID: "ses_parent",
        callID: "call_2",
        metadata: async (value: any) => metadataCalls.push(value),
        abort: new AbortController().signal,
      },
      { manager },
      { sessionID: "ses_parent", messageID: "msg_2" },
      "explore",
      undefined,
      undefined,
      undefined,
    )

    //#then - output and metadata should include canonical session linkage
    expectFn(result).toContain("<task_metadata>")
    expectFn(result).toContain("session_id: ses_sub_123")
    expectFn(result).toContain("task_id: bg_resolved")
    expectFn(result).toContain("background_task_id: bg_resolved")
    expectFn(result).toContain("Background Task ID: bg_resolved")
    expectFn(metadataCalls).toHaveLength(1)
    expectFn(metadataCalls[0].metadata.sessionId).toBe("ses_sub_123")
  })

  testFn("captures late-resolved session id and emits synced metadata", async () => {
    //#given - background task session id appears after launch via manager polling
    const metadataCalls: any[] = []
    let reads = 0
    const manager = {
      launch: async () => ({
        id: "bg_late",
        sessionID: undefined,
        description: "Late session",
        agent: "explore",
        status: "running",
      }),
      getTask: () => {
        reads += 1
        return reads >= 2 ? { sessionID: "ses_late_123" } : undefined
      },
    }

    const result = await executeBackgroundTask(
      {
        description: "Late session",
        prompt: "check",
        run_in_background: true,
        load_skills: [],
      },
      {
        sessionID: "ses_parent",
        callID: "call_3",
        metadata: async (value: any) => metadataCalls.push(value),
        abort: new AbortController().signal,
      },
      { manager },
      { sessionID: "ses_parent", messageID: "msg_3" },
      "explore",
      undefined,
      undefined,
      undefined,
    )

    //#then - late session id still propagates to task metadata contract
    expectFn(result).toContain("session_id: ses_late_123")
    expectFn(result).toContain("task_id: bg_late")
    expectFn(result).toContain("background_task_id: bg_late")
    expectFn(metadataCalls).toHaveLength(1)
    expectFn(metadataCalls[0].metadata.sessionId).toBe("ses_late_123")
  })

  testFn("passes question-deny session permission when launching delegate task", async () => {
    //#given - delegate task background launch should deny question at session creation time
    const launchCalls: any[] = []
    const manager = {
      launch: async (input: any) => {
        launchCalls.push(input)
        return {
          id: "bg_permission",
          sessionID: "ses_permission_123",
          description: "Permission session",
          agent: "explore",
          status: "running",
        }
      },
      getTask: () => ({ sessionID: "ses_permission_123" }),
    }

    //#when
    await executeBackgroundTask(
      {
        description: "Permission session",
        prompt: "check",
        run_in_background: true,
        load_skills: [],
      },
      {
        sessionID: "ses_parent",
        callID: "call_4",
        metadata: async () => {},
        abort: new AbortController().signal,
      },
      { manager },
      { sessionID: "ses_parent", messageID: "msg_4" },
      "explore",
      undefined,
      undefined,
      undefined,
    )

    //#then
    expectFn(launchCalls).toHaveLength(1)
    expectFn(launchCalls[0].sessionPermission).toEqual([
      { permission: "question", action: "deny", pattern: "*" },
    ])
  })

  testFn("keeps launched background task alive when parent aborts before session id resolves", async () => {
    //#given - parallel tool execution can abort the parent call after launch succeeds
    const metadataCalls: any[] = []
    const abortController = new AbortController()
    const manager = {
      launch: async () => ({
        id: "bg_abort_after_launch",
        sessionID: undefined,
        description: "Abort after launch",
        agent: "explore",
        status: "pending",
      }),
      getTask: () => {
        abortController.abort()
        return { sessionID: undefined, status: "pending" }
      },
    }

    //#when
    const result = await executeBackgroundTask(
      {
        description: "Abort after launch",
        prompt: "check",
        run_in_background: true,
        load_skills: [],
      },
      {
        sessionID: "ses_parent",
        callID: "call_abort_after_launch",
        metadata: async (value: any) => metadataCalls.push(value),
        abort: abortController.signal,
      },
      { manager },
      { sessionID: "ses_parent", messageID: "msg_abort_after_launch" },
      "explore",
      undefined,
      undefined,
      undefined,
    )

    //#then - background launch should still succeed without fake abort failure
    expectFn(result).toContain("Background task launched")
    expectFn(result).toContain("Background Task ID: bg_abort_after_launch")
    expectFn(result).not.toContain("Task aborted while waiting for session to start")
    expectFn(metadataCalls).toHaveLength(1)
    expectFn("sessionId" in metadataCalls[0].metadata).toBe(false)
  })

  testFn("registers late session category even when parent aborts before session id resolves", async () => {
    //#given - session wiring should continue after returning early on parent abort
    const abortController = new AbortController()
    abortController.abort()
    let reads = 0
    const manager = {
      launch: async () => ({
        id: "bg_abort_category",
        sessionID: undefined,
        description: "Abort category",
        agent: "explore",
        status: "pending",
      }),
      getTask: () => {
        reads += 1
        return reads >= 2
          ? { sessionID: "ses_abort_category", status: "running" }
          : { sessionID: undefined, status: "pending" }
      },
    }

    //#when
    const result = await executeBackgroundTask(
      {
        description: "Abort category",
        prompt: "check",
        run_in_background: true,
        load_skills: [],
        category: "quick",
      },
      {
        sessionID: "ses_parent",
        callID: "call_abort_category",
        metadata: async () => {},
        abort: abortController.signal,
      },
      { manager },
      { sessionID: "ses_parent", messageID: "msg_abort_category" },
      "explore",
      undefined,
      undefined,
      [{ providers: ["openai"], model: "gpt-5.4" }],
    )

    await new Promise(resolve => setTimeout(resolve, 5))

    //#then - late session setup should still register category for runtime fallback
    expectFn(result).toContain("Background task launched")
    expectFn(SessionCategoryRegistry.get("ses_abort_category")).toBe("quick")
  })

  testFn("prefers child terminal status over parent abort while waiting for session id", async () => {
    //#given - failed child launch should not be misreported as a successful background launch
    const abortController = new AbortController()
    abortController.abort()
    const manager = {
      launch: async () => ({
        id: "bg_abort_terminal",
        sessionID: undefined,
        description: "Abort terminal",
        agent: "explore",
        status: "pending",
      }),
      getTask: () => ({ sessionID: undefined, status: "interrupt" }),
    }

    //#when
    const result = await executeBackgroundTask(
      {
        description: "Abort terminal",
        prompt: "check",
        run_in_background: true,
        load_skills: [],
      },
      {
        sessionID: "ses_parent",
        callID: "call_abort_terminal",
        metadata: async () => {},
        abort: abortController.signal,
      },
      { manager },
      { sessionID: "ses_parent", messageID: "msg_abort_terminal" },
      "explore",
      undefined,
      undefined,
      undefined,
    )

    //#then - terminal child status should win over abort and surface the failure
    expectFn(result).toContain("Task failed to start")
    expectFn(result).toContain("interrupt")
  })

  testFn("keeps sibling background launch alive when two tasks start concurrently", async () => {
    //#given - one aborted parent call should not interrupt a sibling launch from the same parent session
    const firstAbortController = new AbortController()
    const secondAbortController = new AbortController()
    const states = new Map([
      ["bg_first", { reads: 0, abortOnFirstRead: true, sessionID: "ses_first" }],
      ["bg_second", { reads: 0, abortOnFirstRead: false, sessionID: "ses_second" }],
    ])
    let launchCount = 0
    const manager = {
      launch: async () => {
        launchCount += 1
        return launchCount === 1
          ? { id: "bg_first", sessionID: undefined, description: "First", agent: "explore", status: "pending" }
          : { id: "bg_second", sessionID: undefined, description: "Second", agent: "explore", status: "pending" }
      },
      getTask: (taskID: string) => {
        const state = states.get(taskID)
        if (!state) return undefined
        state.reads += 1
        if (state.abortOnFirstRead && state.reads === 1) {
          firstAbortController.abort()
        }
        return state.reads >= 2
          ? { sessionID: state.sessionID, status: "running" }
          : { sessionID: undefined, status: "pending" }
      },
    }

    //#when
    const [firstResult, secondResult] = await Promise.all([
      executeBackgroundTask(
        {
          description: "First",
          prompt: "check",
          run_in_background: true,
          load_skills: [],
        },
        {
          sessionID: "ses_parent",
          callID: "call_first",
          metadata: async () => {},
          abort: firstAbortController.signal,
        },
        { manager },
        { sessionID: "ses_parent", messageID: "msg_first" },
        "explore",
        undefined,
        undefined,
        undefined,
      ),
      executeBackgroundTask(
        {
          description: "Second",
          prompt: "check",
          run_in_background: true,
          load_skills: [],
        },
        {
          sessionID: "ses_parent",
          callID: "call_second",
          metadata: async () => {},
          abort: secondAbortController.signal,
        },
        { manager },
        { sessionID: "ses_parent", messageID: "msg_second" },
        "explore",
        undefined,
        undefined,
        undefined,
      ),
    ])

    //#then - both tasks still launch and the sibling is not reported as interrupted
    expectFn(firstResult).toContain("Background task launched")
    expectFn(firstResult).not.toContain("Task failed to start")
    expectFn(secondResult).toContain("Background task launched")
    expectFn(secondResult).toContain("session_id: ses_second")
    expectFn(secondResult).not.toContain("interrupt")
  })
})
