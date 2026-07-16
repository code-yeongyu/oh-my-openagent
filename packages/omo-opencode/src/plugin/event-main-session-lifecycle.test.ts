import { afterEach, describe, expect, it } from "bun:test"
import type { Managers } from "../create-managers"
import {
  _resetForTesting,
  getMainSessionID,
  isMainSession,
} from "../features/claude-code-session-state"
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

afterEach(() => {
  _resetForTesting()
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
})
