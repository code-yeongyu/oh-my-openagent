import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { findNearestMessageWithFields } from "../../features/hook-message-injector"
import { getMessageDir } from "./message-storage-directory"
import { withTimeout } from "./with-timeout"
import {
	createInternalAgentContinuationTextPart,
	isAmbiguousPostDispatchPromptFailure,
	isRecord,
	normalizeSDKResponse,
	resolveInheritedPromptTools,
} from "../../shared"
import { normalizeAgentForPrompt, stripAgentListSortPrefix } from "../../shared/agent-display-names"
import { dispatchInternalPrompt } from "../shared/prompt-async-gate"

type MessageInfo = {
	agent?: string
	model?: { providerID: string; modelID: string; variant?: string }
	modelID?: string
	providerID?: string
	tools?: Record<string, boolean | "allow" | "deny" | "ask">
}

export type ContinuationPromptResult =
	| { status: "dispatched" }
	| { status: "deferred"; reason: "active" | "reserved" }
	| { status: "rejected"; error: Error }

function extractPromptAsyncError(response: unknown): unknown | undefined {
	if (!isRecord(response) || !Object.hasOwn(response, "error")) {
		return undefined
	}

	return response.error ?? "Unknown promptAsync error"
}

function describePromptAsyncError(error: unknown): string {
	if (error instanceof Error) {
		return error.message
	}

	if (typeof error === "string") {
		return error
	}

	if (isRecord(error)) {
		const message = error.message
		if (typeof message === "string") {
			return message
		}
	}

	try {
		return JSON.stringify(error)
	} catch {
		return String(error)
	}
}

function createPromptAsyncError(prefix: string, error: unknown): Error {
	return new Error(`${prefix}: ${describePromptAsyncError(error)}`)
}

function normalizeInheritedAgentForPrompt(agent: string | undefined): string | undefined {
	if (typeof agent !== "string") {
		return undefined
	}

	const inheritedAgent = stripAgentListSortPrefix(agent).trim()
	if (!inheritedAgent) {
		return undefined
	}

	if (inheritedAgent.includes(" - ")) {
		return inheritedAgent
	}

	return normalizeAgentForPrompt(inheritedAgent)
}

export async function injectContinuationPrompt(
	ctx: PluginInput,
	options: {
		sessionID: string
		prompt: string
		directory: string
		apiTimeoutMs: number
		inheritFromSessionID?: string
		idleSettleMs?: number
	},
): Promise<ContinuationPromptResult> {
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
	const cleanAgent = normalizeInheritedAgentForPrompt(agent)

	const launchModel = model
		? { providerID: model.providerID, modelID: model.modelID }
		: undefined
	const launchVariant = model?.variant

	let response: unknown
	try {
		const promptResult = await dispatchInternalPrompt({
			mode: "async",
			client: ctx.client,
			sessionID: options.sessionID,
			source: "ralph-loop",
			settleMs: options.idleSettleMs,
			queueBehavior: "defer",
			input: {
				path: { id: options.sessionID },
				body: {
					...(cleanAgent !== undefined ? { agent: cleanAgent } : {}),
					...(launchModel ? { model: launchModel } : {}),
					...(launchVariant ? { variant: launchVariant } : {}),
					...(inheritedTools ? { tools: inheritedTools } : {}),
					parts: [createInternalAgentContinuationTextPart(options.prompt)],
				},
				query: { directory: options.directory },
			},
		})
		if (promptResult.status === "failed") {
			if (isAmbiguousPostDispatchPromptFailure(promptResult)) {
				return { status: "dispatched" }
			}
			throw promptResult.error
		}
		if (promptResult.status === "queued") {
			return { status: "deferred", reason: "reserved" }
		}
		if (promptResult.status === "active" || promptResult.status === "reserved") {
			return { status: "deferred", reason: promptResult.status }
		}
		if (promptResult.status !== "dispatched") {
			return {
				status: "rejected",
				error: createPromptAsyncError(`promptAsync skipped: ${promptResult.status}`, promptResult),
			}
		}
		response = promptResult.response
	} catch (error) {
		const promptError = error instanceof Error
			? error
			: createPromptAsyncError("promptAsync rejected", error)
		log("[ralph-loop] continuation prompt rejected", {
			sessionID: options.sessionID,
			error: String(promptError),
		})
		return { status: "rejected", error: promptError }
	}
	const promptError = extractPromptAsyncError(response)
	if (promptError !== undefined) {
		const error = createPromptAsyncError("promptAsync returned error", promptError)
		log("[ralph-loop] continuation prompt rejected", {
			sessionID: options.sessionID,
			error: String(error),
		})
		return { status: "rejected", error }
	}

	log("[ralph-loop] continuation injected", { sessionID: options.sessionID })
	return { status: "dispatched" }
}
