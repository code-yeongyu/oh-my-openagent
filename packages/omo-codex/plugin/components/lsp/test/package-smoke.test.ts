import { describe, expect, it } from "vitest";
import {
	listDirectoryEntries,
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
		const daemonCliPathSource = readTextFile("src/daemon-cli-path.ts");
		const codexHookCliSource = readTextFile("src/codex-hook-cli.ts");
		const codexHookSource = readTextFile("src/codex-hook.ts");
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
		expect(lspServer?.startup_timeout_sec).toBe(10);
		expect(cliSource).not.toContain("./lazy-lsp-mcp.js");
		expect(cliSource).toContain("resolveLspDaemonCliPath");
		expect(daemonCliPathSource).toContain("@code-yeongyu/lsp-daemon/cli");
		expect(daemonCliPathSource).toContain("../../lsp-daemon/dist/cli.js");
		expect(daemonCliPathSource).toContain("OMO_LSP_DAEMON_VERSION");
		expect(cliSource).not.toContain("../../../../../lsp-daemon/dist/cli.js");
		expect(codexHookSource).toContain("ensureLspDaemonCliEnv");
		expect(codexHookCliSource).not.toContain("@code-yeongyu/lsp-daemon");
		expect(codexHookSource).toContain("@code-yeongyu/lsp-daemon/client");
		expect(codexHookSource).toContain("@oh-my-opencode/lsp-core/post-edit");
		expect(codexHookSource).toContain("CODEX_HOME");
		expect(codexHookCliSource).not.toContain("../../../../../lsp-daemon");
		expect(codexHookSource).not.toContain("../../../../../lsp-daemon");
		expect(sourceFiles.filter((name) => name.startsWith("lazy-mcp") || name === "lazy-lsp-mcp.ts")).toEqual([]);
	});

	it("#given built component CLI #when runtime imports are inspected #then it is self-contained except Node builtins", () => {
		const cliSource = readTextFile("dist/cli.js");
		const imports = [
			...cliSource.matchAll(/\bimport\s+(?:[^'";]+?\s+from\s+)?["']([^"']+)["']/g),
			...cliSource.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
		].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
		expect(imports.filter((specifier) => !specifier.startsWith("node:"))).toEqual([]);
		expect(cliSource).not.toContain("@code-yeongyu/lsp-daemon/client");
		expect(cliSource).not.toContain("@oh-my-opencode/lsp-core");
	});
});
