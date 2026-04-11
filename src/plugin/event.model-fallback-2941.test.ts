declare const require: (name: string) => any
const { afterEach, describe, expect, spyOn, test } = require("bun:test")

import { createEventHandler } from "./event"
import { createChatMessageHandler } from "./chat-message"
import { _resetForTesting, setSessionAgent } from "../features/claude-code-session-state"
import { clearPendingModelFallback, createModelFallbackHook, setSessionFallbackChain } from "../hooks/model-fallback/hook"
import * as connectedProvidersCache from "../shared/connected-providers-cache"

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

function asPluginConfig(config: unknown): EventHandlerArgs["pluginConfig"] {
	return config as unknown as EventHandlerArgs["pluginConfig"]
}

function asChatMessageHandlerContext(ctx: unknown): ChatMessageHandlerArgs["ctx"] {
	return ctx as unknown as ChatMessageHandlerArgs["ctx"]
}

function asChatPluginConfig(config: unknown): ChatMessageHandlerArgs["pluginConfig"] {
	return config as unknown as ChatMessageHandlerArgs["pluginConfig"]
}

function createEventHandlerManagers(): EventHandlerArgs["managers"] {
	return {
		tmuxSessionManager: {
			onSessionCreated: async () => {},
			onSessionDeleted: async () => {},
		},
		skillMcpManager: {
			disconnectSession: async () => {},
		},
	} as unknown as EventHandlerArgs["managers"]
}

function createEventHandlerHooks(modelFallback: ReturnType<typeof createModelFallbackHook>): EventHandlerArgs["hooks"] {
	return {
		modelFallback,
	} as unknown as EventHandlerArgs["hooks"]
}

function createChatMessageHandlerHooks(modelFallback: ReturnType<typeof createModelFallbackHook>): ChatMessageHandlerArgs["hooks"] {
	return {
		modelFallback,
		stopContinuationGuard: null,
		keywordDetector: null,
		claudeCodeHooks: null,
		autoSlashCommand: null,
		startWork: null,
		ralphLoop: null,
	} as unknown as ChatMessageHandlerArgs["hooks"]
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

		clearPendingModelFallback(sessionID)
		setSessionAgent(sessionID, "sisyphus-junior")
		setSessionFallbackChain(sessionID, undefined)

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
