import type { AppServerSurfaceInventoryEntry, RelayClass, StreamClass, SurfaceDirection } from "./protocol-core.ts";
import {
	PLAN_REQUIRED_APP_SERVER_SURFACES,
	PLAN_REQUIRED_CLIENT_REQUEST_SURFACES,
	PLAN_REQUIRED_SERVER_NOTIFICATION_SURFACES,
	PLAN_REQUIRED_SERVER_REQUEST_SURFACES,
	PLAN_REQUIRED_THREAD_ITEM_VARIANT_SURFACES,
} from "./protocol-required-surfaces.ts";

const clientRequests = new Set<string>(PLAN_REQUIRED_CLIENT_REQUEST_SURFACES);
const serverRequests = new Set<string>(PLAN_REQUIRED_SERVER_REQUEST_SURFACES);
const serverNotifications = new Set<string>(PLAN_REQUIRED_SERVER_NOTIFICATION_SURFACES);
const threadItemVariants = new Set<string>(PLAN_REQUIRED_THREAD_ITEM_VARIANT_SURFACES);

function inferDirection(method: string): SurfaceDirection {
	if (serverRequests.has(method) || serverNotifications.has(method) || threadItemVariants.has(method)) {
		return "app-to-external";
	}
	if (method.startsWith("fs/") || method.startsWith("thread/realtime/") || method.startsWith("mcpServer/")) {
		return "bidirectional";
	}
	return clientRequests.has(method) ? "external-to-app" : "bidirectional";
}

function inferStreamClass(method: string): StreamClass {
	if (method.includes("outputDelta") || method.includes("progress") || method.includes("appendAudio")) {
		return "best-effort";
	}
	if (
		method.includes("/list") ||
		method.includes("/read") ||
		method.includes("get") ||
		method.includes("status/read") ||
		method.startsWith("threadItem/")
	) {
		return "snapshot-authoritative";
	}
	if (method.includes("changed") || method.includes("updated") || method.includes("completed")) {
		return "lossless";
	}
	return method.includes("start") || method.includes("stop") || method.includes("interrupt") ? "control" : "lossless";
}

function inferRelayClass(method: string, streamClass: StreamClass): RelayClass {
	if (method === "appServer/futureMethod") return "opaque-lossless";
	if (threadItemVariants.has(method)) return "snapshot-authoritative";
	if (method.startsWith("fs/") || method.startsWith("thread/realtime/") || method.startsWith("remoteControl/")) {
		return streamClass === "best-effort" ? "opaque-best-effort" : "opaque-lossless";
	}
	return "semantic";
}

function inferSurface(method: string): string {
	if (threadItemVariants.has(method)) return "thread item variant";
	if (serverRequests.has(method)) return "server request";
	if (serverNotifications.has(method)) return "server notification";
	if (method.startsWith("thread/")) return "thread lifecycle and control";
	if (method.startsWith("turn/")) return "turn lifecycle";
	if (method.startsWith("item/") || method.startsWith("rawResponseItem/")) return "item stream";
	if (method.startsWith("fs/")) return "filesystem";
	if (method.startsWith("fuzzyFileSearch/")) return "fuzzy file search";
	if (method.startsWith("windowsSandbox/") || method.startsWith("windows/")) return "windows sandbox";
	if (method.startsWith("config") || method.startsWith("skills/") || method.startsWith("plugin/"))
		return "configuration";
	if (method.startsWith("experimentalFeature/")) return "experimental feature";
	if (method.startsWith("permissionProfile/")) return "permission profile";
	if (method.startsWith("collaborationMode/")) return "collaboration mode";
	if (method.startsWith("environment/")) return "environment";
	if (method.startsWith("account/")) return "account";
	if (method.startsWith("model")) return "model";
	if (method.startsWith("remoteControl/")) return "remote control";
	if (method.startsWith("mcpServer")) return "mcp";
	return "app-server compatibility";
}

function inferIdFields(method: string): readonly string[] {
	if (method.startsWith("threadItem/")) return ["appThreadId", "appTurnId", "appItemId"];
	if (method.startsWith("item/")) return ["appThreadId", "appTurnId", "appItemId", "appRequestId"];
	if (method.startsWith("turn/")) return ["appThreadId", "appTurnId"];
	if (method.startsWith("thread/")) return ["appThreadId", "appSessionId"];
	return ["appRequestId"];
}

export const APP_SERVER_SURFACE_INVENTORY: readonly AppServerSurfaceInventoryEntry[] =
	PLAN_REQUIRED_APP_SERVER_SURFACES.map((method) => {
		const streamClass = inferStreamClass(method);
		return {
			method,
			direction: inferDirection(method),
			relayClass: inferRelayClass(method, streamClass),
			streamClass,
			surface: inferSurface(method),
			idFields: inferIdFields(method),
			source: "codex-rs/app-server-protocol/src/protocol/common.rs current string-named surfaces",
		};
	});
