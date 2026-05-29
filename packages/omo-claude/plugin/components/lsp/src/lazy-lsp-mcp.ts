import { createRequire } from "node:module";
import { env, execPath, stderr } from "node:process";

import { LSP_MCP_TOOLS } from "@code-yeongyu/lsp-tools-mcp/dist/tools.js";
import {
	createLazyMcpProxy,
	DEFAULT_LAZY_MCP_IDLE_TIMEOUT_MS,
	type LazyMcpBackendProcessConfig,
	type McpToolDescriptor,
	resolveLazyLspBackendConfig,
} from "./lazy-mcp-proxy.js";
import { createStdioLazyMcpBackend } from "./lazy-mcp-stdio-backend.js";
import { type LazyMcpLifecycleLog, runLazyMcpStdioServer } from "./lazy-mcp-stdio-server.js";

const require = createRequire(import.meta.url);
const BACKEND_CONFIG_ENV = "CODEX_LSP_LAZY_BACKEND";
const IDLE_TIMEOUT_ENV = "CODEX_LSP_LAZY_IDLE_TIMEOUT_MS";

export interface LazyLspIdleTimeoutResolution {
	readonly value: number;
	readonly warning?: string;
}

export async function runLazyLspMcpServer(
	input: NodeJS.ReadableStream = process.stdin,
	output: NodeJS.WritableStream = process.stdout,
): Promise<void> {
	const fallback = defaultLazyLspBackendConfig();
	const resolved = resolveLazyLspBackendConfig(env[BACKEND_CONFIG_ENV], fallback);
	if (resolved.warning !== undefined) stderr.write(`${resolved.warning}\n`);
	const idleTimeout = resolveLazyLspIdleTimeoutMs(env[IDLE_TIMEOUT_ENV], DEFAULT_LAZY_MCP_IDLE_TIMEOUT_MS);
	if (idleTimeout.warning !== undefined) stderr.write(`${idleTimeout.warning}\n`);
	const log: LazyMcpLifecycleLog = (event, fields = {}) => {
		stderr.write(`[codex-lsp lazy-mcp] ${event} ${JSON.stringify(fields)}\n`);
	};
	const proxy = createLazyMcpProxy({
		backend: createStdioLazyMcpBackend(resolved.config),
		idleTimeoutMs: idleTimeout.value,
		log,
		serverName: "lsp",
		serverVersion: "0.2.0",
		toolDescriptors: lspToolDescriptors(),
	});
	await runLazyMcpStdioServer(proxy, input, output, { log });
}

export function defaultLazyLspBackendConfig(): LazyMcpBackendProcessConfig {
	return {
		command: execPath,
		args: [require.resolve("@code-yeongyu/lsp-tools-mcp/dist/cli.js"), "mcp"],
	};
}

export function resolveLazyLspIdleTimeoutMs(
	rawValue: string | undefined,
	fallback: number,
): LazyLspIdleTimeoutResolution {
	if (rawValue === undefined || rawValue.trim() === "") return { value: fallback };
	const parsed = Number(rawValue);
	if (Number.isInteger(parsed) && parsed >= 0) return { value: parsed };
	return { value: fallback, warning: `Ignoring malformed lazy MCP idle timeout: ${rawValue}` };
}

export function lspToolDescriptors(): readonly McpToolDescriptor[] {
	return LSP_MCP_TOOLS.map((tool) => ({
		name: tool.name,
		title: tool.title,
		description: tool.description,
		inputSchema: tool.inputSchema,
	}));
}
