import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { contextCwd } from "../request-context.js";
import { getDisabledServerIds, getMergedServers, type ServerWithSource } from "./config-loader.js";
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

/**
 * Built-in servers that only belong to projects carrying one of these markers. `deno lsp`
 * handles the same extensions as the TypeScript server, so without the gate a machine with
 * Deno installed but no TypeScript server routes every Node/Bun file to Deno, which reports
 * bogus diagnostics for npm imports. A server the user configures explicitly is never gated.
 */
export const BUILTIN_SERVER_PROJECT_MARKERS: Readonly<Record<string, readonly string[]>> = {
	deno: ["deno.json", "deno.jsonc"],
};

/** Walks from `start` up to the repository root (a `.git` entry) looking for any marker. */
export function hasProjectMarker(start: string, markers: readonly string[]): boolean {
	let current = resolve(start);
	while (true) {
		if (markers.some((marker) => existsSync(join(current, marker)))) return true;
		if (existsSync(join(current, ".git"))) return false;
		const parent = dirname(current);
		if (parent === current) return false;
		current = parent;
	}
}

function isApplicable(server: ServerWithSource, workingDirectory: string): boolean {
	if (server.source !== "builtin") return true;
	const markers = BUILTIN_SERVER_PROJECT_MARKERS[server.id];
	return markers === undefined || hasProjectMarker(workingDirectory, markers);
}

export function findServerForExtension(ext: string): ServerLookupResult {
	const workingDirectory = contextCwd();
	const servers = getMergedServers().filter((server) => isApplicable(server, workingDirectory));

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
