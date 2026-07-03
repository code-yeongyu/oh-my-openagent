import {
	type AppServerInitializeCapabilities,
	type ExternalInitializeCapabilities,
	type NegotiatedCapabilityFlag,
	negotiatePiCodexAppServerCapabilities,
	parseExternalInitializeCapabilities,
} from "./capability-negotiator.ts";
import { type AdapterJsonRpcError, createAdapterJsonRpcError } from "./error-mapper.ts";
import type { IdMapper } from "./id-mapper.ts";
import type { ExternalProtocolMethodName } from "./protocol-core.ts";
import {
	appParamsFrom,
	invalidSession,
	mapExternalMethod,
	parseRoutingParams,
	parseThreadBinding,
	readTurnId,
	unsupported,
	withField,
	withOptionalField,
	withThreadId,
} from "./request-router-params.ts";
import type { SessionBinding, SessionRegistry } from "./session-registry.ts";

export interface AppServerRequestClient {
	request(method: string, params: unknown): Promise<unknown>;
}

export interface RouteExternalRequestInput {
	readonly method: ExternalProtocolMethodName;
	readonly params: unknown;
	readonly externalRequestId?: string;
	readonly externalMessageId?: string;
}

export type RouteExternalRequestResult =
	| { readonly kind: "app-server-response"; readonly appServerResponse: unknown }
	| { readonly kind: "adapter-error"; readonly error: AdapterJsonRpcError };
type ActiveSessionResult =
	| { readonly kind: "active"; readonly binding: SessionBinding }
	| { readonly kind: "adapter-error"; readonly error: AdapterJsonRpcError };

export interface RequestRouter {
	route(input: RouteExternalRequestInput): Promise<RouteExternalRequestResult>;
}

export interface RequestRouterOptions {
	readonly client: AppServerRequestClient;
	readonly idMapper: IdMapper;
	readonly sessionRegistry: SessionRegistry;
	readonly appServerCapabilities?: AppServerInitializeCapabilities;
}

export function createRequestRouter(options: RequestRouterOptions): RequestRouter {
	return new DefaultRequestRouter(options);
}

class DefaultRequestRouter implements RequestRouter {
	private readonly client: AppServerRequestClient;
	private readonly idMapper: IdMapper;
	private readonly sessionRegistry: SessionRegistry;
	private readonly appServerCapabilities: AppServerInitializeCapabilities | undefined;
	private negotiatedCapabilityFlags: ReadonlySet<NegotiatedCapabilityFlag> = new Set();

	constructor(options: RequestRouterOptions) {
		this.client = options.client;
		this.idMapper = options.idMapper;
		this.sessionRegistry = options.sessionRegistry;
		this.appServerCapabilities = options.appServerCapabilities;
	}

	async route(input: RouteExternalRequestInput): Promise<RouteExternalRequestResult> {
		const requestRegistration = this.registerRequest(input);
		if (requestRegistration) return requestRegistration;

		try {
			return await this.routeRegistered(input);
		} finally {
			if (input.externalRequestId) {
				this.idMapper.resolveRequest(input.externalRequestId);
			}
		}
	}

	private registerRequest(input: RouteExternalRequestInput): RouteExternalRequestResult | undefined {
		if (!input.externalRequestId) return undefined;
		const result = this.idMapper.registerRequest({
			externalRequestId: input.externalRequestId,
			appMethod: mapExternalMethod(input.method),
			startedAtMs: Date.now(),
		});
		if (result.kind === "rejected") {
			return { kind: "adapter-error", error: result.error };
		}
		return undefined;
	}

	private async routeRegistered(input: RouteExternalRequestInput): Promise<RouteExternalRequestResult> {
		switch (input.method) {
			case "initialize":
				return this.routeInitialize(input.params);
			case "initialized":
				return this.callAppServer("initialized", {});
			case "session/new":
			case "session/resume":
			case "session/fork":
				return this.routeThreadBinding(input.method, input.params);
			case "session/list":
				return this.callAppServer(mapExternalMethod(input.method), appParamsFrom(input.params));
			case "session/read":
				return this.routeThreadRead(input.params);
			case "session/archive":
			case "session/delete":
			case "session/unsubscribe":
				return this.routeThreadClose(input.method, input.params);
			case "turn/start":
				return this.routeTurnStart(input.params, input.externalMessageId);
			case "turn/steer":
				return this.routeTurnSteer(input.params);
			case "turn/interrupt":
				return this.routeTurnInterrupt(input.params);
			default:
				return this.routePassThrough(input.method, input.params);
		}
	}

