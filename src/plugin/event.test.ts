/// <reference path="../../bun-test.d.ts" />
import { describe, it, expect, afterEach, mock, spyOn } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"

import { createEventHandler, extractErrorMessage } from "./event"
import { createChatMessageHandler } from "./chat-message"
import * as openclawRuntimeDispatch from "../openclaw/runtime-dispatch"
import { _resetForTesting, setMainSession, subagentSessions } from "../features/claude-code-session-state"
import { clearPendingModelFallback, createModelFallbackHook } from "../hooks/model-fallback/hook"
import { getSessionPromptParams, setSessionPromptParams } from "../shared/session-prompt-params-state"

type EventInput = { event: { type: string; properties?: unknown } }
type EventHandlerArgs = Parameters<typeof createEventHandler>[0]
type EventHandlerInput = Parameters<ReturnType<typeof createEventHandler>>[0]
type ChatMessageHandlerArgs = Parameters<typeof createChatMessageHandler>[0]

function cast<T>(value: unknown): T {
	return value as T
}

function asEventHandlerInput(input: EventInput): EventHandlerInput {
	return cast<EventHandlerInput>(input)
}

function asEventHandlerContext(ctx: unknown): EventHandlerArgs["ctx"] {
	return cast<EventHandlerArgs["ctx"]>(ctx)
}

function asChatMessageHandlerContext(ctx: unknown): ChatMessageHandlerArgs["ctx"] {
	return cast<ChatMessageHandlerArgs["ctx"]>(ctx)
}

function asPluginConfig(config: unknown): EventHandlerArgs["pluginConfig"] {
	return cast<EventHandlerArgs["pluginConfig"]>(config)
}

function asChatPluginConfig(config: unknown): ChatMessageHandlerArgs["pluginConfig"] {
	return cast<ChatMessageHandlerArgs["pluginConfig"]>(config)
}

function asPluginInput(input: unknown): PluginInput {
	return input as PluginInput
}

function createEventHandlerManagers(
	overrides: Record<string, unknown> = {},
): EventHandlerArgs["managers"] {
	return cast<EventHandlerArgs["managers"]>({
		tmuxSessionManager: {
			onEvent: () => {},
			onSessionCreated: async () => {},
			onSessionDeleted: async () => {},
		},
		...overrides,
	})
}

function createEventHandlerHooks(
	overrides: Record<string, unknown> = {},
): EventHandlerArgs["hooks"] {
	return cast<EventHandlerArgs["hooks"]>(overrides)
}

function createChatMessageHandlerHooks(
	overrides: Record<string, unknown> = {},
): ChatMessageHandlerArgs["hooks"] {
	return cast<ChatMessageHandlerArgs["hooks"]>(overrides)
}

async function wait(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms))
}

function createIdleTrackingEventHandler(dispatchCalls: EventInput[]): ReturnType<typeof createEventHandler> {
	return createEventHandler({
		ctx: asEventHandlerContext({}),
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
			autoUpdateChecker: {
				event: async (input: EventInput) => {
					if (input.event.type === "session.idle") {
						dispatchCalls.push(input)
					}
				},
			},
		}),
	})
}

function createIdleDedupSpyEventHandler(args: {
	onEvent: (event: EventInput["event"]) => void
	sessionNotification: (input: EventInput) => Promise<void>
}): ReturnType<typeof createEventHandler> {
	return createEventHandler({
		ctx: asEventHandlerContext({
			directory: "/tmp",
			client: {
				session: {},
			},
		}),
		pluginConfig: asPluginConfig({
			tmux: { enabled: true },
		}),
		firstMessageVariantGate: {
			markSessionCreated: () => {},
			clear: () => {},
		},
		managers: createEventHandlerManagers({
			tmuxSessionManager: {
				onEvent: args.onEvent,
				onSessionCreated: async () => {},
				onSessionDeleted: async () => {},
			},
		}),
		hooks: createEventHandlerHooks({
			sessionNotification: args.sessionNotification,
		}),
	})
}

