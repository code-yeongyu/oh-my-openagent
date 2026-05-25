import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type PackageJson = {
	readonly version: string;
	readonly type: string;
	readonly packageManager: string;
	readonly bin: Record<string, string>;
	readonly dependencies: Record<string, string>;
};

type PluginJson = {
	readonly version: string;
	readonly hooks: string;
	readonly mcpServers: string;
};

type HookCommand = {
	readonly command: string;
};

type HookEntry = {
	readonly hooks: readonly HookCommand[];
};

type HooksJson = {
	readonly hooks: Record<string, readonly HookEntry[]>;
};

type McpServer = {
	readonly command: string;
	readonly args: readonly string[];
};

type McpJson = {
	readonly mcpServers: Record<string, McpServer>;
};

function readPackageJson(path: string): PackageJson {
	const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
	if (!isPackageJson(parsed)) throw new TypeError(`Invalid package metadata: ${path}`);
	return parsed;
}

function readPluginJson(path: string): PluginJson {
	const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
	if (!isPluginJson(parsed)) throw new TypeError(`Invalid plugin metadata: ${path}`);
	return parsed;
}

function readHooksJson(path: string): HooksJson {
	const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
	if (!isHooksJson(parsed)) throw new TypeError(`Invalid hooks metadata: ${path}`);
	return parsed;
}

function readMcpJson(path: string): McpJson {
	const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
	if (!isMcpJson(parsed)) throw new TypeError(`Invalid MCP metadata: ${path}`);
	return parsed;
}

describe("plugin package metadata", () => {
	it("#given packaged plugin files #when validating entrypoints #then hook command uses portable plugin root interpolation", () => {
		// given
		const packageJson = readPackageJson("package.json");
		const pluginJson = readPluginJson(".codex-plugin/plugin.json");
		const hooksJson = readHooksJson("hooks/hooks.json");
		const mcpJson = readMcpJson(".mcp.json");
		const cliSource = readFileSync("src/cli.ts", "utf8");

		// when
		const command = hooksJson.hooks["PostToolUse"]?.[0]?.hooks[0]?.command;
		const lspServer = mcpJson.mcpServers["lsp"];
		const pluginRoot = ["$", "{PLUGIN_ROOT}"].join("");

		// then
		expect(pluginJson.version).toBe(packageJson.version);
		expect(packageJson.type).toBe("module");
		expect(packageJson.packageManager).toBe("npm@11.12.1");
		expect(packageJson.dependencies).toEqual({
			"@code-yeongyu/lsp-tools-mcp": "file:./packages/lsp-tools-mcp",
		});
		expect(packageJson.bin["codex-lsp"]).toBe("./dist/cli.js");
		expect(pluginJson.hooks).toBe("./hooks/hooks.json");
		expect(pluginJson.mcpServers).toBe("./.mcp.json");
		expect(cliSource.startsWith("#!/usr/bin/env node")).toBe(true);
		expect(command).toBe(`node "${pluginRoot}/dist/cli.js" hook post-tool-use`);
		expect(lspServer?.command).toBe("node");
		expect(lspServer?.args).toEqual(["./packages/lsp-tools-mcp/dist/cli.js", "mcp"]);
	});

	it("#given LSP skill guidance #when validating MCP tool instructions #then tool names are not framed as shell commands", () => {
		// given
		const skill = readFileSync("skills/lsp/SKILL.md", "utf8");

		// when
		const mentionsToolInterface = skill.includes("through the tool interface");
		const rejectsShellExecution = skill.includes("not shell commands");

		// then
		expect(mentionsToolInterface).toBe(true);
		expect(rejectsShellExecution).toBe(true);
	});
});

function isPackageJson(value: unknown): value is PackageJson {
	return (
		isRecord(value) &&
		typeof value["version"] === "string" &&
		value["type"] === "module" &&
		value["packageManager"] === "npm@11.12.1" &&
		isStringRecord(value["bin"]) &&
		isStringRecord(value["dependencies"])
	);
}

function isPluginJson(value: unknown): value is PluginJson {
	return (
		isRecord(value) &&
		typeof value["version"] === "string" &&
		typeof value["hooks"] === "string" &&
		typeof value["mcpServers"] === "string"
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

function isStringRecord(value: unknown): value is Record<string, string> {
	return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
