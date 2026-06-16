/// <reference path="../../bun-test.d.ts" />

import { afterEach, describe, expect, it, mock } from "bun:test"

import { _resetForTesting } from "../features/claude-code-session-state"
import { getSessionPromptParams, setSessionPromptParams } from "../shared/session-prompt-params-state"
import { createEventHandler } from "./event"

type EventInput = { event: { type: string; properties?: unknown } }
type EventHandlerArgs = Parameters<typeof createEventHandler>[0]
type EventHandlerInput = Parameters<ReturnType<typeof createEventHandler>>[0]

function cast<T>(value: unknown): T {
	return value as T
}

function asEventHandlerInput(input: EventInput): EventHandlerInput {
	return cast<EventHandlerInput>(input)
}

function createEventHandlerManagers(overrides: Record<string, unknown> = {}): EventHandlerArgs["managers"] {
	return cast<EventHandlerArgs["managers"]>({
		skillMcpManager: {
			disconnectSession: async () => {},
		},
		tmuxSessionManager: {
			onEvent: () => {},
			onSessionCreated: async () => {},
			onSessionDeleted: async () => {},
		},
		...overrides,
	})
}

function createEventHandlerHooks(overrides: Record<string, unknown> = {}): EventHandlerArgs["hooks"] {
	return cast<EventHandlerArgs["hooks"]>(overrides)
}

afterEach(() => {
	mock.restore()
	_resetForTesting()
})

describe("createEventHandler monitor wiring", () => {
	it("#given a monitor manager #when session.deleted arrives #then it stops session monitors once", async () => {
		//#given
		const stopSessionMonitors = mock(async (_sessionID: string) => {})
		const sessionID = "ses_monitor_deleted"
		const eventHandler = createEventHandler({
			ctx: cast<EventHandlerArgs["ctx"]>({}),
			pluginConfig: cast<EventHandlerArgs["pluginConfig"]>({}),
			firstMessageVariantGate: {
				markSessionCreated: () => {},
				clear: () => {},
			},
			managers: createEventHandlerManagers({
				monitorManager: {
					stopSessionMonitors,
					handleEvent: () => {},
				},
			}),
			hooks: createEventHandlerHooks({}),
		})

		//#when
		await eventHandler(asEventHandlerInput({
			event: {
				type: "session.deleted",
				properties: { info: { id: sessionID } },
			},
		}))

		//#then
		expect(stopSessionMonitors).toHaveBeenCalledTimes(1)
		expect(stopSessionMonitors).toHaveBeenCalledWith(sessionID)
	})

	it("#given a monitor manager #when session.idle arrives #then it handles the normalized idle event after idle hooks", async () => {
		//#given
		const callOrder: string[] = []
		const handleEvent = mock((event: { type: "session.idle"; sessionId: string }) => {
			callOrder.push(`monitor:${event.type}`)
		})
		const idleEvent = {
			event: {
				type: "session.idle",
				properties: { sessionID: "ses_monitor_idle" },
			},
		}
		const eventHandler = createEventHandler({
			ctx: cast<EventHandlerArgs["ctx"]>({}),
			pluginConfig: cast<EventHandlerArgs["pluginConfig"]>({}),
			firstMessageVariantGate: {
				markSessionCreated: () => {},
				clear: () => {},
			},
			managers: createEventHandlerManagers({
				monitorManager: {
					stopSessionMonitors: async () => {},
					handleEvent,
				},
				tmuxSessionManager: {
					onEvent: (event: EventInput["event"]) => {
						callOrder.push(`idleHook:${event.type}`)
					},
					onSessionCreated: async () => {},
					onSessionDeleted: async () => {},
				},
			}),
			hooks: createEventHandlerHooks({}),
		})

		//#when
		await eventHandler(asEventHandlerInput(idleEvent))

		//#then
		expect(handleEvent).toHaveBeenCalledTimes(1)
		expect(handleEvent).toHaveBeenCalledWith({ type: "session.idle", sessionId: "ses_monitor_idle" })
		expect(callOrder).toEqual(["idleHook:session.idle", "monitor:session.idle"])
	})

	it("#given existing deleted-session cleanup state #when session.deleted arrives #then monitor teardown does not skip cleanup", async () => {
		//#given
		const sessionID = "ses_monitor_cleanup"
		const clearedSessions: string[] = []
		const disconnectedSessions: string[] = []
		const deletedSessions: string[] = []
		const stopSessionMonitors = mock(async (_sessionID: string) => {})
		setSessionPromptParams(sessionID, {
			temperature: 0.2,
			topP: 0.8,
			options: { reasoningEffort: "high" },
		})
		const eventHandler = createEventHandler({
			ctx: cast<EventHandlerArgs["ctx"]>({}),
			pluginConfig: cast<EventHandlerArgs["pluginConfig"]>({
				tmux: { enabled: true },
			}),
			firstMessageVariantGate: {
				markSessionCreated: () => {},
				clear: (deletedSessionID: string) => {
					clearedSessions.push(deletedSessionID)
				},
			},
			managers: createEventHandlerManagers({
				skillMcpManager: {
					disconnectSession: async (deletedSessionID: string) => {
						disconnectedSessions.push(deletedSessionID)
					},
				},
				monitorManager: {
					stopSessionMonitors,
					handleEvent: () => {},
				},
				tmuxSessionManager: {
					onEvent: () => {},
					onSessionCreated: async () => {},
					onSessionDeleted: async ({ sessionID: deletedSessionID }: { sessionID: string }) => {
						deletedSessions.push(deletedSessionID)
					},
				},
			}),
			hooks: createEventHandlerHooks({}),
		})

		//#when
		await eventHandler(asEventHandlerInput({
			event: {
				type: "session.deleted",
				properties: { info: { id: sessionID } },
			},
		}))

		//#then
		expect(stopSessionMonitors).toHaveBeenCalledWith(sessionID)
		expect(disconnectedSessions).toEqual([sessionID])
		expect(deletedSessions).toEqual([sessionID])
		expect(clearedSessions).toEqual([sessionID])
		expect(getSessionPromptParams(sessionID)).toBeUndefined()
	})
})