async function flushMicrotasks(turns: number = 5): Promise<void> {
	for (let index = 0; index < turns; index += 1) {
		await Promise.resolve()
	}
}

afterEach(() => {
	mock.restore()
	_resetForTesting()
})

describe("event error extraction", () => {
	it("prefers nested APIError message over generic top-level message", async () => {
		const error = {
			name: "APIError",
			message: "Error",
			data: { message: "Forbidden: Selected provider is forbidden" },
		}
		const result = extractErrorMessage(error)
		expect(result).toBe("Forbidden: Selected provider is forbidden")
	})
})

describe("createEventHandler - idle deduplication", () => {
	it("#given tmux integration enabled #when session.idle arrives #then it forwards the event to tmuxSessionManager.onEvent", async () => {
		//#given
		const onEvent = mock<(event: EventInput["event"]) => void>(() => {})
		const idleEvent = {
			event: {
				type: "session.idle",
				properties: {
					sessionID: "ses_tmux_idle",
				},
			},
		}
		const eventHandler = createEventHandler({
			ctx: asEventHandlerContext({
				directory: "/tmp",
				client: {
					session: {},
				},
			}),
			pluginConfig: asPluginConfig({
				tmux: { enabled: true },
			}),
			firstMessageVariantGate: {
				markSessionCreated: () => {},
				clear: () => {},
			},
			managers: createEventHandlerManagers({
				tmuxSessionManager: {
					onEvent,
					onSessionCreated: async () => {},
					onSessionDeleted: async () => {},
				},
			}),
			hooks: createEventHandlerHooks({}),
		})

		//#when
		await eventHandler(asEventHandlerInput(idleEvent))

		//#then
		expect(onEvent).toHaveBeenCalledTimes(1)
		expect(onEvent.mock.calls[0]?.[0]).toEqual(idleEvent.event)
	})

	it("#given a readiness retry is pending #when session.idle arrives through the plugin handler #then tmux retry spawns the pane", async () => {
		//#given
		const sessionStatusData: Record<string, { type: string }> = {}
		const sessionStatusResult = {
			data: sessionStatusData,
		}
		const spawnTmuxPane = mock(async (_sessionId: string) => ({
			success: true,
			paneId: "%mock",
		}))
		let waitForSessionReadyCallCount = 0

		mock.module("../features/tmux-subagent/pane-state-querier", () => ({
			queryWindowState: async () => ({
				windowWidth: 220,
				windowHeight: 44,
				mainPane: {
					paneId: "%0",
					width: 110,
					height: 44,
					left: 0,
					top: 0,
					title: "main",
					isActive: true,
				},
				agentPanes: [],
			}),
		}))
		mock.module("../features/tmux-subagent/action-executor", () => ({
			executeActions: async (actions: Array<{ type: string; sessionId: string }>) => {
				for (const action of actions) {
					if (action.type === "spawn") {
						await spawnTmuxPane(action.sessionId)
					}
				}

				return {
					success: true,
					spawnedPaneId: "%mock",
					results: [],
				}
			},
			executeAction: async () => ({ success: true }),
		}))
		mock.module("../features/tmux-subagent/session-ready-waiter", () => ({
			waitForSessionReady: async () => {
				waitForSessionReadyCallCount += 1
				if (waitForSessionReadyCallCount === 1) {
					throw new Error("session readiness timed out")
				}

				return true
			},
		}))
		mock.module("../shared/tmux", () => ({
			isInsideTmux: () => true,
			getCurrentPaneId: () => "%0",
			POLL_INTERVAL_BACKGROUND_MS: 100,
			spawnTmuxWindow: async () => ({ success: true, paneId: "%isolated-window" }),
			spawnTmuxSession: async () => ({ success: true, paneId: "%isolated-session" }),
			killTmuxSessionIfExists: async () => true,
			getIsolatedSessionName: (pid: number = 12345) => `omo-agents-${pid}`,
			sweepStaleOmoAgentSessions: async () => 0,
		}))

		const { TmuxSessionManager } = await import("../features/tmux-subagent/manager")
		const managerContext = asPluginInput({
			serverUrl: new URL("http://localhost:4096"),
			directory: "/tmp",
			project: "/tmp",
			worktree: "/tmp",
			$: {},
			client: {
				session: {
					status: async () => sessionStatusResult,
					messages: async () => ({ data: [] }),
				},
			},
		})
		const manager = new TmuxSessionManager(managerContext, {
			enabled: true,
			isolation: "inline",
			layout: "main-vertical",
			main_pane_size: 60,
			main_pane_min_width: 80,
			agent_pane_min_width: 40,
		})
		const eventHandler = createEventHandler({
			ctx: asEventHandlerContext({
				directory: "/tmp",
				client: {
					session: {},
				},
			}),
			pluginConfig: asPluginConfig({
				tmux: { enabled: true },
			}),
			firstMessageVariantGate: {
				markSessionCreated: () => {},
				clear: () => {},
			},
			managers: createEventHandlerManagers({
				tmuxSessionManager: manager,
				skillMcpManager: {
					disconnectSession: async () => {},
				},
			}),
			hooks: createEventHandlerHooks({}),
		})

		//#when
		await manager.onSessionCreated({
			type: "session.created",
			properties: {
				info: {
					id: "ses_retry_via_plugin",
					parentID: "ses_parent",
					title: "Retry Via Plugin Event",
				},
			},
		})

		//#then
		expect(spawnTmuxPane).toHaveBeenCalledTimes(0)

		//#when
		sessionStatusData.ses_retry_via_plugin = { type: "idle" }
		await eventHandler(asEventHandlerInput({
			event: {
				type: "session.idle",
				properties: {
					sessionID: "ses_retry_via_plugin",
				},
			},
		}))
		await flushMicrotasks(20)

		//#then
		expect(spawnTmuxPane).toHaveBeenCalledTimes(1)
	})

	it("dedups real-idle-after-synthetic-idle within 500ms", async () => {
		//#given
		const dispatchCalls: EventInput[] = []
		const eventHandler = createIdleTrackingEventHandler(dispatchCalls)
		const sessionId = "ses_test123"
		await eventHandler(asEventHandlerInput({
			event: {
				type: "session.status",
				properties: {
					sessionID: sessionId,
					status: { type: "idle" },
				},
			},
		}))
		await eventHandler(asEventHandlerInput({
			event: {
				type: "session.idle",
				properties: {
					sessionID: sessionId,
				},
			},
		}))

		//#then
		expect(dispatchCalls).toHaveLength(1)
		expect(dispatchCalls[0]?.event.type).toBe("session.idle")
		expect((dispatchCalls[0]?.event.properties as { sessionID?: string } | undefined)?.sessionID).toBe(sessionId)
	})

	it("dedups back-to-back real session.idle events for the same sessionID within 500ms", async () => {
		//#given
		const originalDateNow = Date.now
		let currentNow = 10_000
		Date.now = () => currentNow
		const onEvent = mock<(event: EventInput["event"]) => void>(() => {})
		const sessionNotification = mock(async (_input: EventInput) => {})
		const eventHandler = createIdleDedupSpyEventHandler({
			onEvent,
			sessionNotification,
		})
		const sessionId = "ses_same_idle"

		try {
			//#when
			await eventHandler(asEventHandlerInput({
				event: {
					type: "session.idle",
					properties: {
						sessionID: sessionId,
					},
				},
			}))
			await eventHandler(asEventHandlerInput({
				event: {
					type: "session.idle",
					properties: {
						sessionID: sessionId,
					},
				},
			}))

			//#then
			expect(onEvent).toHaveBeenCalledTimes(1)
			expect(sessionNotification).toHaveBeenCalledTimes(1)

			//#when
			currentNow += 501
			await eventHandler(asEventHandlerInput({
				event: {
					type: "session.idle",
					properties: {
						sessionID: sessionId,
					},
				},
			}))

			//#then
			expect(onEvent).toHaveBeenCalledTimes(2)
			expect(sessionNotification).toHaveBeenCalledTimes(2)
		} finally {
			Date.now = originalDateNow
		}
	})

	it("still dedups synthetic-idle-after-real-idle as before", async () => {
		//#given
		const dispatchCalls: EventInput[] = []
		const eventHandler = createIdleTrackingEventHandler(dispatchCalls)
		const sessionId = "ses_test456"
		await eventHandler(asEventHandlerInput({
			event: {
				type: "session.idle",
				properties: {
					sessionID: sessionId,
				},
			},
		}))
		await eventHandler(asEventHandlerInput({
			event: {
				type: "session.status",
				properties: {
					sessionID: sessionId,
					status: { type: "idle" },
				},
			},
		}))
		expect(dispatchCalls).toHaveLength(1)
		expect(dispatchCalls[0]?.event.type).toBe("session.idle")
		expect((dispatchCalls[0]?.event.properties as { sessionID?: string } | undefined)?.sessionID).toBe(sessionId)
	})

	it("does NOT dedup session.idle events for DIFFERENT sessionIDs", async () => {
		//#given
		const originalDateNow = Date.now
		let currentNow = 20_000
		Date.now = () => currentNow
		const onEvent = mock<(event: EventInput["event"]) => void>(() => {})
		const sessionNotification = mock(async (_input: EventInput) => {})
		const eventHandler = createIdleDedupSpyEventHandler({
			onEvent,
			sessionNotification,
		})

		try {
			//#when
			await eventHandler(asEventHandlerInput({
				event: {
					type: "session.idle",
					properties: {
						sessionID: "ses_first_idle",
					},
				},
			}))
			await eventHandler(asEventHandlerInput({
				event: {
					type: "session.idle",
					properties: {
						sessionID: "ses_second_idle",
					},
				},
			}))

			//#then
			expect(onEvent).toHaveBeenCalledTimes(2)
			expect(sessionNotification).toHaveBeenCalledTimes(2)
		} finally {
			Date.now = originalDateNow
		}
	})

	it("both maps pruned on every event", async () => {
		//#given
		const eventHandler = createEventHandler({
			ctx: asEventHandlerContext({}),
			pluginConfig: asPluginConfig({}),
			firstMessageVariantGate: {
				markSessionCreated: () => {},
				clear: () => {},
			},
			managers: createEventHandlerManagers({
				tmuxSessionManager: {
					onSessionCreated: async () => {},
					onSessionDeleted: async () => {},
				},
			}),
			hooks: createEventHandlerHooks({
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
			}),
		})

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
		await wait(600)

		await eventHandler(asEventHandlerInput({
			event: {
				type: "message.updated",
			},
		}))
		const dispatchCalls: EventInput[] = []
		const eventHandlerWithMock = createEventHandler({
			ctx: asEventHandlerContext({}),
			pluginConfig: asPluginConfig({}),
			firstMessageVariantGate: {
				markSessionCreated: () => {},
				clear: () => {},
			},
			managers: createEventHandlerManagers({
				tmuxSessionManager: {
					onSessionCreated: async () => {},
					onSessionDeleted: async () => {},
				},
			}),
			hooks: createEventHandlerHooks({
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
			}),
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

	it("dispatches both idle events once the dedup window expires", async () => {
		const dispatchCalls: EventInput[] = []
		const eventHandler = createEventHandler({
			ctx: asEventHandlerContext({}),
			pluginConfig: asPluginConfig({}),
			firstMessageVariantGate: {
				markSessionCreated: () => {},
				clear: () => {},
			},
			managers: createEventHandlerManagers({
				tmuxSessionManager: {
					onSessionCreated: async () => {},
					onSessionDeleted: async () => {},
				},
			}),
			hooks: createEventHandlerHooks({
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
			}),
		})

		const sessionId = "ses_outside_window"
		await eventHandler({
			event: {
				type: "session.status",
				properties: {
					sessionID: sessionId,
					status: { type: "idle" },
				},
			},
		})
		expect(dispatchCalls.length).toBe(1)
		await wait(600)
		await eventHandler({
			event: {
				type: "session.idle",
				properties: {
					sessionID: sessionId,
				},
			},
		})
		expect(dispatchCalls.length).toBe(2)
		expect(dispatchCalls[0].event.type).toBe("session.idle")
		expect(dispatchCalls[1].event.type).toBe("session.idle")
	})
})

describe("createEventHandler - event forwarding", () => {
	it("forwards message activity events to tmux session manager", async () => {
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
		await eventHandler(asEventHandlerInput({
			event: {
				type: "message.part.delta",
				properties: { sessionID: "ses_tmux_activity", field: "text", delta: "x" },
			},
		}))
		expect(forwardedEvents.length).toBe(1)
		expect(forwardedEvents[0]?.event.type).toBe("message.part.delta")
	})

	it("does not forward tmux activity events when tmux integration is disabled", async () => {
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
		await eventHandler(asEventHandlerInput({
			event: {
				type: "message.part.delta",
				properties: { sessionID: "ses_tmux_disabled", field: "text", delta: "x" },
			},
		}))
		expect(forwardedEvents).toHaveLength(0)
	})

	it("does not forward session.created to tmux session manager when tmux integration is disabled", async () => {
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
		await eventHandler(asEventHandlerInput({
			event: {
				type: "session.created",
				properties: { info: { id: "ses_tmux_disabled", parentID: "ses_parent" } },
			},
		}))
		expect(createdSessions).toHaveLength(0)
	})

	it("skips tmux dispatch for subagent sessions marked only via subagentSessions (no parentID)", async () => {
		//#given
		type SessionCreatedEvent = {
			type?: string
			properties?: {
				info?: {
					id?: string
					parentID?: string
					title?: string
				}
			}
		}
		const onSessionCreated = mock(async (event: SessionCreatedEvent) => event)
		subagentSessions.add("ses_marked_subagent")
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
					onSessionCreated,
					onSessionDeleted: async () => {},
				},
			}),
			hooks: createEventHandlerHooks({}),
		})

		//#when
		await eventHandler(asEventHandlerInput({
			event: {
				type: "session.created",
				properties: { info: { id: "ses_marked_subagent", title: "Child" } },
			},
		}))

		//#then
		expect(onSessionCreated).not.toHaveBeenCalled()
	})

	it("still dispatches for a primary session not in subagentSessions", async () => {
		//#given
		type SessionCreatedEvent = {
			type?: string
			properties?: {
				info?: {
					id?: string
					parentID?: string
					title?: string
				}
			}
		}
		const onSessionCreated = mock(async (event: SessionCreatedEvent) => event)
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
					onSessionCreated,
					onSessionDeleted: async () => {},
				},
			}),
			hooks: createEventHandlerHooks({}),
		})

		//#when
		await eventHandler(asEventHandlerInput({
			event: {
				type: "session.created",
				properties: { info: { id: "ses_primary", title: "Primary" } },
			},
		}))

		//#then
		expect(onSessionCreated).toHaveBeenCalledTimes(1)
		expect(onSessionCreated).toHaveBeenCalledWith({
			type: "session.created",
			properties: { info: { id: "ses_primary", title: "Primary" } },
		})
	})

	it("Path A skips dispatch even when subagentSessions Set is populated only AFTER the event arrives (parentID covers it)", async () => {
		//#given
		type SessionCreatedEvent = {
			type?: string
			properties?: {
				info?: {
					id?: string
					parentID?: string
					title?: string
				}
			}
		}
		const onSessionCreated = mock(async (event: SessionCreatedEvent) => event)
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
					onSessionCreated,
					onSessionDeleted: async () => {},
				},
			}),
			hooks: createEventHandlerHooks({}),
		})

		//#when
		await eventHandler(asEventHandlerInput({
			event: {
				type: "session.created",
				properties: { info: { id: "ses_parent_marked", parentID: "ses_parent", title: "Child" } },
			},
		}))

		//#then
		expect(onSessionCreated).not.toHaveBeenCalled()

		//#when
		subagentSessions.add("ses_parent_marked")
		await eventHandler(asEventHandlerInput({
			event: {
				type: "session.created",
				properties: { info: { id: "ses_parent_marked", title: "Child" } },
			},
		}))

		//#then
		expect(onSessionCreated).not.toHaveBeenCalled()
	})

	it("dispatches OpenClaw after session.created for main sessions (no parentID)", async () => {
		//#given
		const openClawSpy = spyOn(openclawRuntimeDispatch, "dispatchOpenClawEvent")
		openClawSpy.mockResolvedValue(null)
		const eventHandler = createEventHandler({
			ctx: asEventHandlerContext({ directory: "/tmp/project-created" }),
			pluginConfig: asPluginConfig({
				openclaw: { enabled: true, gateways: {}, hooks: {} },
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
				skillMcpManager: { disconnectSession: async () => {} },
				tmuxSessionManager: {
					onSessionCreated: async () => {},
					onSessionDeleted: async () => {},
					getTrackedPaneId: (sessionID: string) => (sessionID === "ses_openclaw_created" ? "%9" : undefined),
				},
			}),
			hooks: createEventHandlerHooks({}),
		})
		await eventHandler(asEventHandlerInput({
			event: {
				type: "session.created",
				properties: { info: { id: "ses_openclaw_created" } },
			},
		}))

		//#then - OpenClaw dispatch called for main session
		const call = openClawSpy.mock.calls[0]?.[0] as
			| {
				rawEvent?: string
				context?: { sessionId?: string; projectPath?: string; tmuxPaneId?: string }
			  }
			| undefined
		expect(call?.rawEvent).toBe("session.created")
		expect(call?.context).toEqual({
			sessionId: "ses_openclaw_created",
			projectPath: "/tmp/project-created",
			tmuxPaneId: "%9",
		})
	})

	it("does NOT dispatch OpenClaw for subagent sessions (with parentID)", async () => {
		//#given
		const openClawSpy = spyOn(openclawRuntimeDispatch, "dispatchOpenClawEvent")
		openClawSpy.mockResolvedValue(null)
		const eventHandler = createEventHandler({
			ctx: asEventHandlerContext({ directory: "/tmp/project-created" }),
			pluginConfig: asPluginConfig({
				openclaw: { enabled: true, gateways: {}, hooks: {} },
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
				skillMcpManager: { disconnectSession: async () => {} },
				tmuxSessionManager: {
					onSessionCreated: async () => {},
					onSessionDeleted: async () => {},
					getTrackedPaneId: (sessionID: string) => (sessionID === "ses_subagent" ? "%10" : undefined),
				},
			}),
			hooks: createEventHandlerHooks({}),
		})
		await eventHandler(asEventHandlerInput({
			event: {
				type: "session.created",
				properties: { info: { id: "ses_subagent", parentID: "ses_parent" } },
			},
		}))
		expect(openClawSpy.mock.calls.length).toBe(0)
	})

	it("forwards session.deleted to write-existing-file-guard hook", async () => {
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
		await eventHandler(asEventHandlerInput({
			event: {
				type: "session.deleted",
				properties: { info: { id: sessionID } },
			},
		}))
		expect(forwardedEvents.length).toBe(1)
		expect(forwardedEvents[0]?.event.type).toBe("session.deleted")
		expect(disconnectedSessions).toEqual([sessionID])
		expect(deletedSessions).toEqual([sessionID])
	})

	it("dispatches OpenClaw for synthetic session.idle events", async () => {
		const openClawSpy = spyOn(openclawRuntimeDispatch, "dispatchOpenClawEvent")
		openClawSpy.mockResolvedValue(null)
		const eventHandler = createEventHandler({
			ctx: asEventHandlerContext({ directory: "/tmp/project-idle" }),
			pluginConfig: asPluginConfig({ openclaw: { enabled: true, gateways: {}, hooks: {} } }),
			firstMessageVariantGate: {
				markSessionCreated: () => {},
				clear: () => {},
			},
			managers: createEventHandlerManagers({
				skillMcpManager: { disconnectSession: async () => {} },
				tmuxSessionManager: {
					onSessionCreated: async () => {},
					onSessionDeleted: async () => {},
					getTrackedPaneId: (sessionID: string) => (sessionID === "ses_openclaw_idle" ? "%3" : undefined),
				},
			}),
			hooks: createEventHandlerHooks({}),
		})

		await eventHandler(asEventHandlerInput({
			event: {
				type: "session.status",
				properties: { sessionID: "ses_openclaw_idle", status: { type: "idle" } },
			},
		}))

		const call = openClawSpy.mock.calls[0]?.[0] as
			| {
				rawEvent?: string
				context?: { sessionId?: string; projectPath?: string; tmuxPaneId?: string }
			  }
			| undefined
		expect(call?.rawEvent).toBe("session.idle")
		expect(call?.context).toEqual({
			sessionId: "ses_openclaw_idle",
			projectPath: "/tmp/project-idle",
			tmuxPaneId: "%3",
		})
	})

	it("clears stored prompt params on session.deleted", async () => {
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
		await eventHandler(asEventHandlerInput({
			event: {
				type: "session.deleted",
				properties: { info: { id: sessionID } },
			},
		}))
		expect(getSessionPromptParams(sessionID)).toBeUndefined()
	})
})

