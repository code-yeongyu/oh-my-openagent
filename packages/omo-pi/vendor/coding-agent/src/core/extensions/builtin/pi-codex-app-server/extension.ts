import type { ExtensionAPI, ExtensionContext, SessionShutdownEvent, SessionStartEvent } from "../../types.ts";
import { PI_CODEX_APP_SERVER_PROTOCOL_VERSION } from "./protocol-core.ts";
import {
	createPiCodexAppServerRuntime,
	type PiCodexAppServerRuntimeController,
	type PiCodexAppServerRuntimeFlags,
	type PiCodexAppServerTransportMode,
} from "./transport-runtime.ts";

export const PI_CODEX_APP_SERVER_COMMAND = "pi-codex-app-server";
export const PI_CODEX_APP_SERVER_FLAG_ENABLED = "pi-codex-app-server";
export const PI_CODEX_APP_SERVER_FLAG_MODE = "pi-codex-app-server-mode";
export const PI_CODEX_APP_SERVER_FLAG_APP_SERVER_COMMAND = "pi-codex-app-server-command";
export const PI_CODEX_APP_SERVER_FLAG_APP_SERVER_ARGS = "pi-codex-app-server-args";
export const PI_CODEX_APP_SERVER_FLAG_URL = "pi-codex-app-server-url";
export const PI_CODEX_APP_SERVER_FLAG_UNIX_SOCKET = "pi-codex-app-server-unix-socket";
export const PI_CODEX_APP_SERVER_FLAG_TIMEOUT_MS = "pi-codex-app-server-timeout-ms";

const DEFAULT_TRANSPORT_MODE = "stdio";
const DEFAULT_APP_SERVER_COMMAND = "codex";
const DEFAULT_APP_SERVER_ARGS = "app-server";
const DEFAULT_TIMEOUT_MS = "5000";
const RUNTIME_NOTICE_PREFIX = [
	"pi-codex-app-server PR-004 runtime",
	`Protocol contract: ${PI_CODEX_APP_SERVER_PROTOCOL_VERSION}`,
].join("\n");

interface RuntimeExtensionContext {
	readonly hasUI: boolean;
	readonly ui: Pick<ExtensionContext["ui"], "notify">;
}
type RuntimeLifecycleHandler<E> = (event: E, ctx: RuntimeExtensionContext) => Promise<void> | void;

export interface PiCodexAppServerExtensionApi {
	readonly registerCommand: ExtensionAPI["registerCommand"];
	readonly registerFlag: ExtensionAPI["registerFlag"];
	readonly getFlag: ExtensionAPI["getFlag"];
	on(event: "session_start", handler: RuntimeLifecycleHandler<SessionStartEvent>): void;
	on(event: "session_shutdown", handler: RuntimeLifecycleHandler<SessionShutdownEvent>): void;
}

