import { describe, expect, it } from "bun:test"

import {
  RETRY_DELAY_MS,
  createTlsCertificateRetryRuntime as createTlsCertificateRetryRuntimeUntyped,
} from "../../assets/custom-opencode/plugins/tls-certificate-retry.js"

type RetryHook = (...args: any[]) => Promise<void>

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
  getSessionRetryState: (sessionID: string) => any
}

type ScheduledTimer = {
  id: number
  delay: number
  callback: () => unknown
}

const createTlsCertificateRetryRuntime = createTlsCertificateRetryRuntimeUntyped as (options: Record<string, unknown>) => RetryRuntime

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return {
    promise,
    resolve,
    reject,
  }
}

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

    runNext() {
      const timer = getActiveTimers()[0]

      if (!timer) {
        throw new Error("No active timer to run")
      }

      activeTimers.delete(timer.id)
      return Promise.resolve(timer.callback())
    },
  }
}

function createMockClient({
  promptAsyncImpl,
  sessionMessages,
}: {
  promptAsyncImpl?: (payload: Record<string, unknown>) => Promise<unknown>
  sessionMessages?: unknown[]
} = {}) {
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
        messages: async () => ({
          data: sessionMessages ?? [],
        }),
        promptAsync: async (payload: Record<string, unknown>) => {
          promptCalls.push(payload)

          if (promptAsyncImpl) {
            return promptAsyncImpl(payload)
          }

          return true
        },
      },
    },
    logs,
    promptCalls,
    toasts,
  }
}

function createRuntime(options: {
  now?: () => number
  onStateChange?: (sessionID: string, signal: RetrySignal) => Promise<void>
  promptAsyncImpl?: (payload: Record<string, unknown>) => Promise<unknown>
  sessionMessages?: unknown[]
} = {}) {
  const timers = createTimerController()
  const mock = createMockClient({
    promptAsyncImpl: options.promptAsyncImpl,
    sessionMessages: options.sessionMessages,
  })

  const runtime = createTlsCertificateRetryRuntime({
    client: mock.client,
    directory: "E:/projects/ohmyopencode/oh-my-openagent",
    now: options.now ?? (() => 10_000),
    onStateChange: options.onStateChange,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  })

  return {
    ...mock,
    hooks: runtime.hooks,
    runtime,
    timers,
  }
}

