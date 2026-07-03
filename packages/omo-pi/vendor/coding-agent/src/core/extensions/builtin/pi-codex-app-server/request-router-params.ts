import { type AdapterJsonRpcError, createAdapterJsonRpcError } from "./error-mapper.ts";
import type { ExternalProtocolMethodName } from "./protocol-core.ts";
import type { SessionBinding } from "./session-registry.ts";

export interface RoutingParams {
	readonly externalSessionId?: string;
	readonly externalTurnId?: string;
	readonly appTurnId?: string;
	readonly appParams?: unknown;
}

export interface ThreadBinding {
	readonly appThreadId: string;
	readonly appSessionId: string;
}

export interface RouterAdapterErrorResult {
	readonly kind: "adapter-error";
	readonly error: AdapterJsonRpcError;
}

export function parseRoutingParams(params: unknown): RoutingParams {
	if (!isRecord(params)) return {};
	return {
		externalSessionId: readString(params, "externalSessionId"),
		externalTurnId: readString(params, "externalTurnId"),
		appTurnId: readString(params, "appTurnId"),
		appParams: params.appParams,
	};
}

export function appParamsFrom(params: unknown): unknown {
	const routingParams = parseRoutingParams(params);
	return routingParams.appParams ?? {};
}

export function withThreadId(params: unknown, binding: SessionBinding): Record<string, unknown> {
	return withField(params, "thread_id", binding.appThreadId);
}

export function withOptionalField(params: unknown, key: string, value: string | undefined): Record<string, unknown> {
	if (!value) return copyRecord(params);
	return withField(params, key, value);
}

export function withField(params: unknown, key: string, value: string): Record<string, unknown> {
	const copied = copyRecord(params);
	copied[key] = value;
	return copied;
}

export function parseThreadBinding(
	response: unknown,
):
	| { readonly kind: "binding"; readonly binding: ThreadBinding }
	| { readonly kind: "adapter-error"; readonly error: AdapterJsonRpcError } {
	const thread = isRecord(response) && isRecord(response.thread) ? response.thread : response;
	if (!isRecord(thread)) return invalidSession("App-server thread response must be an object.");
	const appThreadId = readString(thread, "id");
	const appSessionId = readString(thread, "session_id");
	if (!appThreadId || !appSessionId) {
		return invalidSession("App-server thread response must include id and session_id.");
	}
	return { kind: "binding", binding: { appThreadId, appSessionId } };
}

export function readTurnId(response: unknown): string | undefined {
	if (!isRecord(response)) return undefined;
	if (isRecord(response.turn)) return readString(response.turn, "id");
	return readString(response, "turn_id") ?? readString(response, "id");
}

export function mapExternalMethod(method: ExternalProtocolMethodName): string {
	const mapped = METHOD_MAP[method];
	return mapped ?? method;
}

export function invalidSession(message: string): RouterAdapterErrorResult {
	return {
		kind: "adapter-error",
		error: createAdapterJsonRpcError({ adapterCode: "invalid-session-state", message }),
	};
}

export function unsupported(method: string): RouterAdapterErrorResult {
	return {
		kind: "adapter-error",
		error: createAdapterJsonRpcError({
			adapterCode: "unsupported-routing-method",
			message: `Unsupported PR-005 routing method: ${method}`,
		}),
	};
}

const METHOD_MAP: Partial<Record<ExternalProtocolMethodName, string>> = {
	"session/new": "thread/start",
	"session/resume": "thread/resume",
	"session/fork": "thread/fork",
	"session/list": "thread/list",
	"session/read": "thread/read",
	"session/archive": "thread/archive",
	"session/delete": "thread/delete",
	"session/unsubscribe": "thread/unsubscribe",
};

function copyRecord(params: unknown): Record<string, unknown> {
	const copied: Record<string, unknown> = {};
	if (!isRecord(params)) return copied;
	for (const [key, value] of Object.entries(params)) {
		copied[key] = value;
	}
	return copied;
}

function readString(input: Readonly<Record<string, unknown>>, key: string): string | undefined {
	const value = input[key];
	return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
