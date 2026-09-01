import { LSP_MCP_TOOLS } from "./definitions.js";
import { isRecord } from "./parameters.js";
import type { LspMcpTool, ToolExecutionResult } from "./types.js";

export async function executeLspTool(
	name: string,
	params: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<ToolExecutionResult> {
	const tool = LSP_MCP_TOOLS.find((candidate) => matchesToolName(candidate, name));
	if (!tool) throw new Error(`Unknown LSP tool: ${name}`);
	return tool.execute(params, signal);
}

function matchesToolName(tool: LspMcpTool, name: string): boolean {
	return tool.name === name || (tool.aliases?.includes(name) ?? false);
}

export function coerceToolArguments(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}
