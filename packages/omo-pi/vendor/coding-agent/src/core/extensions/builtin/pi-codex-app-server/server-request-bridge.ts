import { type AdapterJsonRpcError, createAdapterJsonRpcError } from "./error-mapper.ts";
import type { IdMapper } from "./id-mapper.ts";
import type { OpaqueAppServerEnvelope } from "./notification-projector.ts";
import {
	createOpaqueServerRequestEnvelope,
	readAppServerRequestIds,
	readRequestId,
	readSecretQuestionIds,
	redactSecretAnswers,
} from "./server-request-fields.ts";
import type { SessionRegistry } from "./session-registry.ts";

export interface AppServerCallbackClient {
	respond(appRequestId: string, response: unknown): Promise<void>;
	reject(appRequestId: string, reason: string): Promise<void>;
}

export interface ServerRequestBridgeOptions {
	readonly connectionId: string;
	readonly capabilityFlags: readonly string[];
	readonly callbackTimeoutMs: number;
	readonly nowMs: () => number;
	readonly idMapper: IdMapper;
	readonly sessionRegistry: SessionRegistry;
	readonly callbackClient: AppServerCallbackClient;
}

export interface AppServerRequestInput {
	readonly method: string;
	readonly requestId: string | number;
	readonly params: unknown;
}

export interface CallbackResponseInput {
	readonly externalCallbackId: string;
	readonly response: unknown;
}

export interface CallbackRejectionInput {
	readonly externalCallbackId: string;
	readonly reason: string;
}

export interface ServerRequestResolvedInput {
	readonly method: string;
	readonly params: unknown;
}

export interface OpaqueServerRequestProjection {
	readonly kind: "opaque-request";
	readonly method: "appServer/request";
	readonly externalCallbackId: string;
	readonly timeoutAtMs: number;
	readonly envelope: OpaqueAppServerEnvelope;
}

export type ServerRequestDeliveryResult =
	| { readonly kind: "delivered"; readonly request: OpaqueServerRequestProjection }
	| { readonly kind: "adapter-error"; readonly error: AdapterJsonRpcError };

export type CallbackForwardResult =
	| { readonly kind: "forwarded" }
	| { readonly kind: "adapter-error"; readonly error: AdapterJsonRpcError };

export type ServerRequestResolvedResult =
	| { readonly kind: "resolved"; readonly appRequestId: string }
	| { readonly kind: "ignored" };

export interface TimedOutCallback {
	readonly appRequestId: string;
	readonly externalCallbackId: string;
}

export interface ServerRequestBridge {
	deliver(input: AppServerRequestInput): ServerRequestDeliveryResult;
	respond(input: CallbackResponseInput): Promise<CallbackForwardResult>;
	reject(input: CallbackRejectionInput): Promise<CallbackForwardResult>;
	replayPendingCallbacks(): readonly OpaqueServerRequestProjection[];
	rejectPendingCallbacks(reason: string): Promise<readonly TimedOutCallback[]>;
	rejectTimedOutCallbacks(nowMs?: number): Promise<readonly TimedOutCallback[]>;
	resolveFromNotification(input: ServerRequestResolvedInput): ServerRequestResolvedResult;
	redactCallbackResponse(externalCallbackId: string, response: unknown): unknown;
}

type CallbackStatus = "pending" | "forwarded" | "timed-out";

interface CallbackState {
	readonly appRequestId: string;
	readonly externalCallbackId: string;
	readonly timeoutAtMs: number;
	readonly secretQuestionIds: ReadonlySet<string>;
	readonly request: OpaqueServerRequestProjection;
	status: CallbackStatus;
}

export function createServerRequestBridge(options: ServerRequestBridgeOptions): ServerRequestBridge {
	return new DefaultServerRequestBridge(options);
}

class DefaultServerRequestBridge implements ServerRequestBridge {
	private readonly connectionId: string;
	private readonly capabilityFlags: readonly string[];
	private readonly callbackTimeoutMs: number;
	private readonly nowMs: () => number;
	private readonly idMapper: IdMapper;
	private readonly sessionRegistry: SessionRegistry;
	private readonly callbackClient: AppServerCallbackClient;
	private readonly callbacksByExternalId = new Map<string, CallbackState>();
	private readonly externalCallbackIdByAppRequestId = new Map<string, string>();
	private sequence = 0;

	constructor(options: ServerRequestBridgeOptions) {
		this.connectionId = options.connectionId;
		this.capabilityFlags = options.capabilityFlags;
		this.callbackTimeoutMs = options.callbackTimeoutMs;
		this.nowMs = options.nowMs;
		this.idMapper = options.idMapper;
		this.sessionRegistry = options.sessionRegistry;
		this.callbackClient = options.callbackClient;
	}

