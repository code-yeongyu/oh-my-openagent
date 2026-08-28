import { contextCwd } from "../request-context.js";
import { getDisabledServerIds, getMergedServers } from "./config-loader.js";
import { BUILTIN_SERVERS, LSP_INSTALL_HINTS } from "./server-definitions.js";
import { isServerInstalled, resolveServerBinary } from "./server-installation.js";
import type { ServerLookupResult } from "./types.js";

/**
 * Replaces the command name with the absolute binary path so the client spawns the exact
 * binary that was resolved -- in particular a repo-local one that is absent from PATH.
 */
function withResolvedCommand(command: string[], binaryPath: string): string[] {
	return [binaryPath, ...command.slice(1)];
}

export function findServerForExtension(ext: string): ServerLookupResult {
	const servers = getMergedServers();
	const workingDirectory = contextCwd();

	for (const server of servers) {
		if (!server.extensions.includes(ext)) continue;
		const binaryPath = resolveServerBinary(server.command, workingDirectory);
		if (binaryPath !== null) {
			const resolvedServer = {
				id: server.id,
				command: withResolvedCommand(server.command, binaryPath),
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
	const workingDirectory = contextCwd();

	const result: ServerStatus[] = [];
	const seen = new Set<string>();

	for (const server of servers) {
		if (seen.has(server.id)) continue;
		result.push({
			id: server.id,
			installed: isServerInstalled(server.command, workingDirectory),
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
			installed: builtin ? isServerInstalled(builtin.command, workingDirectory) : false,
			extensions: builtin?.extensions ?? [],
			disabled: true,
			source: "disabled",
			priority: 0,
		});
	}

	return result;
}
