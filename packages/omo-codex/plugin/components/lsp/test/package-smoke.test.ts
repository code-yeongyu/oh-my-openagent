import { describe, expect, it } from "vitest";
import {
	listDirectoryEntries,
	readHooksJson,
	readJsonFile,
	readMcpJson,
	readPackageJson,
	readTextFile,
	requireScripts,
} from "../../test-support/package-smoke-fixture.js";

describe("plugin package metadata", () => {
	it("#given packaged component files #when validating entrypoints #then hook command stays local and MCP command references the package", () => {
		// given
		const packageJson = readPackageJson("package.json");
		const hooksJson = readHooksJson("hooks/hooks.json");
		const mcpJson = readMcpJson(".mcp.json");
		const cliSource = readTextFile("src/cli.ts");
		const sourceFiles = listDirectoryEntries("src");
		const scripts = requireScripts(packageJson, "package.json");

		// when
		const postToolUseCommand = hooksJson.hooks["PostToolUse"]?.[0]?.hooks[0]?.command;
		const postCompactCommand = hooksJson.hooks["PostCompact"]?.[0]?.hooks[0]?.command;
		const lspServer = mcpJson.mcpServers["lsp"];
		const pluginRoot = ["$", "{PLUGIN_ROOT}"].join("");

		// then
		expect(packageJson.type).toBe("module");
		expect(packageJson.packageManager).toBe("npm@11.12.1");
		expect(packageJson.dependencies).toEqual({
			"@oh-my-opencode/lsp-core": "file:../../../../lsp-core",
			"@code-yeongyu/lsp-daemon": "file:../../../../lsp-daemon",
		});
		expect(packageJson.bin["omo-lsp"]).toBe("./dist/cli.js");
		expect(packageJson.bin["codex-lsp"]).toBeUndefined();
		expect(scripts["build"]).toBe("node scripts/build-runtime.mjs");
		expect(scripts["pretest"]).toBe("npm run build --silent");
		expect(cliSource.startsWith("#!/usr/bin/env node")).toBe(true);
		expect(cliSource).toContain("Usage: omo-lsp [mcp | hook post-tool-use | hook post-compact]");
		expect(postToolUseCommand).toBe(`node "${pluginRoot}/dist/cli.js" hook post-tool-use`);
		expect(postCompactCommand).toBe(`node "${pluginRoot}/dist/cli.js" hook post-compact`);
		expect(lspServer?.command).toBe("node");
		expect(lspServer?.args).toEqual(["../../../../lsp-daemon/dist/cli.js", "mcp"]);
		expect(readJsonFile(".mcp.json")).toEqual({
			mcpServers: {
				lsp: {
					command: "node",
					args: ["../../../../lsp-daemon/dist/cli.js", "mcp"],
					cwd: ".",
					startup_timeout_sec: 10,
				},
			},
		});
		expect(sourceFiles.filter((name) => name.startsWith("lazy-mcp") || name === "lazy-lsp-mcp.ts")).toEqual([]);
	});
});