	private async routeInitialize(params: unknown): Promise<RouteExternalRequestResult> {
		const parsed = parseInitialize(params);
		if (parsed.kind === "adapter-error") return parsed;
		const negotiated = negotiatePiCodexAppServerCapabilities({
			external: parsed.external,
			appServer: this.appServerCapabilities,
		});
		if (negotiated.kind === "rejected") {
			return { kind: "adapter-error", error: negotiated.error };
		}
		const response = await this.callAppServer("initialize", {
			capabilities: {
				experimentalApi: this.appServerCapabilities?.experimentalApi,
				requestAttestation: this.appServerCapabilities?.requestAttestation,
				mcpServerOpenaiFormElicitation: this.appServerCapabilities?.mcpServerOpenaiFormElicitation,
				optOutNotificationMethods: negotiated.notificationOptOuts,
			},
		});
		if (response.kind === "app-server-response") {
			this.negotiatedCapabilityFlags = new Set(negotiated.capabilityFlags);
		}
		return response;
	}

	private async routeThreadBinding(
		method: ExternalProtocolMethodName,
		params: unknown,
	): Promise<RouteExternalRequestResult> {
		const routingParams = parseRoutingParams(params);
		if (!routingParams.externalSessionId) {
			return invalidSession("Session routing requires externalSessionId.");
		}
		if (this.sessionRegistry.getByExternalSessionId(routingParams.externalSessionId)) {
			return {
				kind: "adapter-error",
				error: createAdapterJsonRpcError({
					adapterCode: "duplicate-routing-id",
					message: `Duplicate external session id: ${routingParams.externalSessionId}`,
				}),
			};
		}
		const response = await this.client.request(mapExternalMethod(method), appParamsFrom(params));
		const binding = parseThreadBinding(response);
		if (binding.kind === "adapter-error") return binding;
		const bindResult = this.sessionRegistry.bindSession({
			externalSessionId: routingParams.externalSessionId,
			appThreadId: binding.binding.appThreadId,
			appSessionId: binding.binding.appSessionId,
		});
		if (bindResult.kind === "rejected") return { kind: "adapter-error", error: bindResult.error };
		return { kind: "app-server-response", appServerResponse: response };
	}

	private async routeThreadRead(params: unknown): Promise<RouteExternalRequestResult> {
		const active = this.requireSession(params);
		if (active.kind === "adapter-error") return active;
		return this.callAppServer("thread/read", withThreadId(appParamsFrom(params), active.binding));
	}

	private async routeThreadClose(
		method: ExternalProtocolMethodName,
		params: unknown,
	): Promise<RouteExternalRequestResult> {
		const active = this.requireSession(params);
		if (active.kind === "adapter-error") return active;
		const response = await this.client.request(
			mapExternalMethod(method),
			withThreadId(appParamsFrom(params), active.binding),
		);
		if (method === "session/archive" || method === "session/delete") {
			this.sessionRegistry.tombstoneExternalSession(active.binding.externalSessionId);
		}
		return { kind: "app-server-response", appServerResponse: response };
	}

	private async routeTurnStart(
		params: unknown,
		externalMessageId: string | undefined,
	): Promise<RouteExternalRequestResult> {
		const active = this.requireSession(params);
		if (active.kind === "adapter-error") return active;
		const response = await this.client.request(
			"turn/start",
			withOptionalField(
				withThreadId(appParamsFrom(params), active.binding),
				"client_user_message_id",
				externalMessageId,
			),
		);
		const appTurnId = readTurnId(response);
		if (appTurnId) {
			this.idMapper.registerTurn({
				appTurnId,
				appThreadId: active.binding.appThreadId,
				externalMessageId,
				externalTurnId: parseRoutingParams(params).externalTurnId,
			});
		}
		return { kind: "app-server-response", appServerResponse: response };
	}

	private async routeTurnSteer(params: unknown): Promise<RouteExternalRequestResult> {
		const active = this.requireSession(params);
		if (active.kind === "adapter-error") return active;
		const appTurnId = parseRoutingParams(params).appTurnId;
		if (!appTurnId) return invalidSession("turn/steer requires appTurnId.");
		return this.callAppServer(
			"turn/steer",
			withField(withThreadId(appParamsFrom(params), active.binding), "expected_turn_id", appTurnId),
		);
	}

