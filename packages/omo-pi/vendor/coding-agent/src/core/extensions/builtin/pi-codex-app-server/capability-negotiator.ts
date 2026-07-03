import { type AdapterJsonRpcError, createAdapterJsonRpcError } from "./error-mapper.ts";
import { PI_CODEX_APP_SERVER_PROTOCOL_VERSION } from "./protocol-core.ts";
import { PLAN_REQUIRED_SERVER_NOTIFICATION_SURFACES } from "./protocol-required-surfaces.ts";

export type NegotiatedCapabilityFlag =
	| "semantic-events"
	| "opaque-notifications"
	| "opaque-callbacks"
	| "realtime"
	| "filesystem"
	| "app-plugin-config"
	| "app-server-experimental-api"
	| "app-server-attestation"
	| "app-server-mcp-form-elicitation";

export interface ExternalInitializeCapabilities {
	readonly protocolVersion: typeof PI_CODEX_APP_SERVER_PROTOCOL_VERSION;
	readonly semanticEvents: boolean;
	readonly opaqueNotifications: boolean;
	readonly opaqueCallbacks: boolean;
	readonly realtime: boolean;
	readonly filesystem: boolean;
	readonly appPluginConfig: boolean;
	readonly notificationOptOuts: readonly string[];
}

export interface AppServerInitializeCapabilities {
	readonly experimentalApi?: boolean;
	readonly requestAttestation?: boolean;
	readonly mcpServerOpenaiFormElicitation?: boolean;
	readonly optOutNotificationMethods?: readonly string[] | null;
}

export interface CapabilityNegotiationInput {
	readonly external: ExternalInitializeCapabilities;
	readonly appServer?: AppServerInitializeCapabilities;
}

export type CapabilityNegotiationResult = CapabilityNegotiationAccepted | CapabilityNegotiationRejected;

export interface CapabilityNegotiationAccepted {
	readonly kind: "accepted";
	readonly protocolVersion: typeof PI_CODEX_APP_SERVER_PROTOCOL_VERSION;
	readonly capabilityFlags: readonly NegotiatedCapabilityFlag[];
	readonly notificationOptOuts: readonly string[];
	readonly error?: undefined;
}

export interface CapabilityNegotiationRejected {
	readonly kind: "rejected";
	readonly error: AdapterJsonRpcError;
}

const notificationSurfaceNames = new Set<string>(PLAN_REQUIRED_SERVER_NOTIFICATION_SURFACES);

export class ExternalInitializeCapabilitiesError extends Error {
	readonly adapterCode: "malformed-message" | "unsupported-protocol-version" | "unsupported-notification-opt-out";

	constructor(
		message: string,
		adapterCode: "malformed-message" | "unsupported-protocol-version" | "unsupported-notification-opt-out",
	) {
		super(message);
		this.name = "ExternalInitializeCapabilitiesError";
		this.adapterCode = adapterCode;
	}
}

export function parseExternalInitializeCapabilities(input: unknown): ExternalInitializeCapabilities {
	if (!isRecord(input)) {
		throw new ExternalInitializeCapabilitiesError("Initialize params must be an object.", "malformed-message");
	}
	const protocolVersion = input.protocolVersion;
	if (protocolVersion !== PI_CODEX_APP_SERVER_PROTOCOL_VERSION) {
		throw new ExternalInitializeCapabilitiesError(
			`Unsupported pi-codex-app-server protocol version: ${String(protocolVersion)}`,
			"unsupported-protocol-version",
		);
	}

	const capabilities = input.capabilities;
	if (!isRecord(capabilities)) {
		throw new ExternalInitializeCapabilitiesError("Initialize capabilities must be an object.", "malformed-message");
	}

	const notificationOptOuts = parseNotificationOptOuts(capabilities.notificationOptOuts);
	return {
		protocolVersion,
		semanticEvents: readRequiredBoolean(capabilities, "semanticEvents"),
		opaqueNotifications: readRequiredBoolean(capabilities, "opaqueNotifications"),
		opaqueCallbacks: readRequiredBoolean(capabilities, "opaqueCallbacks"),
		realtime: readOptionalBoolean(capabilities, "realtime"),
		filesystem: readOptionalBoolean(capabilities, "filesystem"),
		appPluginConfig: readOptionalBoolean(capabilities, "appPluginConfig"),
		notificationOptOuts,
	};
}

