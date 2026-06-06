import { describe, expect, it } from "vitest";
import {
	listDirectoryNames,
	readHooksJson,
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
		const codexHookCliSource = readTextFile("src/codex-hook-cli.ts");
		const codexHookSource = readTextFile("src/codex-hook.ts");
		const sourceFiles = listDirectoryNames("src");
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
			"@code-yeongyu/lsp-daemon": "file:../../../../lsp-daemon",
		});
		expect(packageJson.bin["omo-lsp"]).toBe("./dist/cli.js");
		expect(packageJson.bin["codex-lsp"]).toBeUndefined();
		expect(scripts["build"]).toBe("node scripts/clean-dist.mjs && tsc -p tsconfig.build.json");
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

	it("#given LSP skill guidance #when validating MCP tool instructions #then tool names are not framed as shell commands", () => {
		// given
		const skill = readTextFile("skills/lsp/SKILL.md");

		// when
		const mentionsToolInterface = skill.includes("through the tool interface");
		const rejectsShellExecution = skill.includes("not shell commands");

		// then
		expect(mentionsToolInterface).toBe(true);
		expect(rejectsShellExecution).toBe(true);
	});
});