describe("createEventHandler - retry dedupe lifecycle", () => {
	it("re-handles same retry key after session recovers to idle status", async () => {
		const sessionID = "ses_retry_recovery_rearm"
		setMainSession(sessionID)
		const abortCalls: string[] = []
		const promptCalls: string[] = []
		const modelFallback = createModelFallbackHook()
		clearPendingModelFallback(modelFallback, sessionID)

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
			message: "All credentials for model claude-opus-4-7-thinking are cooling down [retrying in 7m 56s attempt #1]",
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
						modelID: "claude-opus-4-7-thinking",
						providerID: "anthropic",
						agent: "Sisyphus - Ultraworker",
					},
				},
			},
		}))
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
				model: { providerID: "anthropic", modelID: "claude-opus-4-7-thinking" },
			},
			firstOutput,
		)
		await eventHandler(asEventHandlerInput({
			event: {
				type: "session.status",
				properties: {
					sessionID,
					status: { type: "idle" },
				},
			},
		}))
		await eventHandler(asEventHandlerInput({
			event: {
				type: "session.status",
				properties: {
					sessionID,
					status: retryStatus,
				},
			},
		}))
		expect(abortCalls).toEqual([sessionID, sessionID])
		expect(promptCalls).toEqual([sessionID, sessionID])
	})
})

describe("createEventHandler - session recovery compaction", () => {
	it("triggers compaction before sending continue after session error recovery", async () => {
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
		expect(callOrder).toEqual(["summarize", "prompt"])
	})

	it("sends continue even if compaction fails", async () => {
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
		expect(callOrder).toEqual(["summarize", "prompt"])
	})

	it("continues dispatching later event hooks when an earlier hook throws", async () => {
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
		expect(thrownError).toBeUndefined()
		expect(runtimeFallbackCalls).toHaveLength(1)
		expect(runtimeFallbackCalls[0]?.event.type).toBe("session.error")
	})
})
