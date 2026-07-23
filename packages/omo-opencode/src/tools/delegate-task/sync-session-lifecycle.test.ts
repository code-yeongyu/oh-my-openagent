import { afterEach, describe, expect, mock, test } from "bun:test"

function clearRequireCache(modulePath: string): void {
  const resolvedPath = require.resolve(modulePath)
  if (require.cache?.[resolvedPath]) {
    delete require.cache[resolvedPath]
  }
}

type PromptDispatchOutcome = "prompt_dispatched" | "timeout"

function timeoutAfter(ms: number): Promise<PromptDispatchOutcome> {
  return new Promise((resolve) => {
    setTimeout(() => resolve("timeout"), ms)
  })
}

describe("executeSyncTask - sync session lifecycle ordering", () => {
  afterEach(() => {
    mock.restore()
    clearRequireCache("./sync-task")
    const { clearAllDelegatedChildSessionBootstrap } = require("../../shared/delegated-child-session-bootstrap")
    clearAllDelegatedChildSessionBootstrap()
  })

  test("#given sync session created callback waits for readiness #when executing sync task #then prompt dispatch is not blocked by the callback", async () => {
    //#given
    const mockClient = {
      session: {
        create: async () => ({ data: { id: "ignored" } }),
      },
    }
    const { executeSyncTask } = require("./sync-task")
    let releaseSyncCallback: () => void = () => {}
    const syncCallbackGate = new Promise<void>((resolve) => {
      releaseSyncCallback = resolve
    })
    let markSyncCallbackStarted: () => void = () => {}
    const syncCallbackStarted = new Promise<void>((resolve) => {
      markSyncCallbackStarted = resolve
    })
    const onSyncSessionCreated = mock(async (_event: { sessionID: string; parentID: string; title: string }) => {
      markSyncCallbackStarted()
      await syncCallbackGate
    })
    let markPromptDispatched: () => void = () => {}
    const promptDispatched = new Promise<void>((resolve) => {
      markPromptDispatched = resolve
    })
    const sendSyncPrompt = mock(async () => {
      markPromptDispatched()
      return null
    })
    const deps = {
      createSyncSession: async () => ({ ok: true as const, sessionID: "ses_ready_gate_sync" }),
      sendSyncPrompt,
      pollSyncSession: async () => null,
      fetchSyncResult: async () => ({ ok: true as const, textContent: "Result" }),
    }
    const mockCtx = {
      sessionID: "parent-session",
      agent: "sisyphus",
      callID: "call-123",
      metadata: () => {},
    }
    const mockExecutorCtx = {
      client: mockClient,
      manager: {
        assertCanSpawn: async () => ({ rootSessionID: "parent-session", parentDepth: 0, childDepth: 1 }),
      },
      directory: "/tmp",
      onSyncSessionCreated,
    }
    const args = {
      prompt: "test prompt",
      description: "test task",
      category: "test",
      load_skills: [],
      run_in_background: false,
      command: null,
    }

    //#when
    const resultPromise = executeSyncTask(args, mockCtx, mockExecutorCtx, {
      sessionID: "parent-session",
      agent: "sisyphus",
    }, "test-agent", undefined, undefined, undefined, undefined, deps)
    await syncCallbackStarted

    try {
      //#then
      const promptDispatchOutcome = await Promise.race<PromptDispatchOutcome>([
        promptDispatched.then(() => "prompt_dispatched"),
        timeoutAfter(250),
      ])
      expect(promptDispatchOutcome).toBe("prompt_dispatched")
      expect(sendSyncPrompt).toHaveBeenCalledTimes(1)
    } finally {
      releaseSyncCallback()
      await resultPromise
    }
  })
})
