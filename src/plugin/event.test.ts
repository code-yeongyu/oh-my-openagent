import { describe, it, expect, afterEach } from "bun:test"

import { createEventHandler } from "./event"
import { createChatMessageHandler } from "./chat-message"
import { _resetForTesting, setMainSession } from "../features/claude-code-session-state"
import { clearPendingModelFallback, createModelFallbackHook } from "../hooks/model-fallback/hook"
import { getSessionPromptParams, setSessionPromptParams } from "../shared/session-prompt-params-state"

type EventInput = { event: { type: string; properties?: unknown } }

afterEach(() => {
	_resetForTesting()
})

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
		expect((dispatchCalls[0].event.properties as { sessionID?: string } | undefined)?.sessionID).toBe(sessionId)

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
		expect((dispatchCalls[0].event.properties as { sessionID?: string } | undefined)?.sessionID).toBe(sessionId)

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
		} as any)

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
			} as any,
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

describe("createEventHandler - event forwarding", () => {
	it("forwards session.deleted to write-existing-file-guard hook", async () => {
		//#given
		const forwardedEvents: EventInput[] = []
		const disconnectedSessions: string[] = []
		const deletedSessions: string[] = []
		const eventHandler = createEventHandler({
			ctx: {} as never,
			pluginConfig: {} as never,
			firstMessageVariantGate: {
				markSessionCreated: () => {},
				clear: () => {},
			},
			managers: {
				skillMcpManager: {
					disconnectSession: async (sessionID: string) => {
						disconnectedSessions.push(sessionID)
					},
				},
				tmuxSessionManager: {
					onSessionCreated: async () => {},
					onSessionDeleted: async ({ sessionID }: { sessionID: string }) => {
						deletedSessions.push(sessionID)
					},
				},
			} as never,
			hooks: {
				writeExistingFileGuard: {
					event: async (input: EventInput) => {
						forwardedEvents.push(input)
					},
				},
			} as never,
		})
		const sessionID = "ses_forward_delete_event"

		//#when
		await eventHandler({
			event: {
				type: "session.deleted",
				properties: { info: { id: sessionID } },
			},
		} as any)

		//#then
		expect(forwardedEvents.length).toBe(1)
		expect(forwardedEvents[0]?.event.type).toBe("session.deleted")
		expect(disconnectedSessions).toEqual([sessionID])
		expect(deletedSessions).toEqual([sessionID])
	})

	it("clears stored prompt params on session.deleted", async () => {
		//#given
		const eventHandler = createEventHandler({
			ctx: {} as never,
			pluginConfig: {} as never,
			firstMessageVariantGate: {
				markSessionCreated: () => {},
				clear: () => {},
			},
			managers: {
				skillMcpManager: {
					disconnectSession: async () => {},
				},
				tmuxSessionManager: {
					onSessionCreated: async () => {},
					onSessionDeleted: async () => {},
				},
			} as never,
			hooks: {} as never,
		})
		const sessionID = "ses_prompt_params_deleted"
		setSessionPromptParams(sessionID, {
			temperature: 0.4,
			topP: 0.7,
			options: { reasoningEffort: "high" },
		})

		//#when
		await eventHandler({
			event: {
				type: "session.deleted",
				properties: { info: { id: sessionID } },
			},
		})

		//#then
		expect(getSessionPromptParams(sessionID)).toBeUndefined()
	})
})

