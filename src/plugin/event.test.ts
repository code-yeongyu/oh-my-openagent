import { describe, it, expect, afterEach } from "bun:test"

import { createEventHandler } from "./event"
import { createChatMessageHandler } from "./chat-message"
import { _resetForTesting, setMainSession } from "../features/claude-code-session-state"
import { clearPendingModelFallback, createModelFallbackHook } from "../hooks/model-fallback/hook"
import { getSessionPromptParams, setSessionPromptParams } from "../shared/session-prompt-params-state"

type EventInput = { event: { type: string; properties?: unknown } }
type EventHandlerArgs = Parameters<typeof createEventHandler>[0]
type EventHandlerInput = Parameters<ReturnType<typeof createEventHandler>>[0]
type ChatMessageHandlerArgs = Parameters<typeof createChatMessageHandler>[0]

function asEventHandlerInput(input: EventInput): EventHandlerInput {
	return input as unknown as EventHandlerInput
}

function asEventHandlerContext(ctx: unknown): EventHandlerArgs["ctx"] {
	return ctx as unknown as EventHandlerArgs["ctx"]
}

function asChatMessageHandlerContext(ctx: unknown): ChatMessageHandlerArgs["ctx"] {
	return ctx as unknown as ChatMessageHandlerArgs["ctx"]
}

function asPluginConfig(config: unknown): EventHandlerArgs["pluginConfig"] {
	return config as unknown as EventHandlerArgs["pluginConfig"]
}

function asChatPluginConfig(config: unknown): ChatMessageHandlerArgs["pluginConfig"] {
	return config as unknown as ChatMessageHandlerArgs["pluginConfig"]
}

function createEventHandlerManagers(
	overrides: Record<string, unknown> = {},
): EventHandlerArgs["managers"] {
	return {
		...({} as EventHandlerArgs["managers"]),
		tmuxSessionManager: {
			onSessionCreated: async () => {},
			onSessionDeleted: async () => {},
		},
		...overrides,
	} as unknown as EventHandlerArgs["managers"]
}

function createEventHandlerHooks(
	overrides: Record<string, unknown>,
): EventHandlerArgs["hooks"] {
	return {
		...({} as EventHandlerArgs["hooks"]),
		...overrides,
	} as unknown as EventHandlerArgs["hooks"]
}

