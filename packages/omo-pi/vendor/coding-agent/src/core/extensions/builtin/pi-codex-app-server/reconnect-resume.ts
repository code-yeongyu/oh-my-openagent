import { type AdapterJsonRpcError, createAdapterJsonRpcError } from "./error-mapper.ts";
import { parseResumeToken, type ResumeTokenPayload } from "./reconnect-resume-token.ts";
import type { AppServerRequestClient } from "./request-router.ts";
import type { ReplayCursor, SessionBinding, SessionRegistry } from "./session-registry.ts";

const REPLAY_CLAIM = "snapshot-plus-new-stream";

export { createResumeToken } from "./reconnect-resume-token.ts";

export interface ReconnectResumeCoordinatorOptions {
	readonly connectionId: string;
	readonly client: AppServerRequestClient;
	readonly sessionRegistry: SessionRegistry;
}

export interface ReconnectResumeCoordinator {
	resumeFromToken(token: string): Promise<ReconnectResumeResult>;
	recordTerminalNotification(input: TerminalNotificationInput): TerminalRecordResult;
	createDisconnectEvent(message: string): DisconnectEvent;
}

export interface ResumeEvent {
	readonly kind: "resume";
	readonly method: "resume";
	readonly connectionId: string;
	readonly externalSessionId: string;
	readonly appThreadId: string;
	readonly appSessionId: string;
	readonly streamClass: "snapshot-authoritative";
	readonly replayCursor: ReplayCursor;
	readonly replayClaim: typeof REPLAY_CLAIM;
	readonly snapshot: ResumeSnapshot;
}

export interface ResumeSnapshot {
	readonly threadResume: unknown;
	readonly threadRead: unknown;
	readonly turns: unknown;
	readonly items: unknown;
}

export interface DisconnectEvent {
	readonly kind: "disconnect";
	readonly method: "disconnect";
	readonly connectionId: string;
	readonly streamClass: "control";
	readonly message: string;
	readonly replayClaim: typeof REPLAY_CLAIM;
}

export type ReconnectResumeResult =
	| { readonly kind: "resumed"; readonly event: ResumeEvent }
	| { readonly kind: "adapter-error"; readonly error: AdapterJsonRpcError };

export interface TerminalNotificationInput {
	readonly method: string;
	readonly params: unknown;
	readonly sequence: number;
}

export type TerminalRecordResult =
	| {
			readonly kind: "recorded";
			readonly externalSessionId: string;
			readonly appTurnId: string;
			readonly sequence: number;
	  }
	| { readonly kind: "duplicate-terminal"; readonly externalSessionId: string; readonly appTurnId: string }
	| { readonly kind: "ignored" }
	| { readonly kind: "adapter-error"; readonly error: AdapterJsonRpcError };

export function createReconnectResumeCoordinator(
	options: ReconnectResumeCoordinatorOptions,
): ReconnectResumeCoordinator {
	return new DefaultReconnectResumeCoordinator(options);
}

class DefaultReconnectResumeCoordinator implements ReconnectResumeCoordinator {
	private readonly connectionId: string;
	private readonly client: AppServerRequestClient;
	private readonly sessionRegistry: SessionRegistry;
	private readonly completedTurnKeys = new Set<string>();

	constructor(options: ReconnectResumeCoordinatorOptions) {
		this.connectionId = options.connectionId;
		this.client = options.client;
		this.sessionRegistry = options.sessionRegistry;
	}

	async resumeFromToken(token: string): Promise<ReconnectResumeResult> {
		const payload = parseResumeToken(token);
		if (payload.kind === "adapter-error") return payload;
		const binding = this.bindOrReuseSession(payload.payload);
		if (binding.kind === "adapter-error") return binding;

		const threadResume = await this.client.request("thread/resume", {
			thread_id: binding.binding.appThreadId,
			session_id: binding.binding.appSessionId,
		});
		const threadRead = await this.client.request("thread/read", { thread_id: binding.binding.appThreadId });
		const turns = await this.client.request(
			"thread/turns/list",
			withOptionalCursor(
				{ thread_id: binding.binding.appThreadId },
				"after_turn_id",
				binding.binding.replayCursor.lastCompletedTurnId,
			),
		);
		const items = await this.client.request(
			"thread/turns/items/list",
			withOptionalCursor(
				{ thread_id: binding.binding.appThreadId },
				"after_item_id",
				binding.binding.replayCursor.lastProjectedItemId,
			),
		);

		return {
			kind: "resumed",
			event: {
				kind: "resume",
				method: "resume",
				connectionId: this.connectionId,
				externalSessionId: binding.binding.externalSessionId,
				appThreadId: binding.binding.appThreadId,
				appSessionId: binding.binding.appSessionId,
				streamClass: "snapshot-authoritative",
				replayCursor: binding.binding.replayCursor,
				replayClaim: REPLAY_CLAIM,
				snapshot: { threadResume, threadRead, turns, items },
			},
		};
	}

