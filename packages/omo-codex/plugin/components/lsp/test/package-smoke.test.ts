import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type PackageJson = {
	readonly version: string;
	readonly type: string;
	readonly packageManager: string;
	readonly bin: Record<string, string>;
	readonly dependencies: Record<string, string>;
	readonly scripts: Record<string, string>;
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
	it("#given packaged component files #when validating entrypoints #then hook command stays local and MCP command references the package", () => {
		// given
		const packageJson = readPackageJson("package.json");
		const hooksJson = readHooksJson("hooks/hooks.json");
		const mcpJson = readMcpJson(".mcp.json");
		const cliSource = readFileSync("src/cli.ts", "utf8");
		const codexHookCliSource = readFileSync("src/codex-hook-cli.ts", "utf8");
		const codexHookSource = readFileSync("src/codex-hook.ts", "utf8");
		const sourceFiles = readdirSync("src");

		// when
		const postToolUseCommand = hooksJson.hooks["PostToolUse"]?.[0]?.hooks[0]?.command;
		const postCompactCommand = hooksJson.hooks["PostCompact"]?.[0]?.hooks[0]?.command;
		const lspServer = mcpJson.mcpServers["lsp"];
		const pluginRoot = ["$", "{PLUGIN_ROOT}"].join("");

		// then
		expect(packageJson.type).toBe("module");
		expect(packageJson.packageManager).toBe("npm@11.12.1");
		expect(packageJson.dependencies).toEqual({
			"@code-yeongyu/lsp-daemon": "file:../../../../lsp-daemon",
		});
		expect(packageJson.bin["omo-lsp"]).toBe("./dist/cli.js");
		expect(packageJson.bin["codex-lsp"]).toBeUndefined();
		expect(packageJson.scripts["build"]).toBe("node scripts/clean-dist.mjs && tsc -p tsconfig.build.json");
		expect(cliSource.startsWith("#!/usr/bin/env node")).toBe(true);
		expect(cliSource).toContain("Usage: omo-lsp [mcp | hook post-tool-use | hook post-compact]");
		expect(postToolUseCommand).toBe(`node "${pluginRoot}/dist/cli.js" hook post-tool-use`);
		expect(postCompactCommand).toBe(`node "${pluginRoot}/dist/cli.js" hook post-compact`);
		expect(lspServer?.command).toBe("node");
		expect(lspServer?.args).toEqual(["../../../../lsp-daemon/dist/cli.js", "mcp"]);
		expect(cliSource).not.toContain("./lazy-lsp-mcp.js");
		expect(cliSource).toContain("@code-yeongyu/lsp-daemon/dist/cli.js");
		expect(cliSource).not.toContain("../../../../../lsp-daemon/dist/cli.js");
		expect(codexHookCliSource).toContain("@code-yeongyu/lsp-daemon");
		expect(codexHookSource).toContain("@code-yeongyu/lsp-daemon");
		expect(codexHookCliSource).not.toContain("../../../../../lsp-daemon");
		expect(codexHookSource).not.toContain("../../../../../lsp-daemon");
		expect(sourceFiles.filter((name) => name.startsWith("lazy-mcp") || name === "lazy-lsp-mcp.ts")).toEqual([]);
	});

});

function isPackageJson(value: unknown): value is PackageJson {
	return (
		isRecord(value) &&
		typeof value["version"] === "string" &&
		value["type"] === "module" &&
		value["packageManager"] === "npm@11.12.1" &&
		isStringRecord(value["bin"]) &&
		isStringRecord(value["dependencies"]) &&
		isStringRecord(value["scripts"])
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
