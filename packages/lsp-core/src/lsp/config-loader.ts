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
		const text = readFileSync(path, "utf-8");
		const parsed: unknown = path.endsWith(".jsonc") ? JSON.parse(stripJsonc(text)) : JSON.parse(text);
		return isConfigJson(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

// Minimal JSONC reader for config files: strips line/block comments and
// trailing commas outside string literals. `.json` files keep strict
// JSON.parse above; only `.jsonc` paths go through this pass, so a
// malformed file still yields null instead of a partial config.
function stripJsonc(text: string): string {
	let out = "";
	let i = 0;
	let inString = false;
	while (i < text.length) {
		const char = text[i] ?? "";
		if (inString) {
			out += char;
			if (char === "\\") {
				out += text[i + 1] ?? "";
				i += 2;
				continue;
			}
			if (char === '"') inString = false;
			i += 1;
			continue;
		}
		if (char === '"') {
			inString = true;
			out += char;
			i += 1;
			continue;
		}
		if (char === "/" && text[i + 1] === "/") {
			while (i < text.length && text[i] !== "\n") i += 1;
			continue;
		}
		if (char === "/" && text[i + 1] === "*") {
			i += 2;
			while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
			i += 2;
			continue;
		}
		if (char === ",") {
			let j = i + 1;
			while (j < text.length) {
				const next = text[j] ?? "";
				if (next === " " || next === "\t" || next === "\n" || next === "\r") {
					j += 1;
					continue;
				}
				if (next === "/" && text[j + 1] === "/") {
					while (j < text.length && text[j] !== "\n") j += 1;
					continue;
				}
				if (next === "/" && text[j + 1] === "*") {
					j += 2;
					while (j < text.length && !(text[j] === "*" && text[j + 1] === "/")) j += 1;
					j += 2;
					continue;
				}
				break;
			}
			if (text[j] === "}" || text[j] === "]") {
				i += 1;
				continue;
			}
		}
		out += char;
		i += 1;
	}
	return out;
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
			...(config.initialization === undefined ? {} : { initialization: config.initialization }),
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
		const initialization = mergeInitialization(builtin.initialization, entry.initialization);
		if (initialization !== undefined) {
			server.initialization = initialization;
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
	const builtinInitialization = entry.command === undefined ? builtin.initialization : undefined;
	const initialization = mergeInitialization(builtinInitialization, entry.initialization);
	if (initialization !== undefined) {
		server.initialization = initialization;
	}
	return server;
}

function mergeInitialization(
	builtin: Record<string, unknown> | undefined,
	entry: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	if (builtin === undefined) return entry;
	if (entry === undefined) return builtin;
	return { ...builtin, ...entry };
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
