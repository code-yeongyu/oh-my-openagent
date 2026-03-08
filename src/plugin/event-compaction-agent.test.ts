declare const require: (name: string) => any
const { afterEach, describe, expect, test } = require("bun:test")

import { _resetForTesting, getSessionAgent, updateSessionAgent } from "../features/claude-code-session-state"
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
  })

  test("does not overwrite the stored session agent with compaction", async () => {
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
})
