import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
	lsp?: Record<string, LspEntry>;
}

type ConfigSource = "project" | "user";

export interface ServerWithSource extends ResolvedServer {
	source: "project" | "user" | "builtin";
}

export function getConfigPaths(): { project: string; user: string } {
	const cwd = process.cwd();
	return {
		project: join(cwd, ".pi", "lsp-client.json"),
		user: join(homedir(), ".pi", "lsp-client.json"),
	};
}

function loadJsonFile(path: string): ConfigJson | null {
	if (!existsSync(path)) return null;
	try {
		return parseConfigJson(JSON.parse(readFileSync(path, "utf-8")));
	} catch (error) {
		if (error instanceof Error) return null;
		throw error;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const strings = value.filter((item) => typeof item === "string");
	return strings.length === value.length ? strings : undefined;
}

function parseStringRecord(value: unknown): Record<string, string> | undefined {
	if (!isRecord(value)) return undefined;
	const parsed: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry !== "string") return undefined;
		parsed[key] = entry;
	}
	return parsed;
}

function parseLspEntry(value: unknown): LspEntry | null {
	if (!isRecord(value)) return null;
	const command = parseStringArray(value["command"]);
	const extensions = parseStringArray(value["extensions"]);
	const disabled = typeof value["disabled"] === "boolean" ? value["disabled"] : undefined;
	const priority = typeof value["priority"] === "number" ? value["priority"] : undefined;
	const env = parseStringRecord(value["env"]);
	const initialization = isRecord(value["initialization"]) ? value["initialization"] : undefined;
	return {
		...(disabled !== undefined ? { disabled } : {}),
		...(command !== undefined ? { command } : {}),
		...(extensions !== undefined ? { extensions } : {}),
		...(priority !== undefined ? { priority } : {}),
		...(env !== undefined ? { env } : {}),
		...(initialization !== undefined ? { initialization } : {}),
	};
}

function parseConfigJson(value: unknown): ConfigJson | null {
	if (!isRecord(value)) return null;
	const rawLsp = value["lsp"];
	if (rawLsp === undefined) return {};
	if (!isRecord(rawLsp)) return null;
	const lsp: Record<string, LspEntry> = {};
	for (const [id, entry] of Object.entries(rawLsp)) {
		const parsed = parseLspEntry(entry);
		if (parsed === null) return null;
		lsp[id] = parsed;
	}
	return { lsp };
}

export function loadAllConfigs(): Map<ConfigSource, ConfigJson> {
	const paths = getConfigPaths();
	const configs = new Map<ConfigSource, ConfigJson>();

	const project = loadJsonFile(paths.project);
	if (project) configs.set("project", project);

	const user = loadJsonFile(paths.user);
	if (user) configs.set("user", user);

	return configs;
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

		for (const [id, entry] of Object.entries(config.lsp)) {
			if (entry.disabled) {
				disabled.add(id);
				continue;
			}

			if (seen.has(id)) continue;
			if (!entry.command || !entry.extensions) continue;

			servers.push({
				id,
				command: entry.command,
				extensions: entry.extensions,
				priority: entry.priority ?? 0,
				...(entry.env !== undefined ? { env: entry.env } : {}),
				...(entry.initialization !== undefined ? { initialization: entry.initialization } : {}),
				source,
			});
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

export function getDisabledServerIds(): Set<string> {
	const configs = loadAllConfigs();
	const disabled = new Set<string>();

	for (const config of configs.values()) {
		if (!config.lsp) continue;
		for (const [id, entry] of Object.entries(config.lsp)) {
			if (entry.disabled) disabled.add(id);
		}
	}

	return disabled;
}