describe("tls certificate retry plugin", () => {
  it("schedules one retry for retryable TLS failures and re-dispatches the last user payload", async () => {
    const signals: RetrySignal[] = []
    const { hooks, promptCalls, runtime, timers } = createRuntime({
      onStateChange: async (_sessionID, signal) => {
        signals.push(signal)
      },
    })

    await hooks["chat.message"]?.(
      {
        sessionID: "ses_tls",
        agent: "atlas",
        variant: "xhigh",
        model: {
          providerID: "openai",
          modelID: "gpt-5.4",
        },
      },
      {
        message: {
          role: "user",
          system: "Focus on retry behavior.",
          tools: [{ id: "read" }],
        },
        parts: [{ type: "text", text: "Retry this request if TLS fails." }],
      },
    )

    await hooks.event?.({
      event: {
        type: "session.error",
        properties: {
          sessionID: "ses_tls",
          error: {
            message: "unknown certificate verification error",
          },
        },
      },
    })

    expect(timers.getActiveTimers()).toHaveLength(1)
    expect(timers.getActiveTimers()[0]?.delay).toBe(RETRY_DELAY_MS)
    expect(runtime.getSessionRetryState("ses_tls")).toMatchObject({
      state: "retrying",
      attempt: 1,
      scheduled: true,
      payloadCached: true,
    })
    expect(signals).toEqual([
      {
        state: "retrying",
        attempt: 1,
        message: "unknown certificate verification error",
        next: 10_000 + RETRY_DELAY_MS,
      },
    ])

    await timers.runNext()

    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0]).toMatchObject({
      path: { id: "ses_tls" },
      query: { directory: "E:/projects/ohmyopencode/oh-my-openagent" },
      body: {
        agent: "atlas",
        variant: "xhigh",
        system: "Focus on retry behavior.",
        tools: [{ id: "read" }],
        model: {
          providerID: "openai",
          modelID: "gpt-5.4",
        },
        parts: [{ type: "text", text: "Retry this request if TLS fails." }],
      },
    })
    expect(runtime.getSessionRetryState("ses_tls")).toMatchObject({
      state: "retrying",
      attempt: 1,
      scheduled: false,
      dispatchInFlight: false,
    })
  })

  it("prevents duplicate timer scheduling and duplicate dispatch on repeated connectivity errors", async () => {
    const signals: RetrySignal[] = []
    const dispatchDeferred = createDeferred<unknown>()
    const { hooks, promptCalls, timers } = createRuntime({
      onStateChange: async (_sessionID, signal) => {
        signals.push(signal)
      },
      promptAsyncImpl: async () => dispatchDeferred.promise,
    })

    await hooks["chat.message"]?.(
      {
        sessionID: "ses_dedupe",
        agent: "sisyphus",
      },
      {
        message: { role: "user" },
        parts: [{ type: "text", text: "Keep my last payload cached." }],
      },
    )

    const retryableErrorEvent = {
      event: {
        type: "session.error",
        properties: {
          sessionID: "ses_dedupe",
          error: {
            message: "socket hang up",
          },
        },
      },
    }

    await hooks.event?.(retryableErrorEvent)
    await hooks.event?.(retryableErrorEvent)

    expect(timers.getActiveTimers()).toHaveLength(1)
    expect(signals.filter((signal) => signal.state === "retrying")).toHaveLength(1)

    const retryDispatch = timers.runNext()

    expect(promptCalls).toHaveLength(1)

    await hooks.event?.(retryableErrorEvent)

    expect(timers.getActiveTimers()).toHaveLength(0)
    expect(promptCalls).toHaveLength(1)

    dispatchDeferred.resolve(true)
    await retryDispatch

    expect(promptCalls).toHaveLength(1)
  })

  it("stops automatic retry immediately on a hard provider block", async () => {
    const signals: RetrySignal[] = []
    const { hooks, promptCalls, runtime, timers } = createRuntime({
      onStateChange: async (_sessionID, signal) => {
        signals.push(signal)
      },
    })

    await hooks["chat.message"]?.(
      {
        sessionID: "ses_blocked",
        agent: "prometheus",
      },
      {
        message: { role: "user" },
        parts: [{ type: "text", text: "Retry only if the network is flaky." }],
      },
    )

    await hooks.event?.({
      event: {
        type: "session.error",
        properties: {
          sessionID: "ses_blocked",
          error: {
            message: "network error: unable to connect",
          },
        },
      },
    })

    expect(timers.getActiveTimers()).toHaveLength(1)

    await hooks.event?.({
      event: {
        type: "session.error",
        properties: {
          sessionID: "ses_blocked",
          error: {
            statusCode: 403,
            message: "Blocked by a gateway or proxy. Check your account and provider settings.",
          },
        },
      },
    })

    expect(timers.getActiveTimers()).toHaveLength(0)
    expect(promptCalls).toHaveLength(0)
    expect(runtime.getSessionRetryState("ses_blocked")).toMatchObject({
      state: "failed",
      hardProviderBlock: true,
      scheduled: false,
    })
    expect(signals.at(-1)).toMatchObject({
      state: "failed",
      hardProviderBlock: true,
    })

    await hooks.event?.({
      event: {
        type: "session.error",
        properties: {
          sessionID: "ses_blocked",
          error: {
            message: "socket hang up",
          },
        },
      },
    })

    expect(timers.getActiveTimers()).toHaveLength(0)
    expect(promptCalls).toHaveLength(0)
  })
})
