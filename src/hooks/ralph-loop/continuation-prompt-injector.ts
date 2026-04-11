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
	let model: { providerID: string; modelID: string; variant?: string } | undefined
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
			if (info?.agent || info?.model || (info?.modelID && info?.providerID)) {
				agent = info.agent
				model =
					info.model ??
					(info.providerID && info.modelID
						? { providerID: info.providerID, modelID: info.modelID }
						: undefined)
				tools = info.tools
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
					...(currentMessage.model.variant ? { variant: currentMessage.model.variant } : {}),
				}
				: undefined
		tools = currentMessage?.tools
	}

	const inheritedTools = resolveInheritedPromptTools(sourceSessionID, tools)

	const launchModel = model
		? { providerID: model.providerID, modelID: model.modelID }
		: undefined
	const launchVariant = model?.variant

	await ctx.client.session.promptAsync({
		path: { id: options.sessionID },
		body: {
			...(agent !== undefined ? { agent } : {}),
			...(launchModel ? { model: launchModel } : {}),
			...(launchVariant ? { variant: launchVariant } : {}),
			...(inheritedTools ? { tools: inheritedTools } : {}),
			parts: [createInternalAgentTextPart(options.prompt)],
		},
		query: { directory: options.directory },
	})

	log("[ralph-loop] continuation injected", { sessionID: options.sessionID })
}
