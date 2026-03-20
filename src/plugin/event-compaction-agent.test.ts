import { afterEach, describe, expect, it } from "bun:test"

import { _resetForTesting, getSessionAgent, updateSessionAgent } from "../features/claude-code-session-state"
import { clearSessionModel, getSessionModel, setSessionModel } from "../shared/session-model-state"
import { createEventHandler } from "./event"

function createMinimalEventHandler() {
  return createEventHandler({
    ctx: {} as never,
    pluginConfig: {} as never,
    firstMessageVariantGate: {
      markSessionCreated: () => {},
      clear: () => {},
    },
    managers: {
      tmuxSessionManager: {
        onSessionCreated: async () => {},
        onSessionDeleted: async () => {},
      },
      skillMcpManager: {
        disconnectSession: async () => {},
      },
    } as never,
    hooks: {
      autoUpdateChecker: { event: async () => {} },
      claudeCodeHooks: { event: async () => {} },
      backgroundNotificationHook: { event: async () => {} },
      sessionNotification: async () => {},
      todoContinuationEnforcer: { handler: async () => {} },
      unstableAgentBabysitter: { event: async () => {} },
      contextWindowMonitor: { event: async () => {} },
      directoryAgentsInjector: { event: async () => {} },
      directoryReadmeInjector: { event: async () => {} },
      rulesInjector: { event: async () => {} },
      thinkMode: { event: async () => {} },
      anthropicContextWindowLimitRecovery: { event: async () => {} },
      runtimeFallback: undefined,
      modelFallback: undefined,
      agentUsageReminder: { event: async () => {} },
      categorySkillReminder: { event: async () => {} },
      interactiveBashSession: { event: async () => {} },
      ralphLoop: { event: async () => {} },
      stopContinuationGuard: { event: async () => {}, isStopped: () => false },
      compactionTodoPreserver: { event: async () => {} },
      writeExistingFileGuard: { event: async () => {} },
      atlasHook: { handler: async () => {} },
    } as never,
  })
}

describe("createEventHandler compaction agent filtering", () => {
  afterEach(() => {
    _resetForTesting()
    clearSessionModel("ses_compaction_poisoning")
    clearSessionModel("ses_compaction_model_poisoning")
  })

  it("does not overwrite the stored session agent with compaction", async () => {
    // given
    const sessionID = "ses_compaction_poisoning"
    updateSessionAgent(sessionID, "atlas")
    const eventHandler = createMinimalEventHandler()
    const input: Parameters<ReturnType<typeof createEventHandler>>[0] = {
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg-compaction",
            sessionID,
            role: "user",
            agent: "compaction",
            time: { created: Date.now() },
            model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
          },
        },
      },
    }

    // when
    await eventHandler(input)

    // then
    expect(getSessionAgent(sessionID)).toBe("atlas")
  })

  it("does not overwrite the stored session model with compaction", async () => {
    // given
    const sessionID = "ses_compaction_model_poisoning"
    setSessionModel(sessionID, { providerID: "openai", modelID: "gpt-5" })
    const eventHandler = createMinimalEventHandler()
    const input: Parameters<ReturnType<typeof createEventHandler>>[0] = {
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg-compaction-model",
            sessionID,
            role: "user",
            agent: "compaction",
            providerID: "anthropic",
            modelID: "claude-opus-4-1",
            time: { created: Date.now() },
          },
        },
      },
    }

    // when
    await eventHandler(input)

    // then
    expect(getSessionModel(sessionID)).toEqual({
      providerID: "openai",
      modelID: "gpt-5",
    })
  })
})
