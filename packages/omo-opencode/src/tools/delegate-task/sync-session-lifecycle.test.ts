import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import { _resetForTesting } from "../../features/claude-code-session-state"
import { clearAllDelegatedChildSessionBootstrap } from "../../shared/delegated-child-session-bootstrap"
import type { ExecutorContext, ParentContext } from "./executor-types"
import { registerSyncSessionSideEffects } from "./sync-session-lifecycle"
import type { DelegateTaskArgs } from "./types"

function createArgs(): DelegateTaskArgs {
  return {
    description: "sync tmux callback ordering",
    prompt: "do sync work",
    category: "quick",
    run_in_background: false,
    load_skills: [],
  }
}

function createExecutorContext(
  onSyncSessionCreated: ExecutorContext["onSyncSessionCreated"]
): ExecutorContext {
  return {
    client: {} as ExecutorContext["client"],
    directory: "/tmp",
    manager: {} as ExecutorContext["manager"],
    onSyncSessionCreated,
  }
}

const parentContext: ParentContext = {
  sessionID: "ses_parent",
  messageID: "msg_parent",
  agent: "sisyphus",
}

describe("registerSyncSessionSideEffects", () => {
  beforeEach(() => {
    _resetForTesting()
    clearAllDelegatedChildSessionBootstrap()
  })

  afterEach(() => {
    _resetForTesting()
    clearAllDelegatedChildSessionBootstrap()
    mock.restore()
  })

  test("returns without waiting for a blocking onSyncSessionCreated callback", async () => {
    // given
    const events: string[] = []
    let resolveCallback: () => void = () => {}
    const blockingCallback = new Promise<void>((resolve) => {
      resolveCallback = resolve
    })

    const onSyncSessionCreated = mock(async () => {
      events.push("callback.start")
      await blockingCallback
      events.push("callback.end")
    })

    const registerPromise = registerSyncSessionSideEffects({
      args: createArgs(),
      executorCtx: createExecutorContext(onSyncSessionCreated),
      sessionID: "ses_sync_tmux_deadlock",
      parentContext,
      agentToUse: "sisyphus-junior",
      categoryModel: undefined,
      fallbackChain: undefined,
      systemContent: undefined,
    }).then(() => {
      events.push("register.return")
    })

    await Promise.resolve()

    // when
    const result = await Promise.race([
      registerPromise.then(() => "resolved" as const),
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 25)),
    ])

    try {
      // then
      expect(events).toContain("callback.start")
      expect(events).not.toContain("callback.end")
      expect(result).toBe("resolved")
      expect(events).toContain("register.return")
      expect(onSyncSessionCreated).toHaveBeenCalledTimes(1)
      expect(onSyncSessionCreated.mock.calls[0]?.[0]).toEqual({
        sessionID: "ses_sync_tmux_deadlock",
        parentID: "ses_parent",
        title: "sync tmux callback ordering",
      })
    } finally {
      resolveCallback()
      await registerPromise
    }
  })
})