export function registerPiCodexAppServerExtension(
	pi: PiCodexAppServerExtensionApi,
	createRuntime: () => PiCodexAppServerRuntimeController = createPiCodexAppServerRuntime,
): void {
	const runtime = createRuntime();
	pi.registerFlag(PI_CODEX_APP_SERVER_FLAG_ENABLED, {
		type: "boolean",
		default: false,
		description: "Enable pi-codex-app-server runtime transport during session lifecycle.",
	});
	pi.registerFlag(PI_CODEX_APP_SERVER_FLAG_MODE, {
		type: "string",
		default: DEFAULT_TRANSPORT_MODE,
		description: "Select the pi-codex-app-server transport mode: stdio, websocket, or unix.",
	});
	pi.registerFlag(PI_CODEX_APP_SERVER_FLAG_APP_SERVER_COMMAND, {
		type: "string",
		default: DEFAULT_APP_SERVER_COMMAND,
		description: "Codex app-server command for stdio or unix proxy transport.",
	});
	pi.registerFlag(PI_CODEX_APP_SERVER_FLAG_APP_SERVER_ARGS, {
		type: "string",
		default: DEFAULT_APP_SERVER_ARGS,
		description: "Codex app-server command arguments for stdio transport.",
	});
	pi.registerFlag(PI_CODEX_APP_SERVER_FLAG_URL, {
		type: "string",
		default: "",
		description: "Remote websocket URL for websocket transport.",
	});
	pi.registerFlag(PI_CODEX_APP_SERVER_FLAG_UNIX_SOCKET, {
		type: "string",
		default: "",
		description: "Unix socket path for app-server proxy transport.",
	});
	pi.registerFlag(PI_CODEX_APP_SERVER_FLAG_TIMEOUT_MS, {
		type: "string",
		default: DEFAULT_TIMEOUT_MS,
		description: "Runtime transport setup timeout in milliseconds.",
	});
	pi.registerCommand(PI_CODEX_APP_SERVER_COMMAND, {
		description: "Inspect the Codex app-server adapter runtime status",
		handler: async (_args, ctx) => {
			notifyIfVisible(ctx, `${RUNTIME_NOTICE_PREFIX}\nStatus: ${runtime.getStatus().kind}`);
		},
	});
	pi.on("session_start", async (_event, ctx) => {
		const flags = readRuntimeFlags(pi);
		const status = await runtime.start(flags);
		notifyIfVisible(ctx, `${RUNTIME_NOTICE_PREFIX}\nStatus: ${status.kind}`);
	});
	pi.on("session_shutdown", async (_event, ctx) => {
		const status = await runtime.stop();
		notifyIfVisible(ctx, `${RUNTIME_NOTICE_PREFIX}\nStatus: ${status.kind}`);
	});
}

function notifyIfVisible(ctx: RuntimeExtensionContext, message: string): void {
	if (!ctx.hasUI) return;
	ctx.ui.notify(message, "info");
}

function readRuntimeFlags(pi: PiCodexAppServerExtensionApi): PiCodexAppServerRuntimeFlags {
	return {
		enabled: pi.getFlag(PI_CODEX_APP_SERVER_FLAG_ENABLED) === true,
		mode: readTransportMode(pi),
		appServerCommand: readStringFlag(pi, PI_CODEX_APP_SERVER_FLAG_APP_SERVER_COMMAND, DEFAULT_APP_SERVER_COMMAND),
		appServerArgs: readArgsFlag(pi, PI_CODEX_APP_SERVER_FLAG_APP_SERVER_ARGS),
		appServerUrl: readStringFlag(pi, PI_CODEX_APP_SERVER_FLAG_URL, ""),
		appServerSocketPath: readStringFlag(pi, PI_CODEX_APP_SERVER_FLAG_UNIX_SOCKET, ""),
		connectTimeoutMs: readPositiveIntegerFlag(pi, PI_CODEX_APP_SERVER_FLAG_TIMEOUT_MS, Number(DEFAULT_TIMEOUT_MS)),
	};
}

function readTransportMode(pi: PiCodexAppServerExtensionApi): PiCodexAppServerTransportMode {
	const mode = pi.getFlag(PI_CODEX_APP_SERVER_FLAG_MODE);
	if (mode === "websocket" || mode === "unix") return mode;
	return "stdio";
}

function readStringFlag(pi: PiCodexAppServerExtensionApi, name: string, fallback: string): string {
	const value = pi.getFlag(name);
	return typeof value === "string" ? value : fallback;
}

function readArgsFlag(pi: PiCodexAppServerExtensionApi, name: string): readonly string[] {
	return readStringFlag(pi, name, DEFAULT_APP_SERVER_ARGS)
		.split(" ")
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
}

function readPositiveIntegerFlag(pi: PiCodexAppServerExtensionApi, name: string, fallback: number): number {
	const value = Number(readStringFlag(pi, name, String(fallback)));
	if (Number.isInteger(value) && value > 0) return value;
	return fallback;
}
