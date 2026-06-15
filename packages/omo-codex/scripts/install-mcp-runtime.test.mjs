import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { installCachedPlugin } from "./install-dist/install-local.mjs";
import { makeTempDir, writeJson } from "./install-test-fixtures.mjs";

test("#given external MCP package runtime #when installing cached plugin #then runtime is copied into the plugin cache", async () => {
	const repoRoot = await makeTempDir();
	const codexHome = await makeTempDir();
	const sourceRoot = join(repoRoot, "packages", "omo-codex", "plugin");
	const astGrepPackageRoot = join(repoRoot, "packages", "ast-grep-mcp");
	const gitBashPackageRoot = join(repoRoot, "packages", "git-bash-mcp");
	const lspPackageRoot = join(repoRoot, "packages", "lsp-daemon");

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
	await writeJson(join(gitBashPackageRoot, "package.json"), {
		name: "@example/git-bash-mcp",
		version: "0.1.0",
		type: "module",
		bin: { "omo-git-bash": "./dist/cli.js" },
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
			git_bash: {
				command: "node",
				args: ["../../git-bash-mcp/dist/cli.js", "mcp"],
				cwd: ".",
			},
			lsp: {
				command: "node",
				args: ["../../lsp-daemon/dist/cli.js", "mcp"],
				cwd: ".",
			},
		},
	});
	await writeJson(join(astGrepPackageRoot, "dist", "cli.js"), { executable: true });
	await writeJson(join(gitBashPackageRoot, "dist", "cli.js"), { executable: true });
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
	const copiedAstGrepCli = join(result.path, "components", "ast-grep-mcp", "dist", "cli.js");
	const copiedGitBashCli = join(result.path, "components", "git-bash-mcp", "dist", "cli.js");
	const copiedCli = join(result.path, "components", "lsp-daemon", "dist", "cli.js");

	assert.deepEqual(cachedMcp.mcpServers.ast_grep.args, [copiedAstGrepCli, "mcp"]);
	assert.deepEqual(cachedMcp.mcpServers.git_bash.args, [copiedGitBashCli, "mcp"]);
	assert.deepEqual(cachedMcp.mcpServers.lsp.args, [copiedCli, "mcp"]);
	assert.equal(Object.hasOwn(cachedMcp.mcpServers.ast_grep, "cwd"), false);
	assert.equal(Object.hasOwn(cachedMcp.mcpServers.git_bash, "cwd"), false);
	assert.equal(Object.hasOwn(cachedMcp.mcpServers.lsp, "cwd"), false);
	assert.equal((await stat(copiedAstGrepCli)).isFile(), true);
	assert.equal((await stat(copiedGitBashCli)).isFile(), true);
	assert.equal((await stat(copiedCli)).isFile(), true);
	assert.equal((await stat(join(result.path, "components", "lsp-daemon", "dist", "lsp", "manager.js"))).isFile(), true);
});

test("#given plugin-local MCP runtime #when installing cached plugin #then manifest args point at the cached plugin dist", async () => {
	const repoRoot = await makeTempDir();
	const codexHome = await makeTempDir();
	const sourceRoot = join(repoRoot, "packages", "omo-codex", "plugin");

	await writeJson(join(sourceRoot, "package.json"), {
		name: "@example/source-plugin",
		version: "0.1.0",
	});
	await writeJson(join(sourceRoot, ".mcp.json"), {
		mcpServers: {
			omo: {
				command: "node",
				args: ["./dist/cli.js"],
				cwd: ".",
			},
		},
	});
	await writeJson(join(sourceRoot, "dist", "cli.js"), { executable: true });

	const result = await installCachedPlugin({
		codexHome,
		marketplaceName: "sisyphuslabs",
		name: "omo",
		runCommand: async () => {},
		sourcePath: sourceRoot,
		version: "0.1.0",
	});

	const cachedMcp = JSON.parse(await readFile(join(result.path, ".mcp.json"), "utf8"));

	assert.deepEqual(cachedMcp.mcpServers.omo.args, [join(result.path, "dist", "cli.js")]);
});

test("#given external MCP package not in the generated bundled runtime set #when installing cached plugin #then manifest args point at source", async () => {
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
	assert.deepEqual(cachedMcp.mcpServers.language_tools.args, [join(runtimePackageRoot, "dist", "cli.js"), "mcp", join(sourceRoot, "..", "local-config.json")]);
	await assert.rejects(() => stat(copiedCli));
});

test("#given packaged bundled MCP runtime has only dist files #when installing cached plugin #then runtime is copied into the plugin cache", async () => {
	// given
	const repoRoot = await makeTempDir();
	const codexHome = await makeTempDir();
	const sourceRoot = join(repoRoot, "packages", "omo-codex", "plugin");
	const lspPackageRoot = join(repoRoot, "packages", "lsp-daemon");

	await writeJson(join(sourceRoot, "package.json"), {
		name: "@example/omo",
		version: "0.1.0",
	});
	await writeJson(join(sourceRoot, ".mcp.json"), {
		mcpServers: {
			lsp: {
				command: "node",
				args: ["../../lsp-daemon/dist/cli.js", "mcp"],
				cwd: ".",
			},
		},
	});
	await writeJson(join(lspPackageRoot, "dist", "cli.js"), { executable: true });
	await writeJson(join(lspPackageRoot, "dist", "lsp", "manager.js"), { copied: true });

	// when
	const result = await installCachedPlugin({
		codexHome,
		marketplaceName: "sisyphuslabs",
		name: "omo",
		runCommand: async () => {},
		sourcePath: sourceRoot,
		version: "0.1.0",
	});

	// then
	const cachedMcp = JSON.parse(await readFile(join(result.path, ".mcp.json"), "utf8"));
	const copiedCli = join(result.path, "components", "lsp-daemon", "dist", "cli.js");
	assert.deepEqual(cachedMcp.mcpServers.lsp.args, [copiedCli, "mcp"]);
	assert.equal(Object.hasOwn(cachedMcp.mcpServers.lsp, "cwd"), false);
	assert.equal((await stat(copiedCli)).isFile(), true);
	assert.equal((await stat(join(result.path, "components", "lsp-daemon", "dist", "lsp", "manager.js"))).isFile(), true);
	assert.notEqual(cachedMcp.mcpServers.lsp.args[0], join(lspPackageRoot, "dist", "cli.js"));
});