export function negotiatePiCodexAppServerCapabilities(input: CapabilityNegotiationInput): CapabilityNegotiationResult {
	const missingRequiredCapabilities = findMissingRequiredCapabilities(input.external);
	if (missingRequiredCapabilities.length > 0) {
		return {
			kind: "rejected",
			error: createAdapterJsonRpcError({
				adapterCode: "incompatible-capabilities",
				message: "External client is incompatible with pi-codex-app-server.",
				details: missingRequiredCapabilities,
			}),
		};
	}

	return {
		kind: "accepted",
		protocolVersion: input.external.protocolVersion,
		capabilityFlags: buildCapabilityFlags(input.external, input.appServer),
		notificationOptOuts: mapNotificationOptOuts(input.external, input.appServer),
	};
}

function findMissingRequiredCapabilities(external: ExternalInitializeCapabilities): readonly string[] {
	const missing: string[] = [];
	if (!external.opaqueNotifications) {
		missing.push("opaqueNotifications is required so app-server notifications are never silently dropped");
	}
	if (!external.opaqueCallbacks) {
		missing.push("opaqueCallbacks is required because app-server server requests are control flow");
	}
	return missing;
}

function buildCapabilityFlags(
	external: ExternalInitializeCapabilities,
	appServer: AppServerInitializeCapabilities | undefined,
): readonly NegotiatedCapabilityFlag[] {
	const flags: NegotiatedCapabilityFlag[] = [];
	if (external.semanticEvents) flags.push("semantic-events");
	if (external.opaqueNotifications) flags.push("opaque-notifications");
	if (external.opaqueCallbacks) flags.push("opaque-callbacks");
	if (external.realtime) flags.push("realtime");
	if (external.filesystem) flags.push("filesystem");
	if (external.appPluginConfig) flags.push("app-plugin-config");
	if (appServer?.experimentalApi) flags.push("app-server-experimental-api");
	if (appServer?.requestAttestation) flags.push("app-server-attestation");
	if (appServer?.mcpServerOpenaiFormElicitation) flags.push("app-server-mcp-form-elicitation");
	return flags;
}

function mapNotificationOptOuts(
	external: ExternalInitializeCapabilities,
	appServer: AppServerInitializeCapabilities | undefined,
): readonly string[] {
	const appServerOptOuts = new Set<string>(appServer?.optOutNotificationMethods ?? []);
	if (appServerOptOuts.size === 0) return [];
	return external.notificationOptOuts.filter((method) => appServerOptOuts.has(method));
}

function parseNotificationOptOuts(value: unknown): readonly string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		throw new ExternalInitializeCapabilitiesError("notificationOptOuts must be an array.", "malformed-message");
	}
	const optOuts: string[] = [];
	for (const method of value) {
		if (typeof method !== "string") {
			throw new ExternalInitializeCapabilitiesError(
				"notificationOptOuts entries must be strings.",
				"malformed-message",
			);
		}
		if (!notificationSurfaceNames.has(method)) {
			throw new ExternalInitializeCapabilitiesError(
				`Unknown app-server notification opt-out: ${method}`,
				"unsupported-notification-opt-out",
			);
		}
		optOuts.push(method);
	}
	return optOuts;
}

function readRequiredBoolean(input: Readonly<Record<string, unknown>>, key: string): boolean {
	const value = input[key];
	if (typeof value !== "boolean") {
		throw new ExternalInitializeCapabilitiesError(`${key} must be a boolean.`, "malformed-message");
	}
	return value;
}

function readOptionalBoolean(input: Readonly<Record<string, unknown>>, key: string): boolean {
	const value = input[key];
	if (value === undefined) return false;
	if (typeof value !== "boolean") {
		throw new ExternalInitializeCapabilitiesError(`${key} must be a boolean.`, "malformed-message");
	}
	return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
