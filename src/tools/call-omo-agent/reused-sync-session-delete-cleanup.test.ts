import { afterEach, describe, expect, it } from "bun:test"

import {
  _resetForTesting,
  subagentSessions,
  syncSubagentSessions,
} from "../../features/claude-code-session-state"
import { createEventHandler } from "../../plugin/event"

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

describe("reused sync session delete cleanup", () => {
  afterEach(() => {
    _resetForTesting()
  })

  it("removes reused sync sessions from subagentSessions when session.deleted fires", async () => {
    // given
    const syncSessionID = "ses-reused-sync-delete-cleanup"
    const unrelatedSubagentSessionID = "ses-unrelated-subagent-delete-cleanup"
    const eventHandler = createMinimalEventHandler()
    const input = {
      event: {
        type: "session.deleted",
        properties: {
          info: {
            id: syncSessionID,
          },
        },
      },
    } as Parameters<ReturnType<typeof createEventHandler>>[0]

    subagentSessions.add(syncSessionID)
    syncSubagentSessions.add(syncSessionID)
    subagentSessions.add(unrelatedSubagentSessionID)

    // when
    await eventHandler(input)

    // then
    expect(syncSubagentSessions.has(syncSessionID)).toBe(false)
    expect(subagentSessions.has(syncSessionID)).toBe(false)
    expect(subagentSessions.has(unrelatedSubagentSessionID)).toBe(true)
  })
})
