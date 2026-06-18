/// <reference path="../../node_modules/@types/node/index.d.ts" />

import { readdirSync, readFileSync } from "node:fs";

export type ComponentPackageJson = {
	readonly version?: string;
	readonly type: string;
	readonly packageManager: string;
	readonly bin: Readonly<Record<string, string>>;
	readonly dependencies?: Readonly<Record<string, string>>;
	readonly optionalDependencies?: Readonly<Record<string, string>>;
	readonly scripts?: Readonly<Record<string, string>>;
	readonly files?: readonly string[];
};

export type HookCommand = {
	readonly command: string;
};

export type HookEntry = {
	readonly matcher?: string;
	readonly hooks: readonly HookCommand[];
};

export type HooksJson = {
	readonly hooks: Record<string, readonly HookEntry[]>;
};

export type McpServer = {
	readonly command: string;
	readonly args: readonly string[];
};

export type McpJson = {
	readonly mcpServers: Record<string, McpServer>;
};

export type PluginJson = {
	readonly hooks: string;
};

export function readPackageJson(path: string): ComponentPackageJson {
	const parsed = readJsonFile(path);
	if (!isComponentPackageJson(parsed)) throw new TypeError(`Invalid package metadata: ${path}`);
	return parsed;
}

export function readHooksJson(path: string): HooksJson {
	const parsed = readJsonFile(path);
	if (!isHooksJson(parsed)) throw new TypeError(`Invalid hooks metadata: ${path}`);
	return parsed;
}

export function readMcpJson(path: string): McpJson {
	const parsed = readJsonFile(path);
	if (!isMcpJson(parsed)) throw new TypeError(`Invalid MCP metadata: ${path}`);
	return parsed;
}

export function readPluginJson(path: string): PluginJson {
	const parsed = readJsonFile(path);
	if (!isPluginJson(parsed)) throw new TypeError(`Invalid plugin metadata: ${path}`);
	return parsed;
}

export function readJsonFile(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8"));
}

export function readTextFile(path: string): string {
	return readFileSync(path, "utf8");
}

export function listDirectoryEntries(path: string): readonly string[] {
	return readdirSync(path);
}

export function requireFiles(packageJson: ComponentPackageJson, path: string): readonly string[] {
	if (packageJson.files === undefined) throw new TypeError(`Package metadata missing files: ${path}`);
	return packageJson.files;
}

export function requireScripts(packageJson: ComponentPackageJson, path: string): Readonly<Record<string, string>> {
	if (packageJson.scripts === undefined) throw new TypeError(`Package metadata missing scripts: ${path}`);
	return packageJson.scripts;
}

export function collectHookCommandsFromValue(value: unknown): readonly string[] {
	if (typeof value === "string") return [];
	if (Array.isArray(value)) return value.flatMap(collectHookCommandsFromValue);
	if (!isRecord(value)) return [];
	const ownCommand = typeof value["command"] === "string" ? [value["command"]] : [];
	return [...ownCommand, ...Object.values(value).flatMap(collectHookCommandsFromValue)];
}

function isComponentPackageJson(value: unknown): value is ComponentPackageJson {
	if (!isRecord(value)) return false;
	const dependencies = value["dependencies"];
	const optionalDependencies = value["optionalDependencies"];
	const scripts = value["scripts"];
	const files = value["files"];
	return (
		value["type"] === "module" &&
		value["packageManager"] === "npm@11.12.1" &&
		isStringRecord(value["bin"]) &&
		(dependencies === undefined || isStringRecord(dependencies)) &&
		(optionalDependencies === undefined || isStringRecord(optionalDependencies)) &&
		(scripts === undefined || isStringRecord(scripts)) &&
		(files === undefined || isStringArray(files))
	);
}

function isHooksJson(value: unknown): value is HooksJson {
	if (!isRecord(value) || !isRecord(value["hooks"])) return false;
	return Object.values(value["hooks"]).every(isHookEntries);
}

function isHookEntries(value: unknown): value is readonly HookEntry[] {
	return Array.isArray(value) && value.every(isHookEntry);
}

function isHookEntry(value: unknown): value is HookEntry {
	return isRecord(value) && Array.isArray(value["hooks"]) && value["hooks"].every(isHookCommand);
}

function isHookCommand(value: unknown): value is HookCommand {
	return isRecord(value) && typeof value["command"] === "string";
}

function isMcpJson(value: unknown): value is McpJson {
	if (!isRecord(value) || !isRecord(value["mcpServers"])) return false;
	return Object.values(value["mcpServers"]).every(isMcpServer);
}

function isMcpServer(value: unknown): value is McpServer {
	return (
		isRecord(value) &&
		typeof value["command"] === "string" &&
		Array.isArray(value["args"]) &&
		value["args"].every((item) => typeof item === "string")
	);
}

function isPluginJson(value: unknown): value is PluginJson {
	return isRecord(value) && typeof value["hooks"] === "string";
}

function isStringArray(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
