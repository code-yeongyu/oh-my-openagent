import { existsSync, readFileSync } from "node:fs";

import { lspRequestContext } from "../request-context.js";
import { BUILTIN_SERVERS } from "./server-definitions.js";
import type { ResolvedServer } from "./types.js";

interface LspEntry {
	disabled?: boolean;
	command?: string[];
	extensions?: string[];
	priority?: number;
	env?: Record<string, string>;
	initialization?: Record<string, unknown>;
}

interface ConfigJson {
	lsp?: Record<string, unknown>;
}

type ConfigSource = "project" | "user";

export interface ServerWithSource extends ResolvedServer {
	source: "project" | "user" | "builtin";
}

export function getConfigPaths(): { project: string; user: string } {
	return {
		project: getProjectConfigPaths()[0] ?? lspRequestContext().projectConfigPaths[0] ?? "",
		user: getUserConfigPath(),
	};
}

function getProjectConfigPaths(): readonly string[] {
	return lspRequestContext().projectConfigPaths;
}

function getUserConfigPath(): string {
	return lspRequestContext().userConfigPath;
}

function loadJsonFile(path: string): ConfigJson | null {
	if (!existsSync(path)) return null;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
		return isConfigJson(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export function loadAllConfigs(): Map<ConfigSource, ConfigJson> {
	const configs = new Map<ConfigSource, ConfigJson>();

	const project = loadFirstJsonFile(getProjectConfigPaths());
	if (project) configs.set("project", project);

	const user = loadJsonFile(getUserConfigPath());
	if (user) configs.set("user", user);

	return configs;
}

function loadFirstJsonFile(paths: readonly string[]): ConfigJson | null {
	for (const path of paths) {
		const config = loadJsonFile(path);
		if (config) return config;
	}
	return null;
}

export function getMergedServers(): ServerWithSource[] {
	const configs = loadAllConfigs();
	const servers: ServerWithSource[] = [];
	const disabled = new Set<string>();
	const seen = new Set<string>();

	const sources: ConfigSource[] = ["project", "user"];

	for (const source of sources) {
		const config = configs.get(source);
		if (!config?.lsp) continue;

		for (const [id, rawEntry] of Object.entries(config.lsp)) {
			const entry = parseLspEntry(rawEntry);
			if (!entry) continue;
			if (entry.disabled) {
				disabled.add(id);
				continue;
			}

			if (seen.has(id)) continue;
			const server = createServerFromEntry(id, entry, source);
			if (!server) continue;

			servers.push(server);
			seen.add(id);
		}
	}

	for (const [id, config] of Object.entries(BUILTIN_SERVERS)) {
		if (disabled.has(id) || seen.has(id)) continue;

		servers.push({
			id,
			command: config.command,
			extensions: config.extensions,
			priority: -100,
			source: "builtin",
		});
	}

	return servers.sort((a, b) => {
		if (a.source !== b.source) {
			const order: Record<"project" | "user" | "builtin", number> = {
				project: 0,
				user: 1,
				builtin: 2,
			};
			return order[a.source] - order[b.source];
		}
		return b.priority - a.priority;
	});
}

function createServerFromEntry(id: string, entry: LspEntry, source: ConfigSource): ServerWithSource | null {
	const builtin = BUILTIN_SERVERS[id];
	if (source === "project") {
		if (!builtin) return null;
		const server = createServer({
			id,
			command: builtin.command,
			extensions: entry.extensions ?? builtin.extensions,
			priority: entry.priority ?? 0,
			source,
		});
		if (entry.initialization !== undefined) {
			server.initialization = entry.initialization;
		}
		return server;
	}

	if (entry.command && entry.extensions) {
		const server = createServer({
			id,
			command: entry.command,
			extensions: entry.extensions,
			priority: entry.priority ?? 0,
			source,
		});
		applyOptionalServerFields(server, entry);
		return server;
	}

	if (!builtin) return null;
	const server = createServer({
		id,
		command: entry.command ?? builtin.command,
		extensions: entry.extensions ?? builtin.extensions,
		priority: entry.priority ?? 0,
		source,
	});
	applyOptionalServerFields(server, entry);
	return server;
}

function createServer(input: {
	readonly id: string;
	readonly command: string[];
	readonly extensions: string[];
	readonly priority: number;
	readonly source: ConfigSource;
	readonly env?: Record<string, string>;
	readonly initialization?: Record<string, unknown>;
}): ServerWithSource {
	const server: ServerWithSource = {
		id: input.id,
		command: input.command,
		extensions: input.extensions,
		priority: input.priority,
		source: input.source,
	};
	if (input.env !== undefined) {
		server.env = input.env;
	}
	if (input.initialization !== undefined) {
		server.initialization = input.initialization;
	}
	return server;
}

function applyOptionalServerFields(server: ServerWithSource, entry: LspEntry): void {
	if (entry.env !== undefined) {
		server.env = entry.env;
	}
	if (entry.initialization !== undefined) {
		server.initialization = entry.initialization;
	}
}

function isConfigJson(value: unknown): value is ConfigJson {
	if (!isRecord(value)) return false;
	const lsp = value["lsp"];
	return lsp === undefined || isRecord(lsp);
}

function parseLspEntry(value: unknown): LspEntry | null {
	return isLspEntry(value) ? value : null;
}

function isLspEntry(value: unknown): value is LspEntry {
	if (!isRecord(value)) return false;
	const disabled = value["disabled"];
	const command = value["command"];
	const extensions = value["extensions"];
	const priority = value["priority"];
	const env = value["env"];
	const initialization = value["initialization"];
	return (
		(disabled === undefined || typeof disabled === "boolean") &&
		(command === undefined || isStringArray(command)) &&
		(extensions === undefined || isStringArray(extensions)) &&
		(priority === undefined || typeof priority === "number") &&
		(env === undefined || isStringRecord(env)) &&
		(initialization === undefined || isRecord(initialization))
	);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getDisabledServerIds(): Set<string> {
	const configs = loadAllConfigs();
	const disabled = new Set<string>();

	for (const config of configs.values()) {
		if (!config.lsp) continue;
		for (const [id, rawEntry] of Object.entries(config.lsp)) {
			const entry = parseLspEntry(rawEntry);
			if (!entry) continue;
			if (entry.disabled) disabled.add(id);
		}
	}

	return disabled;
}
