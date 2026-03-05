const bunTest = require("bun:test")
const describeFn = bunTest.describe
const testFn = bunTest.test
const expectFn = bunTest.expect
const beforeEachFn = bunTest.beforeEach
const afterEachFn = bunTest.afterEach

const { executeBackgroundTask } = require("./background-task")
const { __setTimingConfig, __resetTimingConfig } = require("./timing")

describeFn("executeBackgroundTask output/session metadata compatibility", () => {
  beforeEachFn(() => {
    //#given - reduce waiting to keep tests fast
    __setTimingConfig({
      WAIT_FOR_SESSION_INTERVAL_MS: 1,
      WAIT_FOR_SESSION_TIMEOUT_MS: 2,
    })
  })

  afterEachFn(() => {
    __resetTimingConfig()
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
    expectFn(metadataCalls).toHaveLength(1)
    expectFn(metadataCalls[0].metadata.sessionId).toBe("ses_sub_123")
  })
})