function createChatMessageHandlerHooks(
	overrides: Record<string, unknown>,
): ChatMessageHandlerArgs["hooks"] {
	return {
		...({} as ChatMessageHandlerArgs["hooks"]),
		...overrides,
	} as unknown as ChatMessageHandlerArgs["hooks"]
}

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
	it("forwards message activity events to tmux session manager", async () => {
		//#given
		const forwardedEvents: EventInput[] = []
		const eventHandler = createEventHandler({
			ctx: asEventHandlerContext({}),
			pluginConfig: asPluginConfig({
				tmux: {
					enabled: true,
					layout: "main-vertical",
					main_pane_size: 60,
					main_pane_min_width: 120,
					agent_pane_min_width: 40,
					isolation: "inline",
				},
			}),
			firstMessageVariantGate: {
				markSessionCreated: () => {},
				clear: () => {},
			},
			managers: createEventHandlerManagers({
				skillMcpManager: {
					disconnectSession: async () => {},
				},
				tmuxSessionManager: {
					onEvent: (event: EventInput["event"]) => {
						forwardedEvents.push({ event })
					},
					onSessionCreated: async () => {},
					onSessionDeleted: async () => {},
				},
			}),
			hooks: createEventHandlerHooks({}),
		})

		//#when
		await eventHandler(asEventHandlerInput({
			event: {
				type: "message.part.delta",
				properties: { sessionID: "ses_tmux_activity", field: "text", delta: "x" },
			},
		}))

		//#then
		expect(forwardedEvents.length).toBe(1)
		expect(forwardedEvents[0]?.event.type).toBe("message.part.delta")
	})

	it("does not forward tmux activity events when tmux integration is disabled", async () => {
		//#given
		const forwardedEvents: EventInput[] = []
		const eventHandler = createEventHandler({
			ctx: asEventHandlerContext({}),
			pluginConfig: asPluginConfig({
				tmux: {
					enabled: false,
					layout: "main-vertical",
					main_pane_size: 60,
					main_pane_min_width: 120,
					agent_pane_min_width: 40,
					isolation: "inline",
				},
			}),
			firstMessageVariantGate: {
				markSessionCreated: () => {},
				clear: () => {},
			},
			managers: createEventHandlerManagers({
				skillMcpManager: {
					disconnectSession: async () => {},
				},
				tmuxSessionManager: {
					onEvent: (event: EventInput["event"]) => {
						forwardedEvents.push({ event })
					},
					onSessionCreated: async () => {},
					onSessionDeleted: async () => {},
				},
			}),
			hooks: createEventHandlerHooks({}),
		})

		//#when
		await eventHandler(asEventHandlerInput({
			event: {
				type: "message.part.delta",
				properties: { sessionID: "ses_tmux_disabled", field: "text", delta: "x" },
			},
		}))

		//#then
		expect(forwardedEvents).toHaveLength(0)
	})

	it("does not forward session.created to tmux session manager when tmux integration is disabled", async () => {
		//#given
		const createdSessions: string[] = []
		const eventHandler = createEventHandler({
			ctx: asEventHandlerContext({}),
			pluginConfig: asPluginConfig({
				tmux: {
					enabled: false,
					layout: "main-vertical",
					main_pane_size: 60,
					main_pane_min_width: 120,
					agent_pane_min_width: 40,
					isolation: "inline",
				},
			}),
			firstMessageVariantGate: {
				markSessionCreated: () => {},
				clear: () => {},
			},
			managers: createEventHandlerManagers({
				skillMcpManager: {
					disconnectSession: async () => {},
				},
				tmuxSessionManager: {
					onSessionCreated: async (event: { properties?: { info?: { id?: string } } }) => {
						const sessionId = event.properties?.info?.id
						if (sessionId) {
							createdSessions.push(sessionId)
						}
					},
					onSessionDeleted: async () => {},
				},
			}),
			hooks: createEventHandlerHooks({}),
		})

		//#when
		await eventHandler(asEventHandlerInput({
			event: {
				type: "session.created",
				properties: { info: { id: "ses_tmux_disabled", parentID: "ses_parent" } },
			},
		}))

		//#then
		expect(createdSessions).toHaveLength(0)
	})

	it("forwards session.deleted to write-existing-file-guard hook", async () => {
		//#given
		const forwardedEvents: EventInput[] = []
		const disconnectedSessions: string[] = []
		const deletedSessions: string[] = []
		const eventHandler = createEventHandler({
			ctx: {} as never,
			pluginConfig: asPluginConfig({
				tmux: {
					enabled: true,
					layout: "main-vertical",
					main_pane_size: 60,
					main_pane_min_width: 120,
					agent_pane_min_width: 40,
					isolation: "inline",
				},
			}),
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
		await eventHandler(asEventHandlerInput({
			event: {
				type: "session.deleted",
				properties: { info: { id: sessionID } },
			},
		}))

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
		await eventHandler(asEventHandlerInput({
			event: {
				type: "session.deleted",
				properties: { info: { id: sessionID } },
			},
		}))

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
			ctx: asEventHandlerContext({
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
			}),
			pluginConfig: asPluginConfig({}),
			firstMessageVariantGate: {
				markSessionCreated: () => {},
				clear: () => {},
			},
			managers: createEventHandlerManagers({
				skillMcpManager: {
					disconnectSession: async () => {},
				},
			}),
			hooks: createEventHandlerHooks({
				modelFallback,
				stopContinuationGuard: { isStopped: () => false },
			}),
		})

		const chatMessageHandler = createChatMessageHandler({
			ctx: asChatMessageHandlerContext({
				client: {
					tui: {
						showToast: async () => ({}),
					},
				},
			}),
			pluginConfig: asChatPluginConfig({}),
			firstMessageVariantGate: {
				shouldOverride: () => false,
				markApplied: () => {},
			},
			hooks: createChatMessageHandlerHooks({
				modelFallback,
				stopContinuationGuard: null,
				keywordDetector: null,
				claudeCodeHooks: null,
				autoSlashCommand: null,
				startWork: null,
				ralphLoop: null,
			}),
		})

		const retryStatus = {
			type: "retry",
			attempt: 1,
			message: "All credentials for model claude-opus-4-6-thinking are cooling down [retrying in 7m 56s attempt #1]",
			next: 476,
		} as const

		await eventHandler(asEventHandlerInput({
			event: {
				type: "message.updated",
				properties: {
					info: {
						id: "msg_user_retry_rearm",
						sessionID,
						role: "user",
						modelID: "claude-opus-4-6-thinking",
						providerID: "anthropic",
						agent: "Sisyphus - Ultraworker",
					},
				},
			},
		}))

		//#when - first retry key is handled
		await eventHandler(asEventHandlerInput({
			event: {
				type: "session.status",
				properties: {
					sessionID,
					status: retryStatus,
				},
			},
		}))

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
		await eventHandler(asEventHandlerInput({
			event: {
				type: "session.status",
				properties: {
					sessionID,
					status: { type: "idle" },
				},
			},
		}))

		//#when - same retry key appears again after recovery
		await eventHandler(asEventHandlerInput({
			event: {
				type: "session.status",
				properties: {
					sessionID,
					status: retryStatus,
				},
			},
		}))

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
			ctx: asEventHandlerContext({
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
			}),
			pluginConfig: asPluginConfig({}),
			firstMessageVariantGate: {
				markSessionCreated: () => {},
				clear: () => {},
			},
			managers: createEventHandlerManagers(),
			hooks: createEventHandlerHooks({
				sessionRecovery: {
					isRecoverableError: () => true,
					handleSessionRecovery: async () => true,
				},
				stopContinuationGuard: { isStopped: () => false },
			}),
		})

		//#when
		await eventHandler(asEventHandlerInput({
			event: {
				type: "session.error",
				properties: {
					sessionID,
					messageID: "msg_123",
					error: { name: "Error", message: "tool_result block(s) that are not immediately" },
				},
			},
		}))

		//#then - summarize (compaction) must be called before prompt (continue)
		expect(callOrder).toEqual(["summarize", "prompt"])
	})

	it("sends continue even if compaction fails", async () => {
		//#given
		const sessionID = "ses_recovery_compaction_fail"
		setMainSession(sessionID)
		const callOrder: string[] = []

		const eventHandler = createEventHandler({
			ctx: asEventHandlerContext({
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
			}),
			pluginConfig: asPluginConfig({}),
			firstMessageVariantGate: {
				markSessionCreated: () => {},
				clear: () => {},
			},
			managers: createEventHandlerManagers(),
			hooks: createEventHandlerHooks({
				sessionRecovery: {
					isRecoverableError: () => true,
					handleSessionRecovery: async () => true,
				},
				stopContinuationGuard: { isStopped: () => false },
			}),
		})

		//#when
		await eventHandler(asEventHandlerInput({
			event: {
				type: "session.error",
				properties: {
					sessionID,
					messageID: "msg_456",
					error: { name: "Error", message: "tool_result block(s) that are not immediately" },
				},
			},
		}))

		//#then - continue is still sent even when compaction fails
		expect(callOrder).toEqual(["summarize", "prompt"])
	})

	it("continues dispatching later event hooks when an earlier hook throws", async () => {
		//#given
		const runtimeFallbackCalls: EventInput[] = []

		const eventHandler = createEventHandler({
			ctx: asEventHandlerContext({
				directory: "/tmp",
				client: {
					session: {
						abort: async () => ({}),
						prompt: async () => ({}),
					},
				},
			}),
			pluginConfig: asPluginConfig({}),
			firstMessageVariantGate: {
				markSessionCreated: () => {},
				clear: () => {},
			},
			managers: createEventHandlerManagers(),
			hooks: createEventHandlerHooks({
				autoUpdateChecker: {
					event: async () => {
						throw new Error("upstream hook failed")
					},
				},
				runtimeFallback: {
					event: async (input: EventInput) => {
						runtimeFallbackCalls.push(input)
					},
				},
				stopContinuationGuard: { isStopped: () => false },
			}),
		})

		//#when
		let thrownError: unknown
		try {
			await eventHandler(asEventHandlerInput({
				event: {
					type: "session.error",
					properties: {
						sessionID: "ses_hook_isolation",
						error: { name: "Error", message: "retry me" },
					},
				},
			}))
		} catch (error) {
			thrownError = error
		}

		//#then
		expect(thrownError).toBeUndefined()
		expect(runtimeFallbackCalls).toHaveLength(1)
		expect(runtimeFallbackCalls[0]?.event.type).toBe("session.error")
	})
})
