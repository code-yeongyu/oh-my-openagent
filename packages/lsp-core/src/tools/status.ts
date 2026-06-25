import { getLspManager } from "../lsp/manager.js";
import { getAllServers } from "../lsp/server-resolution.js";
import { text } from "./result.js";
import type { ToolExecutionResult } from "./types.js";

export async function executeLspStatus(): Promise<ToolExecutionResult> {
	const servers = getAllServers();
	const snapshots = getLspManager().getSnapshot();
	const installed = servers.filter((server) => server.installed && !server.disabled);
	const configuredLines = servers.map((server) => {
		const state = server.disabled ? "disabled" : server.installed ? "installed" : "missing";
		return `- ${server.id}: ${state}; source=${server.source}; extensions=${server.extensions.join(", ")}`;
	});
	const activeLines = snapshots.map((snapshot) => {
		const state = snapshot.alive ? (snapshot.isInitializing ? "initializing" : "alive") : "dead";
		return `- ${snapshot.serverId}: ${state}; root=${snapshot.root}; refs=${snapshot.refCount}`;
	});
	const lines = [
		`Configured LSP servers: ${servers.length}`,
		`Installed LSP servers: ${installed.length}`,
		"",
		...configuredLines,
		"",
		`Active LSP clients: ${snapshots.length}`,
		...activeLines,
	];
	return text(lines.join("\n"), { servers, snapshots });
}
