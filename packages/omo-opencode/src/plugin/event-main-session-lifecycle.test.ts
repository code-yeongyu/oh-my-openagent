import { afterEach, describe, expect, it } from "bun:test"
import type { Managers } from "../create-managers"
import {
  _resetForTesting,
  getSessionAgent,
  getMainSessionID,
  isMainSession,
  updateSessionAgent,
} from "../features/claude-code-session-state"
import { getSessionModel, setSessionModel } from "../shared/session-model-state"
import { getSessionPromptParams, setSessionPromptParams } from "../shared/session-prompt-params-state"
import { handleSessionCreatedEvent, handleSessionDeletedEvent } from "./event-session-lifecycle"
import type { FirstMessageVariantGate, PluginEventContext } from "./event-types"

const pluginContext = { directory: "/tmp" } as PluginEventContext
const pluginConfig = {} as never
const firstMessageVariantGate: FirstMessageVariantGate = {
  markSessionCreated: () => {},
  clear: () => {},
}
const managers = {
  skillMcpManager: { disconnectSession: async () => {} },
  tmuxSessionManager: {
    onSessionCreated: async () => {},
    onSessionDeleted: async () => {},
  },
} as Managers
const sessionDeletionTasks = new Map<string, Promise<void>>()

afterEach(() => {
  _resetForTesting()
  sessionDeletionTasks.clear()
})

async function createRoot(sessionID?: string): Promise<void> {
  await handleSessionCreatedEvent({
    event: {
      type: "session.created",
      properties: { info: sessionID ? { id: sessionID } : {} },
    },
    props: { info: sessionID ? { id: sessionID } : {} },
    tmuxIntegrationEnabled: false,
    pluginConfig,
    pluginContext,
    managers,
    firstMessageVariantGate,
    sessionDeletionTasks,
  })
}

describe("main session lifecycle", () => {
  it("#given roots A and B #when root B is deleted #then root A remains active and becomes current", async () => {
    await createRoot("root-a")
    await createRoot("root-b")

    await handleSessionDeletedEvent({
      props: { info: { id: "root-b" } },
      tmuxIntegrationEnabled: false,
      pluginConfig,
      pluginContext,
      managers,
      firstMessageVariantGate,
      clearModelFallbackSession: () => {},
      sessionDeletionTasks,
    })

    expect(getMainSessionID()).toBe("root-a")
    expect(isMainSession("root-a")).toBe(true)
    expect(isMainSession("root-b")).toBe(false)
  })

  it("#given an active root #when session.created has no ID #then current identity and membership are preserved", async () => {
    await createRoot("root-preserved")

    await createRoot()

    expect(getMainSessionID()).toBe("root-preserved")
    expect(isMainSession("root-preserved")).toBe(true)
  })

  it("#given deletion pauses during monitor cleanup #when the same ID is recreated #then stale cleanup cannot clear or disconnect replacement state", async () => {
    const sessionID = "root-reused-during-delete"
    let releaseMonitor: (() => void) | undefined
    const monitorBlocked = new Promise<void>((resolve) => { releaseMonitor = resolve })
    let monitorStartedResolve: (() => void) | undefined
    const monitorStarted = new Promise<void>((resolve) => { monitorStartedResolve = resolve })
    let disconnectCalls = 0
    const lifecycleCalls: string[] = []
    const raceManagers = {
      monitorManager: {
        stopSessionMonitors: async () => { monitorStartedResolve?.(); await monitorBlocked },
      },
      skillMcpManager: { disconnectSession: async () => { disconnectCalls += 1; lifecycleCalls.push("disconnect") } },
      tmuxSessionManager: {
        onSessionCreated: async () => {
          lifecycleCalls.push("create")
          updateSessionAgent(sessionID, "hephaestus")
          setSessionModel(sessionID, { providerID: "openai", modelID: "new-generation-model" })
          setSessionPromptParams(sessionID, { temperature: 0.7 })
        },
        onSessionDeleted: async () => {},
      },
    } as Managers

    await createRoot(sessionID)
    const deletion = handleSessionDeletedEvent({
      props: { info: { id: sessionID } },
      tmuxIntegrationEnabled: false,
      pluginConfig,
      pluginContext,
      managers: raceManagers,
      firstMessageVariantGate,
      clearModelFallbackSession: () => {},
      sessionDeletionTasks,
    })
    await monitorStarted
    const recreation = handleSessionCreatedEvent({
      event: { type: "session.created", properties: { info: { id: sessionID } } },
      props: { info: { id: sessionID } },
      tmuxIntegrationEnabled: true,
      pluginConfig,
      pluginContext,
      managers: raceManagers,
      firstMessageVariantGate,
      sessionDeletionTasks,
    })
    await Promise.resolve()
    releaseMonitor?.()
    await Promise.all([deletion, recreation])

    expect(getMainSessionID()).toBe(sessionID)
    expect(getSessionAgent(sessionID)).toBe("hephaestus")
    expect(getSessionModel(sessionID)).toEqual({ providerID: "openai", modelID: "new-generation-model" })
    expect(getSessionPromptParams(sessionID)).toEqual({ temperature: 0.7 })
    expect(disconnectCalls).toBe(1)
    expect(lifecycleCalls).toEqual(["disconnect", "create"])
  })
})