	recordTerminalNotification(input: TerminalNotificationInput): TerminalRecordResult {
		if (!isTerminalNotification(input.method)) return { kind: "ignored" };
		const params = readRecord(input.params);
		if (!params) return invalidSession("Terminal notification params must be an object.");
		const appThreadId = readString(params, "threadId") ?? readString(params, "thread_id");
		const appTurnId = readAppTurnId(params);
		if (!appThreadId || !appTurnId) return invalidSession("Terminal notification requires thread and turn IDs.");
		const binding = this.sessionRegistry.getByAppThreadId(appThreadId);
		if (!binding || binding.tombstoned)
			return invalidSession(`Unknown or tombstoned app-server thread: ${appThreadId}`);
		const terminalKey = `${appThreadId}:${appTurnId}`;
		if (this.completedTurnKeys.has(terminalKey)) {
			return { kind: "duplicate-terminal", externalSessionId: binding.externalSessionId, appTurnId };
		}
		this.completedTurnKeys.add(terminalKey);
		const appItemId = readString(params, "itemId") ?? readString(params, "item_id");
		this.sessionRegistry.updateReplayCursor(binding.externalSessionId, {
			...binding.replayCursor,
			lastCompletedTurnId: appTurnId,
			...(appItemId ? { lastProjectedItemId: appItemId } : {}),
			lastLosslessSequence: input.sequence,
		});
		return {
			kind: "recorded",
			externalSessionId: binding.externalSessionId,
			appTurnId,
			sequence: input.sequence,
		};
	}

	createDisconnectEvent(message: string): DisconnectEvent {
		return {
			kind: "disconnect",
			method: "disconnect",
			connectionId: this.connectionId,
			streamClass: "control",
			message,
			replayClaim: REPLAY_CLAIM,
		};
	}

	private bindOrReuseSession(
		payload: ResumeTokenPayload,
	):
		| { readonly kind: "active"; readonly binding: SessionBinding }
		| { readonly kind: "adapter-error"; readonly error: AdapterJsonRpcError } {
		const existing = this.sessionRegistry.getByExternalSessionId(payload.externalSessionId);
		if (existing?.tombstoned) return invalidSession(`External session is tombstoned: ${payload.externalSessionId}`);
		if (existing) {
			if (existing.appThreadId !== payload.appThreadId || existing.appSessionId !== payload.appSessionId) {
				return invalidSession(`Resume token does not match existing session binding: ${payload.externalSessionId}`);
			}
			return { kind: "active", binding: existing };
		}
		const bindResult = this.sessionRegistry.bindSession(payload);
		if (bindResult.kind === "rejected") return { kind: "adapter-error", error: bindResult.error };
		const cursorResult = this.sessionRegistry.updateReplayCursor(payload.externalSessionId, payload.replayCursor);
		if (cursorResult.kind === "rejected") return { kind: "adapter-error", error: cursorResult.error };
		return cursorResult;
	}
}

function withOptionalCursor(
	params: Readonly<Record<string, unknown>>,
	key: string,
	value: string | undefined,
): Record<string, unknown> {
	return value ? { ...params, [key]: value } : { ...params };
}

function isTerminalNotification(method: string): boolean {
	return method === "turn/completed" || method === "error";
}

function readAppTurnId(params: Readonly<Record<string, unknown>>): string | undefined {
	const topLevelTurnId = readString(params, "turnId") ?? readString(params, "turn_id") ?? readString(params, "id");
	if (topLevelTurnId) return topLevelTurnId;
	const turn = readRecord(params.turn);
	return turn ? readString(turn, "id") : undefined;
}

function invalidSession(message: string): { readonly kind: "adapter-error"; readonly error: AdapterJsonRpcError } {
	return {
		kind: "adapter-error",
		error: createAdapterJsonRpcError({
			adapterCode: "invalid-session-state",
			message,
			retryable: true,
		}),
	};
}

function readString(input: Readonly<Record<string, unknown>>, key: string): string | undefined {
	const value = input[key];
	return typeof value === "string" ? value : undefined;
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	return Object.fromEntries(Object.entries(value));
}
