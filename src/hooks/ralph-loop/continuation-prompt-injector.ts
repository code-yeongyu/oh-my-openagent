import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { findNearestMessageWithFields } from "../../features/hook-message-injector"
import { getMessageDir } from "./message-storage-directory"
import { withTimeout } from "./with-timeout"
import {
	createInternalAgentTextPart,
	normalizeSDKResponse,
	resolveInheritedPromptTools,
} from "../../shared"

type MessageInfo = {
	agent?: string
	model?: { providerID: string; modelID: string; variant?: string }
	modelID?: string
	providerID?: string
	variant?: string
	tools?: Record<string, boolean | "allow" | "deny" | "ask">
}

export async function injectContinuationPrompt(
	ctx: PluginInput,
	options: {
		sessionID: string
		prompt: string
		directory: string
		apiTimeoutMs: number
		inheritFromSessionID?: string
	},
): Promise<void> {
	let agent: string | undefined
	let model: { providerID: string; modelID: string } | undefined
	let variant: string | undefined
	let tools: Record<string, boolean | "allow" | "deny" | "ask"> | undefined
	const sourceSessionID = options.inheritFromSessionID ?? options.sessionID

	try {
		const messagesResp = await withTimeout(
			ctx.client.session.messages({
				path: { id: sourceSessionID },
			}),
			options.apiTimeoutMs,
		)
		const messages = normalizeSDKResponse(messagesResp, [] as Array<{ info?: MessageInfo }>)
		for (let i = messages.length - 1; i >= 0; i--) {
			const info = messages[i]?.info
			if (!info) {
				continue
			}

			if (agent === undefined && typeof info.agent === "string") {
				agent = info.agent
			}

			if (model === undefined) {
				if (info.model?.providerID && info.model?.modelID) {
					model = {
						providerID: info.model.providerID,
						modelID: info.model.modelID,
					}
				} else if (info.providerID && info.modelID) {
					model = { providerID: info.providerID, modelID: info.modelID }
				}
			}

			if (variant === undefined) {
				if (typeof info.variant === "string") {
					variant = info.variant
				} else if (typeof info.model?.variant === "string") {
					variant = info.model.variant
				}
			}

			if (tools === undefined && info.tools) {
				tools = info.tools
			}

			if (agent !== undefined && model !== undefined && variant !== undefined && tools !== undefined) {
				break
			}
		}
	} catch {
		const messageDir = getMessageDir(sourceSessionID)
		const currentMessage = messageDir ? findNearestMessageWithFields(messageDir) : null
		agent = currentMessage?.agent
		model =
			currentMessage?.model?.providerID && currentMessage?.model?.modelID
				? {
					providerID: currentMessage.model.providerID,
					modelID: currentMessage.model.modelID,
				}
				: undefined
		variant = currentMessage?.model?.variant
		tools = currentMessage?.tools
	}

	const inheritedTools = resolveInheritedPromptTools(sourceSessionID, tools)

	await ctx.client.session.promptAsync({
		path: { id: options.sessionID },
		body: {
			...(agent !== undefined ? { agent } : {}),
			...(model !== undefined ? { model } : {}),
			...(variant !== undefined ? { variant } : {}),
			...(inheritedTools ? { tools: inheritedTools } : {}),
			parts: [createInternalAgentTextPart(options.prompt)],
		},
		query: { directory: options.directory },
	})

	log("[ralph-loop] continuation injected", { sessionID: options.sessionID })
}
