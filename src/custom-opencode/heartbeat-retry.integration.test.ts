import { describe, expect, it } from "bun:test"

import { createHeartbeatStatusRuntime as createHeartbeatStatusRuntimeUntyped } from "../../assets/custom-opencode/plugins/heartbeat-status.js"
import {
  createTlsCertificateRetryRuntime as createTlsCertificateRetryRuntimeUntyped,
} from "../../assets/custom-opencode/plugins/tls-certificate-retry.js"

type HeartbeatHook = (...args: any[]) => Promise<void>
type RetryHook = (...args: any[]) => Promise<void>

type HeartbeatRuntime = {
  hooks: Record<string, HeartbeatHook>
  getSessionSnapshot: (sessionID: string) => any
}

type RetrySignal =
  | {
      state: "retrying"
      attempt: number
      message: string
      next: number
    }
  | {
      state: "failed"
      error: unknown
      hardProviderBlock: boolean
    }

type RetryRuntime = {
  hooks: Record<string, RetryHook>
}

type ScheduledTimer = {
  id: number
  delay: number
  callback: () => unknown
}

const createHeartbeatStatusRuntime = createHeartbeatStatusRuntimeUntyped as (options: Record<string, unknown>) => HeartbeatRuntime
const createTlsCertificateRetryRuntime = createTlsCertificateRetryRuntimeUntyped as (options: Record<string, unknown>) => RetryRuntime

function createTimerController() {
  let nextID = 1
  const activeTimers = new Map<number, ScheduledTimer>()
  const getActiveTimers = () => Array.from(activeTimers.values())

  return {
    setTimeoutFn(callback: () => unknown, delay: number) {
      const timer = {
        id: nextID++,
        delay,
        callback,
      }

      activeTimers.set(timer.id, timer)
      return timer.id as unknown as ReturnType<typeof setTimeout>
    },

    clearTimeoutFn(timerID: ReturnType<typeof setTimeout>) {
      activeTimers.delete(timerID as unknown as number)
    },

    getActiveTimers,
  }
}

function createMockClient() {
  const toasts: Array<Record<string, unknown>> = []
  const logs: Array<Record<string, unknown>> = []
  const promptCalls: Array<Record<string, unknown>> = []

  return {
    client: {
      tui: {
        showToast: async ({ body }: { body: Record<string, unknown> }) => {
          toasts.push(body)
          return true
        },
      },
      app: {
        log: async ({ body }: { body: Record<string, unknown> }) => {
          logs.push(body)
          return true
        },
      },
      session: {
        messages: async () => ({ data: [] }),
        promptAsync: async (payload: Record<string, unknown>) => {
          promptCalls.push(payload)
          return true
        },
      },
    },
    logs,
    promptCalls,
    toasts,
  }
}

function createIntegrationHarness() {
  const timers = createTimerController()
  const mock = createMockClient()
  let currentTime = 25_000

  const heartbeat = createHeartbeatStatusRuntime({
    client: mock.client,
    now: () => currentTime,
    setIntervalFn: () => ({}) as ReturnType<typeof setInterval>,
    clearIntervalFn: () => {},
  })

  const retry = createTlsCertificateRetryRuntime({
    client: mock.client,
    directory: "E:/projects/ohmyopencode/oh-my-openagent",
    now: () => currentTime,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    onStateChange: async (sessionID: string, signal: RetrySignal) => {
      if (signal.state === "retrying") {
        await heartbeat.hooks.event?.({
          event: {
            type: "session.status",
            properties: {
              sessionID,
              status: {
                type: "retry",
                attempt: signal.attempt,
                message: signal.message,
                next: signal.next,
              },
            },
          },
        })

        return
      }

      await heartbeat.hooks.event?.({
        event: {
          type: "session.error",
          properties: {
            sessionID,
            error: signal.error,
          },
        },
      })
    },
  })

  return {
    heartbeat,
    hooks: {
      heartbeat: heartbeat.hooks,
      retry: retry.hooks,
    },
    promptCalls: mock.promptCalls,
    setCurrentTime(value: number) {
      currentTime = value
    },
    timers,
  }
}

describe("heartbeat and retry integration", () => {
  it("moves heartbeat from a retryable failure into the retrying state when TLS retry schedules recovery", async () => {
    const { heartbeat, hooks, setCurrentTime, timers } = createIntegrationHarness()
    setCurrentTime(25_000)

    await hooks.heartbeat["chat.message"]?.(
      {
        sessionID: "ses_retrying",
        agent: "sisyphus",
      },
      {
        message: { role: "user" },
        parts: [],
      },
    )

    await hooks.retry["chat.message"]?.(
      {
        sessionID: "ses_retrying",
        agent: "sisyphus",
      },
      {
        message: { role: "user" },
        parts: [{ type: "text", text: "Recover from transient TLS failures only." }],
      },
    )

    const retryableError = {
      message: "unable to verify the first certificate",
    }

    await hooks.heartbeat.event?.({
      event: {
        type: "session.error",
        properties: {
          sessionID: "ses_retrying",
          error: retryableError,
        },
      },
    })

    expect(heartbeat.getSessionSnapshot("ses_retrying").state).toBe("failed")

    await hooks.retry.event?.({
      event: {
        type: "session.error",
        properties: {
          sessionID: "ses_retrying",
          error: retryableError,
        },
      },
    })

    const snapshot = heartbeat.getSessionSnapshot("ses_retrying")

    expect(timers.getActiveTimers()).toHaveLength(1)
    expect(snapshot.state).toBe("retrying")
    expect(snapshot.retry).toMatchObject({
      attempt: 1,
      message: "unable to verify the first certificate",
    })
    expect(snapshot.detailText).toContain("Следующая попытка")
  })

  it("keeps heartbeat failed and clears pending retry state on a hard provider block", async () => {
    const { heartbeat, hooks, promptCalls, timers } = createIntegrationHarness()

    await hooks.heartbeat["chat.message"]?.(
      {
        sessionID: "ses_failed",
        agent: "prometheus",
      },
      {
        message: { role: "user" },
        parts: [],
      },
    )

    await hooks.retry["chat.message"]?.(
      {
        sessionID: "ses_failed",
        agent: "prometheus",
      },
      {
        message: { role: "user" },
        parts: [{ type: "text", text: "Only retry network and certificate issues." }],
      },
    )

    const retryableError = {
      message: "socket hang up",
    }

    await hooks.retry.event?.({
      event: {
        type: "session.error",
        properties: {
          sessionID: "ses_failed",
          error: retryableError,
        },
      },
    })

    expect(heartbeat.getSessionSnapshot("ses_failed").state).toBe("retrying")
    expect(timers.getActiveTimers()).toHaveLength(1)

    const hardProviderBlock = {
      statusCode: 403,
      message: "Blocked by a gateway or proxy. Check your account and provider settings.",
    }

    await hooks.heartbeat.event?.({
      event: {
        type: "session.error",
        properties: {
          sessionID: "ses_failed",
          error: hardProviderBlock,
        },
      },
    })

    await hooks.retry.event?.({
      event: {
        type: "session.error",
        properties: {
          sessionID: "ses_failed",
          error: hardProviderBlock,
        },
      },
    })

    const snapshot = heartbeat.getSessionSnapshot("ses_failed")

    expect(timers.getActiveTimers()).toHaveLength(0)
    expect(promptCalls).toHaveLength(0)
    expect(snapshot.state).toBe("failed")
    expect(snapshot.hardProviderBlock).toBe(true)
    expect(snapshot.detailText).toContain("исправления настроек")
  })
})
