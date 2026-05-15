import { describe, expect, test } from "bun:test"
import { createSessionRecoveryHook } from "./hook"

type RecoverableInfo = Parameters<ReturnType<typeof createSessionRecoveryHook>["handleSessionRecovery"]>[0]

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
})
