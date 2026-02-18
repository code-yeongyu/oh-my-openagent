import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { findNearestMessageWithFields } from "../../features/hook-message-injector"
import { getMessageDir } from "./message-storage-directory"
import { withTimeout } from "./with-timeout"
import { normalizeSDKResponse, resolveInheritedPromptTools } from "../../shared"

type MessageInfo = {
	agent?: string
	model?: { providerID: string; modelID: string }
	modelID?: string
	providerID?: string
	tools?: Record<string, boolean | "allow" | "deny" | "ask">
}

export async function injectContinuationPrompt(
	ctx: PluginInput,
	options: { sessionID: string; prompt: string; directory: string; apiTimeoutMs: number },
): Promise<void> {
	let agent: string | undefined
	let model: { providerID: string; modelID: string } | undefined
	let tools: Record<string, boolean | "allow" | "deny" | "ask"> | undefined

	try {
		const messagesResp = await withTimeout(
			ctx.client.session.messages({
				path: { id: options.sessionID },
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
		const messageDir = getMessageDir(options.sessionID)
		const currentMessage = messageDir ? findNearestMessageWithFields(messageDir) : null
		agent = currentMessage?.agent
		model =
			currentMessage?.model?.providerID && currentMessage?.model?.modelID
				? {
					providerID: currentMessage.model.providerID,
					modelID: currentMessage.model.modelID,
				}
				: undefined
		tools = currentMessage?.tools
	}

	const inheritedTools = resolveInheritedPromptTools(options.sessionID, tools)

	await ctx.client.session.promptAsync({
		path: { id: options.sessionID },
		body: {
			...(agent !== undefined ? { agent } : {}),
			...(model !== undefined ? { model } : {}),
			...(inheritedTools ? { tools: inheritedTools } : {}),
			parts: [{ type: "text", text: options.prompt }],
		},
		query: { directory: options.directory },
	})

	log("[ralph-loop] continuation injected", { sessionID: options.sessionID })
}
