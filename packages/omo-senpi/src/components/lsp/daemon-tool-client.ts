import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { resolveSenpiPackagedDaemonRuntime } from "./daemon-runtime.js";

interface ToolExecutionResult {
	readonly content: readonly { readonly type: "text"; readonly text: string }[];
	readonly isError?: boolean;
	readonly details?: unknown;
}

type LspRequestContext = {
	readonly cwd: string;
	readonly projectConfigPaths: readonly string[];
	readonly userConfigPath: string;
	readonly installDecisionsPath: string;
	readonly capabilities: {
		readonly installDecisionTool: boolean;
	};
};

const DAEMON_TOOL_NAMES = {
	lsp_diagnostics: "diagnostics",
	lsp_goto_definition: "goto_definition",
	lsp_find_references: "find_references",
	lsp_symbols: "symbols",
	lsp_prepare_rename: "prepare_rename",
	lsp_rename: "rename",
} as const;

type SenpiLspToolName = keyof typeof DAEMON_TOOL_NAMES;

class UnsupportedSenpiLspToolError extends Error {
	constructor(readonly toolName: string) {
		super(`Unsupported Senpi LSP daemon tool: ${toolName}`);
		this.name = "UnsupportedSenpiLspToolError";
	}
}

interface DaemonClientModule {
	readonly callToolViaDaemon: (
		name: string,
		args: Record<string, unknown>,
		options?: { readonly context?: LspRequestContext; readonly signal?: AbortSignal },
	) => Promise<ToolExecutionResult>;
}

const cachedClients = new Map<string, Promise<DaemonClientModule>>();

export async function callPackagedDaemonTool(
		name: string,
		args: Record<string, unknown>,
		options: { readonly signal?: AbortSignal } = {},
		importerUrl = import.meta.url,
): Promise<ToolExecutionResult> {
	const client = await loadPackagedDaemonClient(importerUrl);
	const context = currentSenpiRequestContext();
	return client.callToolViaDaemon(toDaemonToolName(name), args, { context, signal: options.signal });
}

export function clearPackagedDaemonToolClientCache(): void {
	cachedClients.clear();
}

function currentSenpiRequestContext(): LspRequestContext {
	const cwd = canonicalCwd();
	const home = resolve(process.env.HOME?.trim() || homedir());
	return {
		cwd,
		projectConfigPaths: [join(cwd, ".pi", "lsp-client.json")],
		userConfigPath: join(home, ".pi", "lsp-client.json"),
		installDecisionsPath: join(home, ".pi", "lsp-install-decisions.json"),
		capabilities: { installDecisionTool: false },
	};
}

function canonicalCwd(): string {
	const cwd = resolve(process.cwd());
	return existsSync(cwd) ? realpathSync(cwd) : cwd;
}

function toDaemonToolName(name: string): string {
	if (isSenpiLspToolName(name)) return DAEMON_TOOL_NAMES[name];
	throw new UnsupportedSenpiLspToolError(name);
}

function isSenpiLspToolName(name: string): name is SenpiLspToolName {
	return Object.hasOwn(DAEMON_TOOL_NAMES, name);
}

async function loadPackagedDaemonClient(importerUrl: string): Promise<DaemonClientModule> {
	const runtime = resolveSenpiPackagedDaemonRuntime(importerUrl);
	const clientPath = join(dirname(runtime.cliPath), "client.js");
	let cachedClient = cachedClients.get(clientPath);
	if (!cachedClient) {
		cachedClient = loadPackagedDaemonClientOnce(clientPath);
		cachedClients.set(clientPath, cachedClient);
	}
	return cachedClient;
}

async function loadPackagedDaemonClientOnce(clientPath: string): Promise<DaemonClientModule> {
	const loaded: unknown = await import(pathToFileURL(clientPath).href);
	if (!isDaemonClientModule(loaded)) {
		throw new Error(`Packaged LSP daemon runtime is missing public client exports: ${clientPath}`);
	}
	return loaded;
}

function isDaemonClientModule(value: unknown): value is DaemonClientModule {
	return isRecord(value) && typeof value["callToolViaDaemon"] === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
