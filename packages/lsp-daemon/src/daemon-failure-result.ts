import type { ToolExecutionResult } from "@oh-my-opencode/lsp-core/tools";

import { DaemonRequestCancelledError, DaemonRequestTimedOutError } from "./daemon-request-error.js";
import type { DaemonPaths } from "./paths.js";

export function daemonFailureResult(paths: DaemonPaths, error: unknown): ToolExecutionResult {
	if (error instanceof DaemonRequestCancelledError) return daemonCancelledResult(paths);
	if (error instanceof DaemonRequestTimedOutError) return daemonTimedOutResult(paths, error.timeoutMs);
	return daemonUnreachableResult(paths, error);
}

function daemonCancelledResult(paths: DaemonPaths): ToolExecutionResult {
	const text = [
		"LSP daemon request cancelled: the caller aborted this request (for example, the turn was interrupted).",
		"The daemon stays available; no LSP work was applied. Retry when you are ready.",
		`Socket: ${paths.socket}`,
	].join("\n");
	return { content: [{ type: "text", text }], isError: true };
}

function daemonTimedOutResult(paths: DaemonPaths, timeoutMs: number): ToolExecutionResult {
	const text = [
		`LSP daemon request timed out after ${timeoutMs}ms: the daemon did not respond in time.`,
		"The daemon stays available but may be busy. Retry when you are ready.",
		`Socket: ${paths.socket}`,
		`Logs: ${paths.log}`,
	].join("\n");
	return { content: [{ type: "text", text }], isError: true };
}

function daemonUnreachableResult(paths: DaemonPaths, error: unknown): ToolExecutionResult {
	const text = [
		`LSP daemon unreachable: ${errorText(error)}.`,
		"The MCP server is a thin proxy and never runs language servers in-process.",
		`Socket: ${paths.socket}`,
		`Logs: ${paths.log}`,
		"The daemon is auto-started on demand and will be retried on the next request.",
	].join("\n");
	return { content: [{ type: "text", text }], isError: true };
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
