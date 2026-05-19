import { afterEach, describe, expect, test } from "bun:test"
import { createSessionRecoveryHook } from "./hook"
import { _setInterruptedIdleMessagesFetchTimeoutMsForTesting } from "./interrupted-idle-message-fetch-timeout"
import { dispatchInternalPrompt, releaseAllPromptAsyncReservationsForTesting } from "../../shared/prompt-async-gate"

type RecoverableInfo = Parameters<ReturnType<typeof createSessionRecoveryHook>["handleSessionRecovery"]>[0]

type PromptAsyncCall = {
  path: { id: string }
  body: {
    parts: Array<{
      toolUseId?: string
      content?: Array<{ text?: string }>
    }>
    agent?: string
    model?: { providerID: string; modelID: string }
    variant?: string
  }
}

afterEach(() => {
  releaseAllPromptAsyncReservationsForTesting()
  _setInterruptedIdleMessagesFetchTimeoutMsForTesting(undefined)
})

function createPrefillErrorInfo(): RecoverableInfo {
  return {
    id: "msg_failed_prefill",
    role: "assistant",
    sessionID: "ses_recovery_dedupe",
    error: { message: "This model does not support assistant message prefill." },
  }
}

function createCountingCtx() {
  const counts = { abort: 0, messages: 0, promptAsync: 0, toast: 0 }
  const info = createPrefillErrorInfo()
  const ctx = {
    client: {
      session: {
        abort: async () => {
          counts.abort++
          return {}
        },
        messages: async () => {
          counts.messages++
          return {
            data: [
              {
                info: {
                  id: info.id,
                  role: "assistant",
                  error: info.error,
                },
              },
            ],
          }
        },
        promptAsync: async () => {
          counts.promptAsync++
          return {}
        },
      },
      tui: {
        showToast: async () => {
          counts.toast++
          return {}
        },
      },
    },
    directory: "/tmp/session-recovery-dedupe-test",
  }
  return { ctx, counts, info }
}

describe("session-recovery hook persistent dedupe", () => {
  test("#given the same recoverable session.error fires twice for the same assistant message id #when handleSessionRecovery is called twice in sequence #then recovery side effects run only once", async () => {
    // given
    const { ctx, counts, info } = createCountingCtx()
    const hook = createSessionRecoveryHook(ctx as never)

    // when
    await hook.handleSessionRecovery(info)
    await hook.handleSessionRecovery(info)

    // then
    expect(counts.abort).toBe(1)
    expect(counts.toast).toBe(1)
    expect(counts.promptAsync).toBe(0)
  })

  test("#given a recovered assistant message id is later reused by a stale duplicate session.error #when handleSessionRecovery is called for that stale duplicate #then recovery is suppressed", async () => {
    // given
    const { ctx, counts, info } = createCountingCtx()
    const hook = createSessionRecoveryHook(ctx as never)

    // when
    await hook.handleSessionRecovery(info)
    await Promise.resolve()
    const result = await hook.handleSessionRecovery(info)

    // then
    expect(result).toBe(false)
    expect(counts.abort).toBe(1)
  })

  test("#given recovery is blocked by a peer prompt reservation #when the same error is observed after the reservation clears #then recovery retries once", async () => {
    // given
    const sessionID = "ses_recovery_gate_block"
    const promptAsyncCalls: PromptAsyncCall[] = []
    let releasePeerPrompt: (() => void) | undefined
    const peerPrompt = new Promise<void>((resolve) => {
      releasePeerPrompt = resolve
    })
    const peerReservation = dispatchInternalPrompt({
      mode: "async",
      client: {
        session: {
          promptAsync: async () => {
            await peerPrompt
          },
        },
      },
      sessionID,
      input: { path: { id: sessionID }, body: { parts: [{ type: "text", text: "peer" }] } },
      source: "test:peer-recovery-blocker",
      settleMs: 0,
    })
    await Promise.resolve()

    const info: RecoverableInfo = {
      id: "msg_tool_missing",
      role: "assistant",
      sessionID,
      error: { message: "messages.2 has tool_use without a matching tool_result" },
    }
    const ctx = {
      client: {
        session: {
          abort: async () => ({}),
          messages: async () => ({
            data: [
              {
                info: {
                  id: info.id,
                  role: "assistant",
                  error: info.error,
                },
                parts: [
                  {
                    type: "tool_use",
                    id: "toolu_recovery_gate",
                    name: "bash",
                    input: {},
                    state: { status: "running" },
                  },
                ],
              },
            ],
          }),
          promptAsync: async (call: PromptAsyncCall) => {
            promptAsyncCalls.push(call)
            return {}
          },
        },
        tui: {
          showToast: async () => ({}),
        },
      },
      directory: "/tmp/session-recovery-gate-test",
    }
    const hook = createSessionRecoveryHook(ctx as never)

    // when
    const firstResult = await hook.handleSessionRecovery(info)
    releasePeerPrompt?.()
    await peerReservation
    releaseAllPromptAsyncReservationsForTesting()
    const secondResult = await hook.handleSessionRecovery(info)

    // then
    expect(firstResult).toBe(false)
    expect(secondResult).toBe(true)
    expect(promptAsyncCalls).toHaveLength(1)
  })
})