	private async routeTurnInterrupt(params: unknown): Promise<RouteExternalRequestResult> {
		const active = this.requireSession(params);
		if (active.kind === "adapter-error") return active;
		const appTurnId = parseRoutingParams(params).appTurnId;
		if (!appTurnId) return invalidSession("turn/interrupt requires appTurnId.");
		return this.callAppServer("turn/interrupt", withField(withThreadId({}, active.binding), "turn_id", appTurnId));
	}

	private async routePassThrough(
		method: ExternalProtocolMethodName,
		params: unknown,
	): Promise<RouteExternalRequestResult> {
		if (!passThroughClientRequestMethods.has(method)) return unsupported(method);
		const capabilityGate = capabilityGateForPassThrough(method);
		if (capabilityGate && !this.negotiatedCapabilityFlags.has(capabilityGate)) {
			return {
				kind: "adapter-error",
				error: createAdapterJsonRpcError({
					adapterCode: "incompatible-capabilities",
					message: `External client did not negotiate ${capabilityGate} for ${method}.`,
					details: [method],
				}),
			};
		}
		return this.callAppServer(method, appParamsFrom(params));
	}

	private requireSession(params: unknown): ActiveSessionResult {
		const externalSessionId = parseRoutingParams(params).externalSessionId;
		if (!externalSessionId) return invalidSession("Routing requires externalSessionId.");
		const lookup = this.sessionRegistry.requireActiveSession(externalSessionId);
		if (lookup.kind === "rejected") return { kind: "adapter-error", error: lookup.error };
		return lookup;
	}

	private async callAppServer(method: string, params: unknown): Promise<RouteExternalRequestResult> {
		return { kind: "app-server-response", appServerResponse: await this.client.request(method, params) };
	}
}

const passThroughClientRequestMethods: ReadonlySet<string> = new Set([
	"skills/list",
	"skills/extraRoots/set",
	"hooks/list",
	"marketplace/add",
	"marketplace/remove",
	"marketplace/upgrade",
	"plugin/list",
	"plugin/installed",
	"plugin/read",
	"plugin/skill/read",
	"plugin/share/save",
	"plugin/share/updateTargets",
	"plugin/share/list",
	"plugin/share/checkout",
	"plugin/share/delete",
	"app/list",
	"fs/readFile",
	"fs/writeFile",
	"fs/createDirectory",
	"fs/getMetadata",
	"fs/readDirectory",
	"fs/remove",
	"fs/copy",
	"fs/watch",
	"fs/unwatch",
	"skills/config/write",
	"plugin/install",
	"plugin/uninstall",
	"thread/realtime/start",
	"thread/realtime/appendAudio",
	"thread/realtime/appendText",
	"thread/realtime/appendSpeech",
	"thread/realtime/stop",
	"thread/realtime/listVoices",
	"remoteControl/enable",
	"remoteControl/disable",
	"remoteControl/status/read",
	"remoteControl/pairing/start",
	"remoteControl/pairing/status",
	"remoteControl/client/list",
	"remoteControl/client/revoke",
	"config/read",
	"externalAgentConfig/detect",
	"externalAgentConfig/import",
	"externalAgentConfig/import/readHistories",
	"config/value/write",
	"config/batchWrite",
	"configRequirements/read",
] as const);

function capabilityGateForPassThrough(method: string): NegotiatedCapabilityFlag | undefined {
	if (method.startsWith("fs/")) return "filesystem";
	if (method.startsWith("thread/realtime/")) return "realtime";
	if (isAppPluginConfigMethod(method)) return "app-plugin-config";
	return undefined;
}

function isAppPluginConfigMethod(method: string): boolean {
	return (
		method.startsWith("skills/") ||
		method.startsWith("hooks/") ||
		method.startsWith("marketplace/") ||
		method.startsWith("plugin/") ||
		method.startsWith("app/") ||
		method.startsWith("config") ||
		method.startsWith("externalAgentConfig/") ||
		method.startsWith("remoteControl/")
	);
}

function parseInitialize(
	params: unknown,
):
	| { readonly kind: "parsed"; readonly external: ExternalInitializeCapabilities }
	| { readonly kind: "adapter-error"; readonly error: AdapterJsonRpcError } {
	try {
		return { kind: "parsed", external: parseExternalInitializeCapabilities(params) };
	} catch (error) {
		if (error instanceof Error) {
			return invalidSession(error.message);
		}
		throw error;
	}
}
