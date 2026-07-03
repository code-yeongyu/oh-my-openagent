import type { IdMapper } from "./id-mapper.ts";
import { projectItemStreamNotification, type SemanticItemStreamProjection } from "./item-stream-projector.ts";
import { classifyAppServerSurface, PI_CODEX_APP_SERVER_PROTOCOL_VERSION, type StreamClass } from "./protocol-core.ts";
import type { SessionRegistry } from "./session-registry.ts";

export interface NotificationProjectorOptions {
	readonly connectionId: string;
	readonly capabilityFlags: readonly string[];
	readonly notificationOptOuts: readonly string[];
	readonly idMapper: IdMapper;
	readonly sessionRegistry: SessionRegistry;
}

export interface AppServerNotificationInput {
	readonly method: string;
	readonly params: unknown;
}

export interface OpaqueAppServerEnvelope {
	readonly protocolVersion: typeof PI_CODEX_APP_SERVER_PROTOCOL_VERSION;
	readonly connectionId: string;
	readonly externalSessionId: string | undefined;
	readonly externalRequestId: string | undefined;
	readonly externalMessageId: string | undefined;
	readonly externalCallbackId: string | undefined;
	readonly appThreadId: string | undefined;
	readonly appSessionId: string | undefined;
	readonly appTurnId: string | undefined;
	readonly appItemId: string | undefined;
	readonly appRequestId: string | undefined;
	readonly sequence: number;
	readonly streamClass: StreamClass;
	readonly capabilityFlags: readonly string[];
	readonly originalMethod: string;
	readonly originalParams: unknown;
	readonly redactionClass: "public-contract" | "secret-bearing";
}

export interface OpaqueNotificationProjection {
	readonly kind: "opaque";
	readonly method: "appServer/event";
	readonly envelope: OpaqueAppServerEnvelope;
}

export interface SkippedNotificationProjection {
	readonly kind: "skipped";
	readonly reason: "notification-opt-out";
}

export type NotificationProjection =
	| OpaqueNotificationProjection
	| SemanticItemStreamProjection
	| SkippedNotificationProjection;

export interface NotificationProjector {
	project(input: AppServerNotificationInput): NotificationProjection;
}

export function createNotificationProjector(options: NotificationProjectorOptions): NotificationProjector {
	return new DefaultNotificationProjector(options);
}

class DefaultNotificationProjector implements NotificationProjector {
	private readonly connectionId: string;
	private readonly capabilityFlags: readonly string[];
	private readonly notificationOptOuts: ReadonlySet<string>;
	private readonly idMapper: IdMapper;
	private readonly sessionRegistry: SessionRegistry;
	private sequence = 0;

	constructor(options: NotificationProjectorOptions) {
		this.connectionId = options.connectionId;
		this.capabilityFlags = options.capabilityFlags;
		this.notificationOptOuts = new Set(options.notificationOptOuts);
		this.idMapper = options.idMapper;
		this.sessionRegistry = options.sessionRegistry;
	}

	project(input: AppServerNotificationInput): NotificationProjection {
		if (this.notificationOptOuts.has(input.method)) {
			return { kind: "skipped", reason: "notification-opt-out" };
		}

		const sequence = this.nextSequence();
		const appThreadId = readAppThreadId(input.params);
		const externalSessionId = this.readExternalSessionId(appThreadId);
		const semantic = projectItemStreamNotification({
			method: input.method,
			params: input.params,
			sequence,
			externalSessionId,
			idMapper: this.idMapper,
		});
		if (semantic) return semantic;

		return {
			kind: "opaque",
			method: "appServer/event",
			envelope: this.createOpaqueEnvelope(input, sequence, appThreadId, externalSessionId),
		};
	}

	private nextSequence(): number {
		this.sequence += 1;
		return this.sequence;
	}

	private readExternalSessionId(appThreadId: string | undefined): string | undefined {
		if (!appThreadId) return undefined;
		return this.sessionRegistry.getByAppThreadId(appThreadId)?.externalSessionId;
	}

	private createOpaqueEnvelope(
		input: AppServerNotificationInput,
		sequence: number,
		appThreadId: string | undefined,
		externalSessionId: string | undefined,
	): OpaqueAppServerEnvelope {
		const params = isRecord(input.params) ? input.params : {};
		const binding = appThreadId ? this.sessionRegistry.getByAppThreadId(appThreadId) : undefined;
		return {
			protocolVersion: PI_CODEX_APP_SERVER_PROTOCOL_VERSION,
			connectionId: this.connectionId,
			externalSessionId,
			externalRequestId: undefined,
			externalMessageId: undefined,
			externalCallbackId: undefined,
			appThreadId,
			appSessionId: binding?.appSessionId,
			appTurnId: readAppTurnId(params),
			appItemId: readAppItemId(input.params),
			appRequestId: readAppRequestId(params),
			sequence,
			streamClass: classifyAppServerSurface(input.method)?.streamClass ?? "lossless",
			capabilityFlags: this.capabilityFlags,
			originalMethod: input.method,
			originalParams: input.params,
			redactionClass: "public-contract",
		};
	}
}

function readAppThreadId(params: unknown): string | undefined {
	if (!isRecord(params)) return undefined;
	return readString(params, "threadId") ?? readString(params, "thread_id");
}

function readAppTurnId(params: Readonly<Record<string, unknown>>): string | undefined {
	return readString(params, "turnId") ?? readString(params, "turn_id");
}

function readAppItemId(params: unknown): string | undefined {
	if (!isRecord(params)) return undefined;
	const itemId = readString(params, "itemId") ?? readString(params, "item_id");
	if (itemId) return itemId;
	const item = params.item;
	if (!isRecord(item)) return undefined;
	return readString(item, "id");
}

function readAppRequestId(params: Readonly<Record<string, unknown>>): string | undefined {
	return readString(params, "requestId") ?? readString(params, "request_id") ?? readString(params, "id");
}

function readString(input: Readonly<Record<string, unknown>>, key: string): string | undefined {
	const value = input[key];
	return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
