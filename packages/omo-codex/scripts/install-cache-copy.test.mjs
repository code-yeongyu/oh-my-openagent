import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import test from "node:test";

import { installCachedPlugin } from "./install-dist/install-local.mjs";
import { makeTempDir } from "./install-test-fixtures.mjs";

test("#given source plugin has an npm lockfile #when caching plugin #then lockfile is preserved for deterministic install", async () => {
	// given
	const root = await makeTempDir();
	const codexHome = join(root, "codex-home");
	const sourceRoot = join(root, "plugin");
	await mkdir(sourceRoot, { recursive: true });
	await writeFile(join(sourceRoot, "package.json"), JSON.stringify({ name: "@scope/omo", version: "0.1.0" }));
	const lockfile = '{"packages":{"components/ulw-loop":{}}}\n';
	await writeFile(join(sourceRoot, "package-lock.json"), lockfile);

	// when
	const installed = await installCachedPlugin({
		codexHome,
		marketplaceName: "debug",
		name: "omo",
		sourcePath: sourceRoot,
		version: "0.1.0",
		runCommand: async () => {},
	});

	// then
	assert.equal(await readFile(join(installed.path, "package-lock.json"), "utf8"), lockfile);
});

test("#given cached file dependency is rewritten #when lockfile exists #then package lock stays in sync", async () => {
	// given
	const root = await makeTempDir();
	const codexHome = join(root, "codex-home");
	const sourceRoot = join(root, "packages", "omo-codex", "plugin");
	await mkdir(sourceRoot, { recursive: true });
	await writeFile(
		join(sourceRoot, "package.json"),
		JSON.stringify({
			name: "@scope/omo",
			version: "0.1.0",
			dependencies: { "@scope/lsp-tools": "file:../lsp-tools-mcp" },
		}),
	);
	await writeFile(
		join(sourceRoot, "package-lock.json"),
		JSON.stringify({
			name: "@scope/omo",
			version: "0.1.0",
			lockfileVersion: 3,
			packages: {
				"": {
					name: "@scope/omo",
					version: "0.1.0",
					dependencies: { "@scope/lsp-tools": "file:../lsp-tools-mcp" },
				},
				"../lsp-tools-mcp": { name: "@scope/lsp-tools", version: "0.1.0" },
				"node_modules/@scope/lsp-tools": {
					resolved: "../lsp-tools-mcp",
					link: true,
				},
			},
		}),
	);

	// when
	const installed = await installCachedPlugin({
		codexHome,
		marketplaceName: "debug",
		name: "omo",
		sourcePath: sourceRoot,
		version: "0.1.0",
		runCommand: async () => {},
	});

	// then
	const sourceDependencyPath = join(root, "packages", "omo-codex", "lsp-tools-mcp");
	const packageLockDependencyPath = relative(realpathSync(installed.path), sourceDependencyPath).split(sep).join("/");
	const cachedPackageJson = JSON.parse(await readFile(join(installed.path, "package.json"), "utf8"));
	const cachedPackageLock = JSON.parse(await readFile(join(installed.path, "package-lock.json"), "utf8"));
	assert.equal(cachedPackageJson.dependencies["@scope/lsp-tools"], `file:${sourceDependencyPath}`);
	assert.equal(cachedPackageLock.packages[""].dependencies["@scope/lsp-tools"], `file:${sourceDependencyPath}`);
	assert.deepEqual(cachedPackageLock.packages[packageLockDependencyPath], { name: "@scope/lsp-tools", version: "0.1.0" });
	assert.equal(cachedPackageLock.packages["node_modules/@scope/lsp-tools"].resolved, packageLockDependencyPath);
});

test("#given npm creates workspace bin shims in the cache #when caching plugin #then plugin-owned shims are removed", async () => {
	// given
	const root = await makeTempDir();
	const codexHome = join(root, "codex-home");
	const sourceRoot = join(root, "plugin");
	const componentRoot = join(sourceRoot, "components", "ulw-loop");
	await mkdir(join(componentRoot, "dist"), { recursive: true });
	await writeFile(
		join(sourceRoot, "package.json"),
		JSON.stringify({
			name: "@scope/omo",
			version: "0.1.0",
			workspaces: ["components/ulw-loop"],
		}),
	);
	await writeFile(
		join(componentRoot, "package.json"),
		JSON.stringify({
			name: "@code-yeongyu/codex-ulw-loop",
			version: "0.1.0",
			bin: { "omo-ulw-loop": "dist/cli.js" },
		}),
	);
	await writeFile(join(componentRoot, "dist", "cli.js"), "#!/usr/bin/env node\n");

	// when
	const installed = await installCachedPlugin({
		codexHome,
		marketplaceName: "debug",
		name: "omo",
		sourcePath: sourceRoot,
		version: "0.1.0",
		runCommand: async (_command, args, options) => {
			if (args.join(" ") !== "ci --omit=dev") return;
			const npmBinDir = join(options.cwd, "node_modules", ".bin");
			await mkdir(npmBinDir, { recursive: true });
			await writeFile(join(npmBinDir, "omo-ulw-loop"), "#!/bin/sh\nnode ../@code-yeongyu/codex-ulw-loop/dist/cli.js \"$@\"\n");
			await writeFile(
				join(npmBinDir, "omo-ulw-loop.cmd"),
				'@echo off\r\nnode "%~dp0\\..\\@code-yeongyu\\codex-ulw-loop\\dist\\cli.js" %*\r\n',
			);
			await writeFile(join(npmBinDir, "other-tool.cmd"), "@echo off\r\necho preserved\r\n");
		},
	});

	// then
	await assert.rejects(stat(join(installed.path, "node_modules", ".bin", "omo-ulw-loop")));
	await assert.rejects(stat(join(installed.path, "node_modules", ".bin", "omo-ulw-loop.cmd")));
	assert.equal(await readFile(join(installed.path, "node_modules", ".bin", "other-tool.cmd"), "utf8"), "@echo off\r\necho preserved\r\n");
});

