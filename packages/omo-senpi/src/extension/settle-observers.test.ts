import { afterEach, expect, jest, test } from "bun:test"
import { FakeExtensionAPI, withInertSenpiSeams } from "../../test-support/fake-extension-api"
import { composeOmoSenpiExtension } from "./compose"
import type { ComponentLogger, SettleObserver } from "./types"

afterEach(() => jest.useRealTimers())

test("#given required status delivery #when its read exceeds the observer budget #then settlement still waits for delivery and the following observer remains bounded", async () => {
  const pi = new FakeExtensionAPI()
  const deliveryEntered = Promise.withResolvers<void>()
  const delivery = Promise.withResolvers<void>()
  const observerEntered = Promise.withResolvers<void>()
  const reflection = Promise.withResolvers<void>()
  const sequence: string[] = []
  await composeOmoSenpiExtension(
    [
      {
        name: "fixture",
        register(api) {
          api.on(
            "agent_settled",
            async () => {
              deliveryEntered.resolve()
              await delivery.promise
              sequence.push("delivered")
            },
            { settleDelivery: true },
          )
          api.on("agent_settled", () => {
            observerEntered.resolve()
            return reflection.promise
          })
        },
      },
    ],
    { logger: { info() {}, warn() {}, error() {} } },
  )(pi)
  jest.useFakeTimers()
  const settled = pi.dispatch("agent_settled", {}).then(() => {
    sequence.push("settled")
  })
  try {
    await deliveryEntered.promise
    jest.advanceTimersByTime(2_000)
    expect(sequence).toEqual([])
    delivery.resolve()
    await observerEntered.promise
    expect(sequence).toEqual(["delivered"])
    jest.advanceTimersByTime(2_000)
    await settled
    expect(sequence).toEqual(["delivered", "settled"])
  } finally {
    delivery.resolve()
    reflection.resolve()
    await settled
  }
})

test.each(["observer", "unrelated"] as const)(
  "#given a settle handler rejection (%s) #when it is not a known observer cancellation #then it propagates to the host",
  async (kind) => {
    const pi = new FakeExtensionAPI()
    const failure =
      kind === "observer" ? new DOMException("independent timeout", "TimeoutError") : new Error("independent failure")
    await composeOmoSenpiExtension(
      [
        {
          name: "fixture",
          register(api) {
            api.on("agent_settled", () => Promise.reject(failure))
          },
        },
      ],
      { logger: { info() {}, warn() {}, error() {} } },
    )(pi)
    const result = await pi.dispatch("agent_settled", {}).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(result).toBe(failure)
  },
)

test("#given concurrent settles of one session #when the newer settle supersedes the older #then the known cancellation is absorbed and the joiner completes", async () => {
  const pi = new FakeExtensionAPI()
  const entered = Promise.withResolvers<SettleObserver | undefined>()
  const joined = Promise.withResolvers<SettleObserver | undefined>()
  const shared = Promise.withResolvers<void>()
  const supersedeLogs: unknown[] = []
  let calls = 0
  await composeOmoSenpiExtension(
    [
      {
        name: "fixture",
        register(api) {
          api.on("agent_settled", (_payload, _ctx, observer) => {
            if (calls++ === 0) {
              observer?.signal.addEventListener("abort", () => shared.reject(observer.signal.reason), { once: true })
              entered.resolve(observer)
            } else joined.resolve(observer)
            return shared.promise
          })
        },
      },
    ],
    {
      logger: {
        info() {},
        error() {},
        warn: (_message, details) => {
          if ((details as { stage?: string } | undefined)?.stage === "superseded") supersedeLogs.push(details)
        },
      },
    },
  )(pi)
  const first = pi
    .dispatch("agent_settled", {}, { sessionManager: { getSessionId: () => "session" } })
    .catch((error: unknown) => error)
  await entered.promise
  const second = pi.dispatch("agent_settled", {}, { sessionManager: { getSessionId: () => "session" } }).then(
    (value) => value,
    (error: unknown) => error,
  )
  const joiner = await joined.promise
  try {
    shared.resolve()
    const results = await Promise.all([first, second])
    expect(joiner?.signal.aborted).toBe(false)
    expect(results.every((result) => !(result instanceof Error))).toBe(true)
    expect(supersedeLogs).toHaveLength(1)
  } finally {
    shared.resolve()
    await pi.dispatch("session_shutdown", {})
  }
})

test("#given a named subscriber that never resolves #when its budget expires #then observation aborts and the next subscriber executes", async () => {
  const pi = withInertSenpiSeams(new FakeExtensionAPI())
  const entered = Promise.withResolvers<SettleObserver | undefined>()
  const release = Promise.withResolvers<void>()
  const logs: unknown[] = []
  const logger: ComponentLogger = {
    info() {},
    error() {},
    warn: (_message, details) => {
      logs.push(details)
    },
  }
  let next = 0
  await composeOmoSenpiExtension(
    [
      {
        name: "fixture",
        register(api) {
          api.on(
            "agent_settled",
            (_payload, _ctx, observer) => {
              entered.resolve(observer)
              return release.promise
            },
            { hookLabel: "pending-write" },
          )
          api.on(
            "agent_settled",
            () => {
              next += 1
            },
            { hookLabel: "following" },
          )
        },
      },
    ],
    { logger },
  )(pi)
  jest.useFakeTimers()
  const dispatch = pi.dispatch("agent_settled", {}, { sessionManager: { getSessionId: () => "session" } })
  const observer = await entered.promise
  jest.advanceTimersByTime(2_000)
  try {
    await dispatch
    expect(observer?.signal.aborted).toBe(true)
    expect(next).toBe(1)
    expect(logs).toEqual([
      expect.objectContaining({
        event: "extension_handler_stalled",
        component: "fixture",
        hook: "pending-write",
        handlerEvent: "agent_settled",
        stage: "timeout",
        sessionId: "session",
      }),
    ])
  } finally {
    release.resolve()
    await pi.dispatch("session_shutdown", {})
  }
})

test("#given a pending settle #when its session retires #then the observer releases immediately and a late rejection is handled", async () => {
  const pi = new FakeExtensionAPI()
  const entered = Promise.withResolvers<SettleObserver | undefined>()
  const release = Promise.withResolvers<void>()
  let observer: SettleObserver | undefined
  await composeOmoSenpiExtension(
    [
      {
        name: "fixture",
        register(api) {
          api.on(
            "agent_settled",
            (_payload, _ctx, current) => {
              entered.resolve(current)
              return release.promise
            },
            { hookLabel: "pending" },
          )
        },
      },
    ],
    { logger: { info() {}, warn() {}, error() {} } },
  )(pi)
  const dispatch = pi.dispatch("agent_settled", {}, { sessionManager: { getSessionId: () => "retiring" } })
  observer = await entered.promise
  await pi.dispatch("session_shutdown", {}, { sessionManager: { getSessionId: () => "retiring" } })
  await dispatch
  expect(observer?.signal.aborted).toBe(true)
  release.reject(new Error("late I/O failure"))
  // The reaction to the real promise is the cleanup signal; no timing sleep.
  await release.promise.catch(() => undefined)
})
