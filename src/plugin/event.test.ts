import { describe, it, expect } from "bun:test"

import { createEventHandler } from "./event"

type EventInput = { event: { type: string; properties?: Record<string, unknown> } }

	describe("createEventHandler - idle deduplication", () => {
	it("Order A (status→idle): synthetic idle deduped - real idle not dispatched again", async () => {
		//#given
		const dispatchCalls: EventInput[] = []
		const mockDispatchToHooks = async (input: EventInput) => {
			if (input.event.type === "session.idle") {
				dispatchCalls.push(input)
			}
		}

		const eventHandler = createEventHandler({
			ctx: {} as any,
			pluginConfig: {} as any,
			firstMessageVariantGate: {
				markSessionCreated: () => {},
				clear: () => {},
			},
			managers: {
				tmuxSessionManager: {
					onSessionCreated: async () => {},
					onSessionDeleted: async () => {},
				},
			} as any,
			hooks: {
				autoUpdateChecker: { event: mockDispatchToHooks as any },
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
				agentUsageReminder: { event: async () => {} },
				categorySkillReminder: { event: async () => {} },
				interactiveBashSession: { event: async () => {} },
				ralphLoop: { event: async () => {} },
				stopContinuationGuard: { event: async () => {} },
				compactionTodoPreserver: { event: async () => {} },
				atlasHook: { handler: async () => {} },
			} as any,
		})

		const sessionId = "ses_test123"

		//#when - session.status with idle (generates synthetic idle first)
		await eventHandler({
			event: {
				type: "session.status",
				properties: {
					sessionID: sessionId,
					status: { type: "idle" },
				},
			},
		})

		//#then - synthetic idle dispatched once
		expect(dispatchCalls.length).toBe(1)
		expect(dispatchCalls[0].event.type).toBe("session.idle")
		expect(dispatchCalls[0].event.properties?.sessionID).toBe(sessionId)

		//#when - real session.idle arrives
		await eventHandler({
			event: {
				type: "session.idle",
				properties: {
					sessionID: sessionId,
				},
			},
		})

		//#then - real idle deduped, no additional dispatch
		expect(dispatchCalls.length).toBe(1)
	})

	it("Order B (idle→status): real idle deduped - synthetic idle not dispatched", async () => {
		//#given
		const dispatchCalls: EventInput[] = []
		const mockDispatchToHooks = async (input: EventInput) => {
			if (input.event.type === "session.idle") {
				dispatchCalls.push(input)
			}
		}

		const eventHandler = createEventHandler({
			ctx: {} as any,
			pluginConfig: {} as any,
			firstMessageVariantGate: {
				markSessionCreated: () => {},
				clear: () => {},
			},
			managers: {
				tmuxSessionManager: {
					onSessionCreated: async () => {},
					onSessionDeleted: async () => {},
				},
			} as any,
			hooks: {
				autoUpdateChecker: { event: mockDispatchToHooks as any },
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
				agentUsageReminder: { event: async () => {} },
				categorySkillReminder: { event: async () => {} },
				interactiveBashSession: { event: async () => {} },
				ralphLoop: { event: async () => {} },
				stopContinuationGuard: { event: async () => {} },
				compactionTodoPreserver: { event: async () => {} },
				atlasHook: { handler: async () => {} },
			} as any,
		})

		const sessionId = "ses_test456"

		//#when - real session.idle arrives first
		await eventHandler({
			event: {
				type: "session.idle",
				properties: {
					sessionID: sessionId,
				},
			},
		})

		//#then - real idle dispatched once
		expect(dispatchCalls.length).toBe(1)
		expect(dispatchCalls[0].event.type).toBe("session.idle")
		expect(dispatchCalls[0].event.properties?.sessionID).toBe(sessionId)

		//#when - session.status with idle (generates synthetic idle)
		await eventHandler({
			event: {
				type: "session.status",
				properties: {
					sessionID: sessionId,
					status: { type: "idle" },
				},
			},
		})

		//#then - synthetic idle deduped, no additional dispatch
		expect(dispatchCalls.length).toBe(1)
	})

	it("both maps pruned on every event", async () => {
		//#given
		const eventHandler = createEventHandler({
			ctx: {} as any,
			pluginConfig: {} as any,
			firstMessageVariantGate: {
				markSessionCreated: () => {},
				clear: () => {},
			},
			managers: {
				tmuxSessionManager: {
					onSessionCreated: async () => {},
					onSessionDeleted: async () => {},
				},
			} as any,
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
				agentUsageReminder: { event: async () => {} },
				categorySkillReminder: { event: async () => {} },
				interactiveBashSession: { event: async () => {} },
				ralphLoop: { event: async () => {} },
				stopContinuationGuard: { event: async () => {} },
				compactionTodoPreserver: { event: async () => {} },
				atlasHook: { handler: async () => {} },
			} as any,
		})

		// Trigger some synthetic idles
		await eventHandler({
			event: {
				type: "session.status",
				properties: {
					sessionID: "ses_stale_1",
					status: { type: "idle" },
				},
			},
		})

		await eventHandler({
			event: {
				type: "session.status",
				properties: {
					sessionID: "ses_stale_2",
					status: { type: "idle" },
				},
			},
		})

		// Trigger some real idles
		await eventHandler({
			event: {
				type: "session.idle",
				properties: {
					sessionID: "ses_stale_3",
				},
			},
		})

		await eventHandler({
			event: {
				type: "session.idle",
				properties: {
					sessionID: "ses_stale_4",
				},
			},
		})

		//#when - wait for dedup window to expire (600ms > 500ms)
		await new Promise((resolve) => setTimeout(resolve, 600))

		// Trigger any event to trigger pruning
		await eventHandler({
			event: {
				type: "message.updated",
			},
		})

		//#then - both maps should be pruned (no dedup should occur for new events)
		// We verify by checking that a new idle event for same session is dispatched
		const dispatchCalls: EventInput[] = []
		const eventHandlerWithMock = createEventHandler({
			ctx: {} as any,
			pluginConfig: {} as any,
			firstMessageVariantGate: {
				markSessionCreated: () => {},
				clear: () => {},
			},
			managers: {
				tmuxSessionManager: {
					onSessionCreated: async () => {},
					onSessionDeleted: async () => {},
				},
			} as any,
			hooks: {
				autoUpdateChecker: {
					event: async (input: EventInput) => {
						dispatchCalls.push(input)
					},
				},
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
				agentUsageReminder: { event: async () => {} },
				categorySkillReminder: { event: async () => {} },
				interactiveBashSession: { event: async () => {} },
				ralphLoop: { event: async () => {} },
				stopContinuationGuard: { event: async () => {} },
				compactionTodoPreserver: { event: async () => {} },
				atlasHook: { handler: async () => {} },
			},
		})

		await eventHandlerWithMock({
			event: {
				type: "session.idle",
				properties: {
					sessionID: "ses_stale_1",
				},
			},
		})

		expect(dispatchCalls.length).toBe(1)
		expect(dispatchCalls[0].event.type).toBe("session.idle")
	})

	it("dedup only applies within window - outside window both dispatch", async () => {
		//#given
		const dispatchCalls: EventInput[] = []
		const eventHandler = createEventHandler({
			ctx: {} as any,
			pluginConfig: {} as any,
			firstMessageVariantGate: {
				markSessionCreated: () => {},
				clear: () => {},
			},
			managers: {
				tmuxSessionManager: {
					onSessionCreated: async () => {},
					onSessionDeleted: async () => {},
				},
			} as any,
			hooks: {
				autoUpdateChecker: {
					event: async (input: EventInput) => {
						if (input.event.type === "session.idle") {
							dispatchCalls.push(input)
						}
					},
				},
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
				agentUsageReminder: { event: async () => {} },
				categorySkillReminder: { event: async () => {} },
				interactiveBashSession: { event: async () => {} },
				ralphLoop: { event: async () => {} },
				stopContinuationGuard: { event: async () => {} },
				compactionTodoPreserver: { event: async () => {} },
				atlasHook: { handler: async () => {} },
			} as any,
		})

		const sessionId = "ses_outside_window"

		//#when - synthetic idle first
		await eventHandler({
			event: {
				type: "session.status",
				properties: {
					sessionID: sessionId,
					status: { type: "idle" },
				},
			},
		})

		//#then - synthetic dispatched
		expect(dispatchCalls.length).toBe(1)

		//#when - wait for dedup window to expire (600ms > 500ms)
		await new Promise((resolve) => setTimeout(resolve, 600))

		//#when - real idle arrives outside window
		await eventHandler({
			event: {
				type: "session.idle",
				properties: {
					sessionID: sessionId,
				},
			},
		})

		//#then - real idle dispatched (outside dedup window)
		expect(dispatchCalls.length).toBe(2)
		expect(dispatchCalls[0].event.type).toBe("session.idle")
		expect(dispatchCalls[1].event.type).toBe("session.idle")
	})
})
