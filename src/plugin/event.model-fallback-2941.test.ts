declare const require: (name: string) => any
const { afterEach, describe, expect, spyOn, test } = require("bun:test")

import { createEventHandler } from "./event"
import { createChatMessageHandler } from "./chat-message"
import { _resetForTesting, setSessionAgent } from "../features/claude-code-session-state"
import { clearPendingModelFallback, createModelFallbackHook, setSessionFallbackChain } from "../hooks/model-fallback/hook"
import * as connectedProvidersCache from "../shared/connected-providers-cache"
import { unsafeTestValue } from "../../test-support/unsafe-test-value"

type EventInput = { event: { type: string; properties?: unknown } }
type EventHandlerArgs = Parameters<typeof createEventHandler>[0]
type EventHandlerInput = Parameters<ReturnType<typeof createEventHandler>>[0]
type ChatMessageHandlerArgs = Parameters<typeof createChatMessageHandler>[0]

function asEventHandlerInput(input: EventInput): EventHandlerInput {
	return unsafeTestValue<EventHandlerInput>(input)
}

function asEventHandlerContext(ctx: unknown): EventHandlerArgs["ctx"] {
	return unsafeTestValue<EventHandlerArgs["ctx"]>(ctx)
}

function asPluginConfig(config: unknown): EventHandlerArgs["pluginConfig"] {
	return unsafeTestValue<EventHandlerArgs["pluginConfig"]>(config)
}

function asChatMessageHandlerContext(ctx: unknown): ChatMessageHandlerArgs["ctx"] {
	return unsafeTestValue<ChatMessageHandlerArgs["ctx"]>(ctx)
}

function asChatPluginConfig(config: unknown): ChatMessageHandlerArgs["pluginConfig"] {
	return unsafeTestValue<ChatMessageHandlerArgs["pluginConfig"]>(config)
}

function createEventHandlerManagers(): EventHandlerArgs["managers"] {
	return unsafeTestValue<EventHandlerArgs["managers"]>({
		tmuxSessionManager: {
			onSessionCreated: async () => {},
			onSessionDeleted: async () => {},
		},
		skillMcpManager: {
			disconnectSession: async () => {},
		},
	})
}

function createEventHandlerHooks(modelFallback: ReturnType<typeof createModelFallbackHook>): EventHandlerArgs["hooks"] {
	return unsafeTestValue<EventHandlerArgs["hooks"]>({
		modelFallback,
	})
}

function createChatMessageHandlerHooks(modelFallback: ReturnType<typeof createModelFallbackHook>): ChatMessageHandlerArgs["hooks"] {
	return unsafeTestValue<ChatMessageHandlerArgs["hooks"]>({
		modelFallback,
		stopContinuationGuard: null,
		keywordDetector: null,
		claudeCodeHooks: null,
		autoSlashCommand: null,
		startWork: null,
		ralphLoop: null,
	})
}

let readConnectedProvidersCacheSpy: { mockRestore: () => void } | undefined
let readProviderModelsCacheSpy: { mockRestore: () => void } | undefined

		afterEach(() => {
			readConnectedProvidersCacheSpy?.mockRestore()
			readProviderModelsCacheSpy?.mockRestore()
			readConnectedProvidersCacheSpy = undefined
			readProviderModelsCacheSpy = undefined
			_resetForTesting()
		})

describe("createEventHandler - category runtime fallback suppression", () => {
	test("does not arm retry fallback when category session explicitly stores no fallback chain [regression #2941]", async () => {
		//#given
		const sessionID = "ses_category_override_no_fallback"
		const abortCalls: string[] = []
		const promptCalls: string[] = []

		readConnectedProvidersCacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null)
		readProviderModelsCacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue(null)

		const modelFallback = createModelFallbackHook()
		clearPendingModelFallback(modelFallback, sessionID)
		setSessionAgent(sessionID, "sisyphus-junior")
		setSessionFallbackChain(modelFallback, sessionID, undefined)
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
			managers: createEventHandlerManagers(),
			hooks: createEventHandlerHooks(modelFallback),
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
			hooks: createChatMessageHandlerHooks(modelFallback),
		})

		//#when
		await eventHandler(asEventHandlerInput({
			event: {
				type: "session.error",
				properties: {
					sessionID,
					error: {
						name: "APIError",
						data: {
							message:
								"Bad Gateway: {\"error\":{\"message\":\"unknown provider for model claude-sonnet-4-6\"}}",
							isRetryable: true,
						},
					},
				},
			},
		}))

		const output = { message: {}, parts: [] as Array<{ type: string; text?: string }> }
		await chatMessageHandler(
			{
				sessionID,
				agent: "sisyphus-junior",
				model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
			},
			output,
		)

		//#then
		expect(abortCalls).toEqual([])
		expect(promptCalls).toEqual([])
		expect(output.message["model"]).toBeUndefined()
	})
})