describe("session-recovery hook interrupted idle recovery", () => {
  test("#given idle session has an unfinished assistant turn with pending tool parts #when idle recovery runs #then it injects only interrupted tool results once", async () => {
    // given
    const promptAsyncCalls: PromptAsyncCall[] = []
    const ctx = {
      client: {
        session: {
          status: async () => ({ data: { ses_idle_interrupted: { type: "idle" } } }),
          messages: async () => ({
            data: [
              {
                info: {
                  id: "msg_user",
                  role: "user",
                  agent: "Sisyphus",
                  model: { providerID: "anthropic", modelID: "claude-opus-4-7", variant: "max" },
                },
                parts: [{ type: "text", text: "run /init-deep ultrafucking deep" }],
              },
              {
                info: {
                  id: "msg_assistant_unfinished",
                  role: "assistant",
                  sessionID: "ses_idle_interrupted",
                  finish: "tool-calls",
                  time: { created: 1778995446058, completed: 1778995447058 },
                },
                parts: [
                  {
                    type: "tool",
                    callID: "call_completed",
                    name: "bash",
                    input: {},
                    state: { status: "completed" },
                  },
                  {
                    type: "tool_use",
                    id: "toolu_running",
                    callID: "prt_not_a_tool_use_id",
                    name: "bash",
                    input: {},
                    state: { status: "running" },
                  },
                  {
                    type: "tool_use",
                    id: "toolu_pending",
                    callID: "also_not_a_tool_use_id",
                    name: "task",
                    input: {},
                    state: { status: "pending" },
                  },
                ],
              },
            ],
          }),
          promptAsync: async (call: PromptAsyncCall) => {
            promptAsyncCalls.push(call)
            return {}
          },
        },
      },
      directory: "/tmp/session-recovery-idle-test",
    }
    const hook = createSessionRecoveryHook(ctx as never)

    // when
    const firstResult = await hook.handleInterruptedToolResultsOnIdle("ses_idle_interrupted")
    const secondResult = await hook.handleInterruptedToolResultsOnIdle("ses_idle_interrupted")

    // then
    expect(firstResult).toBe(true)
    expect(secondResult).toBe(false)
    expect(promptAsyncCalls).toHaveLength(1)
    expect(promptAsyncCalls[0]?.body.parts.map((part) => part.toolUseId)).toEqual([
      "toolu_running",
      "toolu_pending",
    ])
    expect(promptAsyncCalls[0]?.body.parts[0]?.content?.[0]?.text).toBe(
      "Tool execution was interrupted before producing a result.",
    )
    expect(promptAsyncCalls[0]?.body.agent).toBe("Sisyphus")
    expect(promptAsyncCalls[0]?.body.model).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-7" })
    expect(promptAsyncCalls[0]?.body.variant).toBe("max")
  })

  test("#given session.messages hangs during idle recovery #when timeout elapses #then idle recovery returns false", async () => {
    // given
    _setInterruptedIdleMessagesFetchTimeoutMsForTesting(5)
    const ctx = {
      client: {
        session: {
          messages: async () => new Promise(() => {}),
          promptAsync: async () => ({}),
        },
      },
      directory: "/tmp/session-recovery-timeout-test",
    }
    const hook = createSessionRecoveryHook(ctx as never)

    // when
    const result = await hook.handleInterruptedToolResultsOnIdle("ses_messages_hangs")

    // then
    expect(result).toBe(false)
  })

  test("#given a newer user turn follows an unfinished assistant turn #when idle recovery runs #then it does not recover the stale assistant", async () => {
    // given
    const promptAsyncCalls: PromptAsyncCall[] = []
    const ctx = {
      client: {
        session: {
          messages: async () => ({
            data: [
              {
                info: {
                  id: "msg_stale_assistant",
                  role: "assistant",
                  sessionID: "ses_stale_after_user",
                  finish: "tool-calls",
                },
                parts: [
                  {
                    type: "tool_use",
                    id: "toolu_stale_pending",
                    name: "bash",
                    input: {},
                    state: { status: "pending" },
                  },
                ],
              },
              {
                info: {
                  id: "msg_newer_user",
                  role: "user",
                },
                parts: [{ type: "text", text: "new prompt after interrupted turn" }],
              },
            ],
          }),
          promptAsync: async (call: PromptAsyncCall) => {
            promptAsyncCalls.push(call)
            return {}
          },
        },
      },
      directory: "/tmp/session-recovery-newer-user-test",
    }
    const hook = createSessionRecoveryHook(ctx as never)

    // when
    const result = await hook.handleInterruptedToolResultsOnIdle("ses_stale_after_user")

    // then
    expect(result).toBe(false)
    expect(promptAsyncCalls).toHaveLength(0)
  })
})