	deliver(input: AppServerRequestInput): ServerRequestDeliveryResult {
		if (!isSupportedCallbackMethod(input.method)) {
			return invalidCallback(`Unsupported PR-008/PR-009 callback method: ${input.method}`);
		}
		const appRequestId = String(input.requestId);
		const ids = readAppServerRequestIds(input.params);
		const externalCallbackId = `callback-${appRequestId}`;
		const timeoutAtMs = this.nowMs() + this.callbackTimeoutMs;
		const registration = this.idMapper.registerServerRequest({
			appRequestId,
			externalCallbackId,
			appThreadId: ids.appThreadId,
			appTurnId: ids.appTurnId,
			appItemId: ids.appItemId,
			method: input.method,
		});
		if (registration.kind === "rejected") return { kind: "adapter-error", error: registration.error };

		const state: CallbackState = {
			appRequestId,
			externalCallbackId,
			timeoutAtMs,
			secretQuestionIds: readSecretQuestionIds(input.params),
			request: {
				kind: "opaque-request",
				method: "appServer/request",
				externalCallbackId,
				timeoutAtMs,
				envelope: createOpaqueServerRequestEnvelope({
					connectionId: this.connectionId,
					capabilityFlags: this.capabilityFlags,
					externalCallbackId,
					appRequestId,
					method: input.method,
					params: input.params,
					ids,
					sequence: this.nextSequence(),
					sessionRegistry: this.sessionRegistry,
				}),
			},
			status: "pending",
		};
		this.callbacksByExternalId.set(externalCallbackId, state);
		this.externalCallbackIdByAppRequestId.set(appRequestId, externalCallbackId);
		return {
			kind: "delivered",
			request: state.request,
		};
	}

	async respond(input: CallbackResponseInput): Promise<CallbackForwardResult> {
		const state = this.readPendingCallback(input.externalCallbackId);
		if (state.kind === "adapter-error") return state;
		await this.callbackClient.respond(state.callback.appRequestId, input.response);
		state.callback.status = "forwarded";
		return { kind: "forwarded" };
	}

	async reject(input: CallbackRejectionInput): Promise<CallbackForwardResult> {
		const state = this.readPendingCallback(input.externalCallbackId);
		if (state.kind === "adapter-error") return state;
		await this.callbackClient.reject(state.callback.appRequestId, input.reason);
		state.callback.status = "forwarded";
		return { kind: "forwarded" };
	}

	replayPendingCallbacks(): readonly OpaqueServerRequestProjection[] {
		return [...this.callbacksByExternalId.values()]
			.filter((state) => state.status === "pending")
			.map((state) => state.request);
	}

	async rejectPendingCallbacks(reason: string): Promise<readonly TimedOutCallback[]> {
		const rejected: TimedOutCallback[] = [];
		for (const state of this.callbacksByExternalId.values()) {
			if (state.status !== "pending") continue;
			await this.callbackClient.reject(state.appRequestId, reason);
			this.clearCallbackState(state);
			rejected.push({ appRequestId: state.appRequestId, externalCallbackId: state.externalCallbackId });
		}
		return rejected;
	}

	async rejectTimedOutCallbacks(nowMs = this.nowMs()): Promise<readonly TimedOutCallback[]> {
		const timedOut: TimedOutCallback[] = [];
		for (const state of this.callbacksByExternalId.values()) {
			if ((state.status !== "pending" && state.status !== "timed-out") || state.timeoutAtMs > nowMs) continue;
			state.status = "timed-out";
			await this.callbackClient.reject(state.appRequestId, "callback timed out");
			this.clearCallbackState(state);
			timedOut.push({ appRequestId: state.appRequestId, externalCallbackId: state.externalCallbackId });
		}
		return timedOut;
	}

	resolveFromNotification(input: ServerRequestResolvedInput): ServerRequestResolvedResult {
		if (input.method !== "serverRequest/resolved") return { kind: "ignored" };
		const appRequestId = readRequestId(input.params);
		if (!appRequestId) return { kind: "ignored" };
		const externalCallbackId = this.externalCallbackIdByAppRequestId.get(appRequestId);
		if (externalCallbackId) {
			const state = this.callbacksByExternalId.get(externalCallbackId);
			if (state) this.clearCallbackState(state);
		} else {
			this.idMapper.resolveServerRequest(appRequestId);
		}
		return { kind: "resolved", appRequestId };
	}

	redactCallbackResponse(externalCallbackId: string, response: unknown): unknown {
		const state = this.callbacksByExternalId.get(externalCallbackId);
		if (!state) return response;
		return redactSecretAnswers(response, state.secretQuestionIds);
	}

	private nextSequence(): number {
		this.sequence += 1;
		return this.sequence;
	}

	private readPendingCallback(
		externalCallbackId: string,
	):
		| { readonly kind: "callback"; readonly callback: CallbackState }
		| { readonly kind: "adapter-error"; readonly error: AdapterJsonRpcError } {
		const callback = this.callbacksByExternalId.get(externalCallbackId);
		if (callback?.status !== "pending") {
			return invalidCallback(`Unknown, duplicate, or timed-out callback id: ${externalCallbackId}`);
		}
		return { kind: "callback", callback };
	}

	private clearCallbackState(state: CallbackState): void {
		this.callbacksByExternalId.delete(state.externalCallbackId);
		this.externalCallbackIdByAppRequestId.delete(state.appRequestId);
		this.idMapper.resolveServerRequest(state.appRequestId);
	}
}

const SUPPORTED_CALLBACK_METHODS: ReadonlySet<string> = new Set([
	"item/commandExecution/requestApproval",
	"item/fileChange/requestApproval",
	"item/tool/requestUserInput",
	"mcpServer/elicitation/request",
	"item/permissions/requestApproval",
	"item/tool/call",
] satisfies readonly string[]);

function isSupportedCallbackMethod(method: string): boolean {
	return SUPPORTED_CALLBACK_METHODS.has(method);
}

function invalidCallback(message: string): { readonly kind: "adapter-error"; readonly error: AdapterJsonRpcError } {
	return {
		kind: "adapter-error",
		error: createAdapterJsonRpcError({ adapterCode: "invalid-callback-state", message }),
	};
}
