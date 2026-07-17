import { afterEach, describe, expect, it } from "bun:test"
import type { Managers } from "../create-managers"
import { _resetForTesting, getSessionAgent, updateSessionAgent } from "../features/claude-code-session-state"
import { getSessionModel, setSessionModel } from "../shared/session-model-state"
import { createEventHandler } from "./event"

type EventHandlerArgs = Parameters<typeof createEventHandler>[0]

function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve })
  return { promise, resolve: (value: T) => resolvePromise?.(value) }
}

afterEach(() => {
  _resetForTesting()
})

describe("plugin session deletion ordering", () => {
  it("#given deletion pauses in an earlier hook #when the same ID is recreated #then creation waits for lifecycle cleanup", async () => {
    const hookRelease = deferred<void>()
    const hookStarted = deferred<void>()
    const sessionID = "session-recreated-during-hook-fanout"
    let createCalls = 0
    const managers = {
      skillMcpManager: { disconnectSession: async () => {} },
      monitorManager: { stopSessionMonitors: async () => {}, handleEvent: () => {} },
      tmuxSessionManager: {
        onEvent: () => {},
        onSessionCreated: async () => {
          createCalls += 1
          if (createCalls !== 2) return
          updateSessionAgent(sessionID, "hephaestus")
          setSessionModel(sessionID, { providerID: "openai", modelID: "replacement" })
        },
        onSessionDeleted: async () => {},
      },
    } as Managers
    const handler = createEventHandler({
      ctx: {} as EventHandlerArgs["ctx"],
      pluginConfig: { tmux: { enabled: true } } as EventHandlerArgs["pluginConfig"],
      firstMessageVariantGate: { markSessionCreated: () => {}, clear: () => {} },
      managers,
      hooks: {
        autoUpdateChecker: {
          event: async (input) => {
            if (input.event.type !== "session.deleted") return
            hookStarted.resolve()
            await hookRelease.promise
          },
        },
      } as EventHandlerArgs["hooks"],
    })
    const createdEvent = {
      event: { type: "session.created", properties: { info: { id: sessionID } } },
    } as Parameters<typeof handler>[0]

    await handler(createdEvent)
    const deletion = handler({
      event: { type: "session.deleted", properties: { info: { id: sessionID } } },
    } as Parameters<typeof handler>[0])
    await hookStarted.promise
    let recreationSettled = false
    const recreation = handler(createdEvent).then(() => { recreationSettled = true })
    await Promise.resolve()

    expect(recreationSettled).toBe(false)
    hookRelease.resolve()
    await Promise.all([deletion, recreation])
    expect(getSessionAgent(sessionID)).toBe("hephaestus")
    expect(getSessionModel(sessionID)).toEqual({ providerID: "openai", modelID: "replacement" })
  })
})