describe("createEventHandler - retry dedupe lifecycle", () => {
	it("re-handles same retry key after session recovers to idle status", async () => {
		//#given
		const sessionID = "ses_retry_recovery_rearm"
		setMainSession(sessionID)
		clearPendingModelFallback(sessionID)

		const abortCalls: string[] = []
		const promptCalls: string[] = []
		const modelFallback = createModelFallbackHook()

		const eventHandler = createEventHandler({
			ctx: {
				directory: "/tmp",
				client: {
					session: {
						abort: async ({ path }: { path: { id: string } }) => {
							abortCalls.push(path.id)
							return {}
						},
						prompt: async ({ path }: { path: { id: string } }) => {
							promptCalls.push(path.id)
							return {}
						},
					},
				},
			} as any,
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
				skillMcpManager: {
					disconnectSession: async () => {},
				},
			} as any,
			hooks: {
				modelFallback,
				stopContinuationGuard: { isStopped: () => false },
			} as any,
		})

		const chatMessageHandler = createChatMessageHandler({
			ctx: {
				client: {
					tui: {
						showToast: async () => ({}),
					},
				},
			} as any,
			pluginConfig: {} as any,
			firstMessageVariantGate: {
				shouldOverride: () => false,
				markApplied: () => {},
			},
			hooks: {
				modelFallback,
				stopContinuationGuard: null,
				keywordDetector: null,
				claudeCodeHooks: null,
				autoSlashCommand: null,
				startWork: null,
				ralphLoop: null,
			} as any,
		})

		const retryStatus = {
			type: "retry",
			attempt: 1,
			message: "All credentials for model claude-opus-4-6-thinking are cooling down [retrying in 7m 56s attempt #1]",
			next: 476,
		} as const

		await eventHandler({
			event: {
				type: "message.updated",
				properties: {
					info: {
						id: "msg_user_retry_rearm",
						sessionID,
						role: "user",
						modelID: "claude-opus-4-6-thinking",
						providerID: "anthropic",
						agent: "Sisyphus (Ultraworker)",
					},
				},
			},
		} as any)

		//#when - first retry key is handled
		await eventHandler({
			event: {
				type: "session.status",
				properties: {
					sessionID,
					status: retryStatus,
				},
			},
		} as any)

		const firstOutput = { message: {}, parts: [] as Array<{ type: string; text?: string }> }
		await chatMessageHandler(
			{
				sessionID,
				agent: "sisyphus",
				model: { providerID: "anthropic", modelID: "claude-opus-4-6-thinking" },
			},
			firstOutput,
		)

		//#when - session recovers to non-retry idle state
		await eventHandler({
			event: {
				type: "session.status",
				properties: {
					sessionID,
					status: { type: "idle" },
				},
			},
		} as any)

		//#when - same retry key appears again after recovery
		await eventHandler({
			event: {
				type: "session.status",
				properties: {
					sessionID,
					status: retryStatus,
				},
			},
		} as any)

		//#then
		expect(abortCalls).toEqual([sessionID, sessionID])
		expect(promptCalls).toEqual([sessionID, sessionID])
	})
})

describe("createEventHandler - session recovery compaction", () => {
	it("triggers compaction before sending continue after session error recovery", async () => {
		//#given
		const sessionID = "ses_recovery_compaction"
		setMainSession(sessionID)
		const callOrder: string[] = []

		const eventHandler = createEventHandler({
			ctx: {
				directory: "/tmp",
				client: {
					session: {
						abort: async () => ({}),
						summarize: async () => {
							callOrder.push("summarize")
							return {}
						},
						prompt: async () => {
							callOrder.push("prompt")
							return {}
						},
					},
				},
			} as any,
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
				sessionRecovery: {
					isRecoverableError: () => true,
					handleSessionRecovery: async () => true,
				},
				stopContinuationGuard: { isStopped: () => false },
			} as any,
		})

		//#when
		await eventHandler({
			event: {
				type: "session.error",
				properties: {
					sessionID,
					messageID: "msg_123",
					error: { name: "Error", message: "tool_result block(s) that are not immediately" },
				},
			},
		} as any)

		//#then - summarize (compaction) must be called before prompt (continue)
		expect(callOrder).toEqual(["summarize", "prompt"])
	})

	it("sends continue even if compaction fails", async () => {
		//#given
		const sessionID = "ses_recovery_compaction_fail"
		setMainSession(sessionID)
		const callOrder: string[] = []

		const eventHandler = createEventHandler({
			ctx: {
				directory: "/tmp",
				client: {
					session: {
						abort: async () => ({}),
						summarize: async () => {
							callOrder.push("summarize")
							throw new Error("compaction failed")
						},
						prompt: async () => {
							callOrder.push("prompt")
							return {}
						},
					},
				},
			} as any,
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
				sessionRecovery: {
					isRecoverableError: () => true,
					handleSessionRecovery: async () => true,
				},
				stopContinuationGuard: { isStopped: () => false },
			} as any,
		})

		//#when
		await eventHandler({
			event: {
				type: "session.error",
				properties: {
					sessionID,
					messageID: "msg_456",
					error: { name: "Error", message: "tool_result block(s) that are not immediately" },
				},
			},
		} as any)

		//#then - continue is still sent even when compaction fails
		expect(callOrder).toEqual(["summarize", "prompt"])
	})
})