test("#given packaged root CLI runtimes #when caching omo plugin #then root dist is materialized into the plugin cache", async () => {
	// given
	const root = await makeTempDir();
	const repoRoot = join(root, "repo");
	const codexHome = join(root, "codex-home");
	const sourceRoot = join(repoRoot, "packages", "omo-codex", "plugin");
	await mkdir(sourceRoot, { recursive: true });
	await mkdir(join(repoRoot, "dist", "cli"), { recursive: true });
	await mkdir(join(repoRoot, "dist", "cli-node"), { recursive: true });
	await writeFile(join(sourceRoot, "package.json"), JSON.stringify({ name: "@scope/omo", version: "0.1.0" }));
	await writeFile(join(repoRoot, "dist", "cli", "index.js"), "console.log('omo')\n");
	await writeFile(join(repoRoot, "dist", "cli-node", "index.js"), "console.log('omo node')\n");

	// when
	const installed = await installCachedPlugin({
		codexHome,
		marketplaceName: "sisyphuslabs",
		name: "omo",
		sourcePath: sourceRoot,
		version: "0.1.0",
		runCommand: async () => {},
	});

	// then
	assert.equal(await readFile(join(installed.path, "dist", "cli", "index.js"), "utf8"), "console.log('omo')\n");
	assert.equal(await readFile(join(installed.path, "dist", "cli-node", "index.js"), "utf8"), "console.log('omo node')\n");
});

test("#given existing cache #when npm install fails #then previous active cache is preserved", async () => {
	// given
	const root = await makeTempDir();
	const codexHome = join(root, "codex-home");
	const sourceRoot = join(root, "plugin");
	const cacheRoot = join(codexHome, "plugins", "cache", "debug", "omo", "0.1.0");
	await mkdir(sourceRoot, { recursive: true });
	await mkdir(cacheRoot, { recursive: true });
	await writeFile(join(sourceRoot, "package.json"), JSON.stringify({ name: "@scope/omo", version: "0.1.0" }));
	await writeFile(join(cacheRoot, "package.json"), JSON.stringify({ name: "@scope/omo-old", version: "0.0.9" }));

	// when
	await assert.rejects(
		installCachedPlugin({
			codexHome,
			marketplaceName: "debug",
			name: "omo",
			sourcePath: sourceRoot,
			version: "0.1.0",
			runCommand: async (_command, args) => {
				if (args.join(" ") === "ci --omit=dev") throw new Error("spawn npm ENOENT");
			},
		}),
		/spawn npm ENOENT/,
	);

	// then
	assert.equal(await readFile(join(cacheRoot, "package.json"), "utf8"), JSON.stringify({ name: "@scope/omo-old", version: "0.0.9" }));
	const cacheParentEntries = await readdir(join(codexHome, "plugins", "cache", "debug", "omo"));
	assert.deepEqual(cacheParentEntries, ["0.1.0"]);
});

test("#given existing cache #when final promotion fails #then previous active cache is restored", async () => {
	// given
	const root = await makeTempDir();
	const codexHome = join(root, "codex-home");
	const sourceRoot = join(root, "plugin");
	const cacheRoot = join(codexHome, "plugins", "cache", "debug", "omo", "0.1.0");
	await mkdir(sourceRoot, { recursive: true });
	await mkdir(cacheRoot, { recursive: true });
	await writeFile(join(sourceRoot, "package.json"), JSON.stringify({ name: "@scope/omo", version: "0.1.0" }));
	await writeFile(join(cacheRoot, "package.json"), JSON.stringify({ name: "@scope/omo-old", version: "0.0.9" }));

	// when
	await assert.rejects(
		installCachedPlugin({
			codexHome,
			marketplaceName: "debug",
			name: "omo",
			sourcePath: sourceRoot,
			version: "0.1.0",
			runCommand: async () => undefined,
			renameDirectory: async (fromPath, toPath) => {
				if (toPath === cacheRoot && basename(fromPath).startsWith(".tmp-")) throw new Error("rename final failed");
				await rename(fromPath, toPath);
			},
		}),
		/rename final failed/,
	);

	// then
	assert.equal(await readFile(join(cacheRoot, "package.json"), "utf8"), JSON.stringify({ name: "@scope/omo-old", version: "0.0.9" }));
	const cacheParentEntries = await readdir(join(codexHome, "plugins", "cache", "debug", "omo"));
	assert.deepEqual(cacheParentEntries, ["0.1.0"]);
});
