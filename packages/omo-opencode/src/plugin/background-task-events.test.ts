import { afterEach, expect, spyOn, test } from "bun:test"

import type { PluginInput } from "@opencode-ai/plugin"
import { BackgroundManager } from "../features/background-agent/manager"
import { createContinuationHooks } from "./hooks/create-continuation-hooks"
import { createEventHookDispatcher, createEventHookRunner } from "./event-hook-dispatcher"
import type { CreatedHooks } from "../create-hooks"
import type { EventInput } from "./event-types"
import { createRuntimeFallbackHook } from "../hooks/runtime-fallback/hook"
import { installRuntimeFallbackTestClock } from "../hooks/runtime-fallback/test-timeout-clock.test-support"
import { releaseAllPromptAsyncReservationsForTesting } from "../shared/prompt-async-gate"

const asInput = (input: unknown): EventInput => input as EventInput

const managers: BackgroundManager[] = []

afterEach(() => { for (const manager of managers.splice(0)) manager.shutdown() })

function fixture(notifications: boolean, isRecoveryPending = (_id: string) => false) {
  const ctx = { directory: "/tmp/pr7857-unit", client: { session: { abort: async () => ({}) } } } as unknown as PluginInput
  const manager = new BackgroundManager({ pluginContext: ctx })
  managers.push(manager)
  const continuation = createContinuationHooks({
    ctx, pluginConfig: {}, backgroundManager: manager, safeHookEnabled: false,
    isHookEnabled: name => notifications && name === "background-notification",
    isRecoveryPending,
  })
  return { manager, continuation }
}
const terminal = { event: { type: "session.error", properties: {
  sessionID: "child", error: { name: "ProviderModelNotFoundError", message: "Model not found: qa/missing" },
} } }

for (const notifications of [false, true]) {
  test(`#given notifications=${notifications} #when terminal lifecycle arrives #then manager receives it exactly once`, async () => {
    const { manager, continuation } = fixture(notifications)
    const forwarded = spyOn(manager, "handleEvent")
    const injected = spyOn(manager, "injectPendingNotificationsIntoChatMessage")
    const clock = spyOn(Date, "now").mockReturnValue(1000)
    try {
      const dispatch = createEventHookDispatcher(continuation as CreatedHooks, createEventHookRunner())
      await dispatch(asInput(terminal))
      clock.mockReturnValue(21000)
      expect(forwarded).toHaveBeenCalledTimes(1)
      expect(manager.getTerminalChildError("child")).toBe(terminal.event.properties.error.message)
      await dispatch(asInput({ event: { type: "session.deleted", properties: { sessionID: "child" } } }))
      expect(forwarded).toHaveBeenCalledTimes(2)
      expect(manager.getTerminalChildError("child")).toBeNull()
      await continuation.backgroundNotificationHook?.["chat.message"]({ sessionID: "child" }, { parts: [] })
      expect(injected).toHaveBeenCalledTimes(notifications ? 1 : 0)
    } finally { clock.mockRestore(); forwarded.mockRestore(); injected.mockRestore() }
  })
}

test("#given recovery decision and awaiting retry #when old grace expires #then error stays hidden until recovery ends", async () => {
  let awaiting = false
  const { manager, continuation } = fixture(true, () => awaiting)
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const clock = spyOn(Date, "now").mockReturnValue(1000)
  const dispatch = createEventHookDispatcher({ ...continuation, runtimeFallback: { event: async () => {
    entered.resolve()
    await release.promise
    awaiting = true
  } } } as CreatedHooks, createEventHookRunner())
  const running = dispatch(asInput(terminal))
  try {
    await entered.promise
    clock.mockReturnValue(21000)
    expect(manager.getTerminalChildError("child")).toBeNull()
    release.resolve()
    await running
    expect(manager.getTerminalChildError("child")).toBeNull()
    awaiting = false
    expect(manager.getTerminalChildError("child")).toBe(terminal.event.properties.error.message)
  } finally { release.resolve(); await running; clock.mockRestore() }
}, 2000)

