import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { isRecord } from "../../shared/record-type-guard"
import { resolveMessageEventSessionID } from "../../shared/event-session-id"
import { HOOK_NAME } from "./constants"
import type { RalphLoopOptions } from "./types"
import type { RalphLoopEventHandlerOptions } from "./event-handler-types"
import { withTimeout } from "./with-timeout"

const USER_MESSAGE_IN_PROGRESS_WINDOW_MS = 2000

export const RAPID_IDLE_DEDUP_MS = 500

export function sleep(ms: number): Promise<void> {
	return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
}

export function hasActiveBackgroundTasks(
	backgroundManager: RalphLoopOptions["backgroundManager"],
	sessionID: string,
): boolean {
	return backgroundManager
		? backgroundManager.getTasksByParentSession(sessionID).some((task: { status: string }) => task.status === "pending" || task.status === "running")
		: false
}

export function getRuntimeRetryActivitySessionID(
	eventType: string,
	props: Record<string, unknown> | undefined,
): string | undefined {
	if (eventType === "message.updated") {
		const info = props?.info as Record<string, unknown> | undefined
		const role = info?.role
		return role === "assistant" ? resolveMessageEventSessionID(props) : undefined
	}

	if (eventType === "message.part.updated") {
		return resolveMessageEventSessionID(props)
	}

	if (eventType === "message.part.delta") {
		return resolveMessageEventSessionID(props)
	}

	if (eventType === "tool.execute.before" || eventType === "tool.execute.after") {
		return resolveMessageEventSessionID(props)
	}

	return undefined
}

export function isSyntheticIdle(props: Record<string, unknown> | undefined): boolean {
	return props?.synthetic === true
}

export function isAbortError(error: unknown): boolean {
	return isRecord(error) && error.name === "MessageAbortedError"
}

function getMessagesData(response: unknown): unknown[] {
	if (Array.isArray(response)) {
		return response
	}
	if (isRecord(response) && Array.isArray(response.data)) {
		return response.data
	}
	return []
}

function getMessageRole(message: unknown): string | undefined {
	if (!isRecord(message)) return undefined
	const info = isRecord(message.info) ? message.info : undefined
	return typeof info?.role === "string"
		? info.role
		: typeof message.role === "string"
			? message.role
			: undefined
}

function parseMessageCreatedAt(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value
	}
	if (typeof value === "string") {
		const parsed = Date.parse(value)
		return Number.isFinite(parsed) ? parsed : undefined
	}
	if (value instanceof Date) {
		return value.getTime()
	}
	return undefined
}

function getMessageCreatedAt(message: unknown): number | undefined {
	if (!isRecord(message)) return undefined
	const info = isRecord(message.info) ? message.info : undefined
	const infoTime = isRecord(info?.time) ? info.time : undefined
	const messageTime = isRecord(message.time) ? message.time : undefined
	return parseMessageCreatedAt(infoTime?.created ?? messageTime?.created)
}

export async function latestUserMessageIsInProgress(
	ctx: PluginInput,
	options: RalphLoopEventHandlerOptions,
	sessionID: string,
	now: number,
): Promise<boolean> {
	try {
		const messagesResponse = await withTimeout(
			ctx.client.session.messages({
				path: { id: sessionID },
				query: { directory: options.directory },
			}),
			options.apiTimeoutMs,
		)
		const messages = getMessagesData(messagesResponse)
		for (let index = messages.length - 1; index >= 0; index--) {
			const message = messages[index]
			const role = getMessageRole(message)
			if (role === "user") {
				const createdAt = getMessageCreatedAt(message)
				return createdAt !== undefined && now - createdAt <= USER_MESSAGE_IN_PROGRESS_WINDOW_MS
			}
			if (role === "assistant" || role === "tool") {
				return false
			}
		}
		return false
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		log(`[${HOOK_NAME}] Failed to inspect recent user activity`, { sessionID, error: message })
		return false
	}
}
