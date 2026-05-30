import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { installCachedPlugin } from "./install/cache.mjs";
import { createCachedMcpRuntimeArgRewriter } from "./install/mcp-runtime-cache.mjs";
import { makeTempDir, writeJson } from "./install-test-fixtures.mjs";

test("#given external MCP package runtime #when installing cached plugin #then runtime is copied into the plugin cache", async () => {
	const repoRoot = await makeTempDir();
	const codexHome = await makeTempDir();
	const sourceRoot = join(repoRoot, "packages", "omo-codex", "plugin");
	const astGrepPackageRoot = join(repoRoot, "packages", "ast-grep-mcp");
	const lspPackageRoot = join(repoRoot, "packages", "lsp-tools-mcp");

	await writeJson(join(astGrepPackageRoot, "package.json"), {
		name: "@example/does-not-matter-either",
		version: "0.1.0",
		type: "module",
		bin: { "omo-ast-grep": "./dist/cli.js" },
	});
	await writeJson(join(lspPackageRoot, "package.json"), {
		name: "@example/does-not-matter",
		version: "0.1.0",
		type: "module",
		bin: { "omo-lsp": "./dist/cli.js" },
	});
	await writeJson(join(sourceRoot, "package.json"), {
		name: "@example/omo",
		version: "0.1.0",
	});
	await writeJson(join(sourceRoot, ".mcp.json"), {
		mcpServers: {
			ast_grep: {
				command: "node",
				args: ["../../ast-grep-mcp/dist/cli.js", "mcp"],
				cwd: ".",
			},
			lsp: {
				command: "node",
				args: ["../../lsp-tools-mcp/dist/cli.js", "mcp"],
				cwd: ".",
			},
		},
	});
	await writeJson(join(astGrepPackageRoot, "dist", "cli.js"), { executable: true });
	await writeJson(join(lspPackageRoot, "dist", "cli.js"), { executable: true });
	await writeJson(join(lspPackageRoot, "dist", "lsp", "manager.js"), { copied: true });

	const result = await installCachedPlugin({
		codexHome,
		marketplaceName: "sisyphuslabs",
		name: "omo",
		runCommand: async () => {},
		sourcePath: sourceRoot,
		version: "0.1.0",
	});

	const cachedMcp = JSON.parse(await readFile(join(result.path, ".mcp.json"), "utf8"));
	const copiedAstGrepCli = join(result.path, "mcp", "ast_grep", "dist", "cli.js");
	const copiedCli = join(result.path, "mcp", "lsp", "dist", "cli.js");

	assert.deepEqual(cachedMcp.mcpServers.ast_grep.args, [copiedAstGrepCli, "mcp"]);
	assert.deepEqual(cachedMcp.mcpServers.lsp.args, [copiedCli, "mcp"]);
	assert.equal(Object.hasOwn(cachedMcp.mcpServers.ast_grep, "cwd"), false);
	assert.equal(Object.hasOwn(cachedMcp.mcpServers.lsp, "cwd"), false);
	assert.equal((await stat(copiedAstGrepCli)).isFile(), true);
	assert.equal((await stat(copiedCli)).isFile(), true);
	assert.equal((await stat(join(result.path, "mcp", "lsp", "dist", "lsp", "manager.js"))).isFile(), true);
});

test("#given multiple args from one external MCP package #when rewriting #then copies the dist tree once and rewrites each runtime arg", async () => {
	const repoRoot = await makeTempDir();
	const pluginRoot = join(repoRoot, "packages", "omo-codex", "plugin");
	const sourceRoot = pluginRoot;
	const packageRoot = join(repoRoot, "packages", "multi-tool-mcp");
	const copiedRoots = [];

	await writeJson(join(packageRoot, "package.json"), {
		name: "@example/multi-tool-mcp",
		version: "0.1.0",
		bin: { "multi-tool": "./dist/cli.js" },
	});
	await writeJson(join(packageRoot, "dist", "cli.js"), { executable: true });
	await writeJson(join(packageRoot, "dist", "worker.js"), { worker: true });

	const rewrite = createCachedMcpRuntimeArgRewriter({
		copyDist: async (_source, target) => {
			copiedRoots.push(target);
		},
	});

	const first = await rewrite({ arg: "../../multi-tool-mcp/dist/cli.js", pluginRoot, serverName: "multi", sourceRoot });
	const second = await rewrite({ arg: "../../multi-tool-mcp/dist/worker.js", pluginRoot, serverName: "multi", sourceRoot });

	assert.equal(copiedRoots.length, 1);
	assert.deepEqual([first, second], [
		join(pluginRoot, "mcp", "multi", "dist", "cli.js"),
		join(pluginRoot, "mcp", "multi", "dist", "worker.js"),
	]);
});

test("#given plugin-local MCP runtime #when rewriting cached manifest args #then keeps the cached plugin dist path", async () => {
	const repoRoot = await makeTempDir();
	const codexHome = await makeTempDir();
	const sourceRoot = join(repoRoot, "packages", "omo-codex", "plugin");
	const pluginRoot = join(codexHome, "plugins", "cache", "sisyphuslabs", "omo", "0.1.0");
	const copiedRoots = [];

	await writeJson(join(sourceRoot, "package.json"), {
		name: "@example/source-plugin",
		version: "0.1.0",
	});
	await writeJson(join(pluginRoot, "package.json"), {
		name: "@example/cached-plugin",
		version: "0.1.0",
	});
	await writeJson(join(pluginRoot, "dist", "cli.js"), { executable: true });

	const rewrite = createCachedMcpRuntimeArgRewriter({
		copyDist: async (_source, target) => {
			copiedRoots.push(target);
		},
	});

	const runtimeArg = await rewrite({ arg: "./dist/cli.js", pluginRoot, serverName: "omo", sourceRoot });

	assert.equal(runtimeArg, join(pluginRoot, "dist", "cli.js"));
	assert.equal(copiedRoots.length, 0);
});

test("#given structurally valid external MCP package without mcp suffix #when installing cached plugin #then runtime is copied into the plugin cache", async () => {
	const repoRoot = await makeTempDir();
	const codexHome = await makeTempDir();
	const sourceRoot = join(repoRoot, "packages", "omo-codex", "plugin");
	const runtimePackageRoot = join(repoRoot, "packages", "language-tools");

	await writeJson(join(runtimePackageRoot, "package.json"), {
		name: "@example/language-tools",
		version: "0.1.0",
		type: "module",
		bin: { "omo-language-tools": "./dist/cli.js" },
	});
	await writeJson(join(runtimePackageRoot, "dist", "cli.js"), { executable: true });
	await writeJson(join(sourceRoot, "package.json"), {
		name: "@example/omo",
		version: "0.1.0",
	});
	await writeJson(join(sourceRoot, ".mcp.json"), {
		mcpServers: {
			language_tools: {
				command: "node",
				args: ["../../language-tools/dist/cli.js", "mcp", "../local-config.json"],
				cwd: ".",
			},
		},
	});

	const result = await installCachedPlugin({
		codexHome,
		marketplaceName: "sisyphuslabs",
		name: "omo",
		runCommand: async () => {},
		sourcePath: sourceRoot,
		version: "0.1.0",
	});

	const cachedMcp = JSON.parse(await readFile(join(result.path, ".mcp.json"), "utf8"));
	const copiedCli = join(result.path, "mcp", "language_tools", "dist", "cli.js");
	assert.deepEqual(cachedMcp.mcpServers.language_tools.args, [copiedCli, "mcp", join(sourceRoot, "..", "local-config.json")]);
	assert.equal((await stat(copiedCli)).isFile(), true);
});