for (const outcome of ["accepted", "failed"] as const) {
  test(`#given real runtime fallback ${outcome} #when dispatch is held beyond grace #then visibility follows retry state`, async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const runtimeFallback = createRuntimeFallbackHook({
      directory: "/tmp/pr7857-unit",
      client: {
        session: {
          abort: async () => ({}),
          messages: async () => ({ data: [{ info: { role: "user", agent: "sisyphus" }, parts: [{ type: "text", text: "retry" }] }] }),
          promptAsync: async () => { entered.resolve(); await release.promise; if (outcome === "failed") throw new Error("invalid request"); return {} },
        },
        tui: { showToast: async () => ({}) },
      },
    }, { config: { enabled: true, timeout_seconds: 0, notify_on_fallback: false },
      pluginConfig: { agents: { sisyphus: { model: "qa/missing", fallback_models: ["qa/recovered"] } } },
    })
    const { manager, continuation } = fixture(false, id => runtimeFallback.isRecoveryPending(id))
    const dispatch = createEventHookDispatcher({ ...continuation, runtimeFallback } as CreatedHooks, createEventHookRunner())
    const clock = spyOn(Date, "now").mockReturnValue(1000)
    const running = dispatch(asInput({ event: { ...terminal.event, properties: { ...terminal.event.properties, agent: "sisyphus", model: "qa/missing" } } }))
    try {
      await entered.promise
      clock.mockReturnValue(61000)
      expect(runtimeFallback.isRecoveryPending("child")).toBe(true)
      expect(manager.getTerminalChildError("child")).toBeNull()
      release.resolve()
      await running
      expect(runtimeFallback.isRecoveryPending("child")).toBe(outcome === "accepted")
      expect(manager.getTerminalChildError("child")).toBe(outcome === "accepted" ? null : terminal.event.properties.error.message)
      if (outcome === "accepted") {
        await dispatch(asInput({ event: { type: "message.updated", properties: { info: {
          id: "recovered", sessionID: "child", role: "assistant", providerID: "qa", modelID: "recovered", finish: "stop",
        }, parts: [{ type: "text", text: "recovered" }] } } }))
        expect(manager.getTerminalChildError("child")).toBeNull()
      }
      await dispatch(asInput({ event: { type: "session.deleted", properties: { sessionID: "child" } } }))
      expect(runtimeFallback.isRecoveryPending("child")).toBe(false)
      expect(manager.getTerminalChildError("child")).toBeNull()
    } finally { release.resolve(); await running; clock.mockRestore(); runtimeFallback.dispose?.(); releaseAllPromptAsyncReservationsForTesting() }
  }, 2000)
}

for (const reason of ["declined", "exhausted", "exception"] as const) {
  test(`#given recovery ${reason} #when decision finishes #then terminal error becomes visible immediately`, async () => {
    const runtimeFallback = createRuntimeFallbackHook({
      directory: "/tmp/pr7857-unit",
      client: { session: { abort: async () => ({}), messages: async () => ({ data: [] }),
        promptAsync: async () => { throw new Error("unexpected dispatch") } }, tui: { showToast: async () => ({}) } },
    }, { config: { enabled: true, max_fallback_attempts: 0, notify_on_fallback: false },
      pluginConfig: { agents: { sisyphus: { model: "qa/missing", fallback_models: reason === "declined" ? [] : ["qa/recovered"] } } },
    })
    const { manager, continuation } = fixture(false, id => runtimeFallback.isRecoveryPending(id))
    const event = reason === "exception" ? async () => { throw new Error("hook failed") } : runtimeFallback.event
    const dispatch = createEventHookDispatcher({ ...continuation, runtimeFallback: { ...runtimeFallback, event } } as CreatedHooks, createEventHookRunner())
    try {
      await dispatch(asInput({ event: { ...terminal.event, properties: { ...terminal.event.properties, agent: "sisyphus", model: "qa/missing" } } }))
      expect(runtimeFallback.isRecoveryPending("child")).toBe(false)
      expect(manager.getTerminalChildError("child")).toBe(terminal.event.properties.error.message)
    } finally { runtimeFallback.dispose?.() }
  })
}

test("#given overlapping error decisions #when one completes #then the other still hides the error", async () => {
  const { manager, continuation } = fixture(false)
  const first = continuation.backgroundTaskEvents.beginDecision(asInput(terminal))
  const second = continuation.backgroundTaskEvents.beginDecision(asInput(terminal))
  await continuation.backgroundTaskEvents.event(asInput(terminal))
  first?.()
  expect(manager.getTerminalChildError("child")).toBeNull()
  second?.()
  expect(manager.getTerminalChildError("child")).toBe(terminal.event.properties.error.message)
})

for (const terminalReason of ["exhausted", "no-models"] as const) {
  test(`#given accepted fallback then ${terminalReason} #when real timeout finishes #then terminal latch is visible`, async () => {
    const clock = installRuntimeFallbackTestClock(1000)
    const agent = { model: "qa/missing", fallback_models: ["qa/recovered"] }
    let aborts = 0
    const runtime = createRuntimeFallbackHook({ directory: "/tmp/pr7857-unit", client: {
      session: { abort: async () => { aborts++; return {} },
        messages: async () => ({ data: [{ info: { role: "user", agent: "sisyphus" }, parts: [{ type: "text", text: "retry" }] }] }),
        promptAsync: async () => ({}), }, tui: { showToast: async () => ({}) },
    } }, { config: { enabled: true, timeout_seconds: 30, max_fallback_attempts: 1, notify_on_fallback: false },
      session_timeout_ms: 1, pluginConfig: { agents: { sisyphus: agent } },
    })
    const { manager, continuation } = fixture(false, runtime.isRecoveryPending)
    const dispatch = createEventHookDispatcher({ ...continuation, runtimeFallback: runtime } as CreatedHooks, createEventHookRunner())
    try {
      await dispatch(asInput({ event: { ...terminal.event, properties: { ...terminal.event.properties, agent: "sisyphus", model: "qa/missing" } } }))
      expect(runtime.isRecoveryPending("child")).toBe(true)
      expect(manager.getTerminalChildError("child")).toBeNull()
      if (terminalReason === "no-models") agent.fallback_models = []
      await clock.advanceBy(1)
      expect(aborts).toBe(1)
      expect(runtime.isRecoveryPending("child")).toBe(false)
      expect(manager.getTerminalChildError("child")).toBe(terminal.event.properties.error.message)
    } finally { runtime.dispose?.(); releaseAllPromptAsyncReservationsForTesting(); clock.restore() }
  }, 2000)
}
