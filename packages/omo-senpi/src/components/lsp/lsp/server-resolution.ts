import { getDisabledServerIds, getMergedServers } from "./config-loader.js";
import { BUILTIN_SERVERS, LSP_INSTALL_HINTS } from "./server-definitions.js";
import { isServerInstalled } from "./server-installation.js";
import type { ResolvedServer, ServerLookupResult } from "./types.js";

export interface ServerStatus {
	id: string;
	installed: boolean;
	extensions: string[];
	disabled: boolean;
	source: string;
	priority: number;
	server?: ResolvedServer;
}

export type ServerStatusProvider = () => ServerStatus[];

let serverStatusProvider: ServerStatusProvider | undefined;

export function setServerStatusProvider(provider: ServerStatusProvider | undefined): void {
	serverStatusProvider = provider;
}

export function findServerForExtension(ext: string): ServerLookupResult {
	const providedServers = serverStatusProvider?.();
	if (providedServers !== undefined) {
		for (const status of providedServers) {
			if (!status.installed || status.disabled || !status.extensions.includes(ext)) continue;
			return {
				status: "found",
				server: status.server ?? {
					id: status.id,
					command: ["omo-senpi-fake-ls"],
					extensions: status.extensions,
					priority: status.priority,
				},
			};
		}
		return {
			status: "not_configured",
			extension: ext,
			availableServers: providedServers.map((server) => server.id),
		};
	}

	const servers = getMergedServers();

	for (const server of servers) {
		if (server.extensions.includes(ext) && isServerInstalled(server.command)) {
			return {
				status: "found",
				server: {
					id: server.id,
					command: server.command,
					extensions: server.extensions,
					priority: server.priority,
					...(server.env !== undefined ? { env: server.env } : {}),
					...(server.initialization !== undefined ? { initialization: server.initialization } : {}),
				},
			};
		}
	}

	for (const server of servers) {
		if (server.extensions.includes(ext)) {
			const installHint =
				LSP_INSTALL_HINTS[server.id] ?? `Install '${server.command[0]}' and ensure it's in your PATH`;
			return {
				status: "not_installed",
				server: {
					id: server.id,
					command: server.command,
					extensions: server.extensions,
				},
				installHint,
			};
		}
	}

	const availableServers = [...new Set(servers.map((s) => s.id))];
	return {
		status: "not_configured",
		extension: ext,
		availableServers,
	};
}

export function getAllServers(): ServerStatus[] {
	const providedServers = serverStatusProvider?.();
	if (providedServers !== undefined) return providedServers;

	const servers = getMergedServers();
	const disabled = getDisabledServerIds();

	const result: ServerStatus[] = [];
	const seen = new Set<string>();

	for (const server of servers) {
		if (seen.has(server.id)) continue;
		result.push({
			id: server.id,
			installed: isServerInstalled(server.command),
			extensions: server.extensions,
			disabled: false,
			source: server.source,
			priority: server.priority,
		});
		seen.add(server.id);
	}

	for (const id of disabled) {
		if (seen.has(id)) continue;
		const builtin = BUILTIN_SERVERS[id];
		result.push({
			id,
			installed: builtin ? isServerInstalled(builtin.command) : false,
			extensions: builtin?.extensions ?? [],
			disabled: true,
			source: "disabled",
			priority: 0,
		});
	}

	return result;
}
