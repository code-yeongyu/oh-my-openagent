import { getDisabledServerIds, getMergedServers } from "./config-loader.js";
import { BUILTIN_SERVERS, LSP_INSTALL_HINTS } from "./server-definitions.js";
import { isServerInstalled } from "./server-installation.js";
import type { ServerLookupResult } from "./types.js";

export function findServerForExtension(ext: string): ServerLookupResult {
	const servers = getMergedServers();
	const normalizedExtension = ext.toLowerCase();

	for (const server of servers) {
		if (includesExtension(server.extensions, normalizedExtension) && isServerInstalled(server.command)) {
			const resolvedServer = {
				id: server.id,
				command: server.command,
				extensions: server.extensions,
				priority: server.priority,
			};
			if (server.env !== undefined) {
				return {
					status: "found",
					server: {
						...resolvedServer,
						env: server.env,
						...(server.initialization === undefined ? {} : { initialization: server.initialization }),
					},
				};
			}
			return {
				status: "found",
				server: {
					...resolvedServer,
					...(server.initialization === undefined ? {} : { initialization: server.initialization }),
				},
			};
		}
	}

	for (const server of servers) {
		if (includesExtension(server.extensions, normalizedExtension)) {
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

function includesExtension(extensions: string[], normalizedExtension: string): boolean {
	return extensions.some((extension) => extension.toLowerCase() === normalizedExtension);
}

export interface ServerStatus {
	id: string;
	installed: boolean;
	extensions: string[];
	disabled: boolean;
	source: string;
	priority: number;
}

export function getAllServers(): ServerStatus[] {
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
