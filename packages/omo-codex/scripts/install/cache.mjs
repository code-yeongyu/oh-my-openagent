import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";

import { createCachedMcpRuntimeArgRewriter } from "./mcp-runtime-cache.mjs";
import { exists, isRecord } from "./utils.mjs";
export { linkCachedPluginBins, linkRootRuntimeBin } from "./bin-links.mjs";

export async function installCachedPlugin({ buildSource = true, codexHome, marketplaceName, name, renameDirectory = rename, runCommand, sourcePath, version }) {
	if (buildSource) {
		await maybeRunNpmInstall(sourcePath, runCommand);
		await maybeRunNpmBuild(sourcePath, runCommand);
	}

	const targetPath = join(codexHome, "plugins", "cache", marketplaceName, name, version);
	const tempPath = createTempSiblingPath(targetPath);
	await rm(tempPath, { recursive: true, force: true });
	try {
		await copyDirectory(sourcePath, tempPath, shouldCopyPluginPath);
		await rewriteCachedPackageLocalFileDependencies(tempPath, sourcePath);
		await maybeRunNpmInstall(tempPath, runCommand, ["install", "--omit=dev"]);
		await rewriteCachedMcpManifest(tempPath, sourcePath);
		await rewriteCachedManifestRoot(tempPath, tempPath, targetPath);
		await promoteDirectory(tempPath, targetPath, renameDirectory);
	} catch (error) {
		await rm(tempPath, { recursive: true, force: true });
		throw error;
	}
	return { name, version, path: targetPath };
}

export async function pruneMarketplaceCache({ codexHome, marketplaceName, keepPluginNames }) {
	const cacheRoot = join(codexHome, "plugins", "cache", marketplaceName);
	if (!(await exists(cacheRoot))) return;
	const keep = new Set(keepPluginNames);
	const entries = await readdir(cacheRoot, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isDirectory() || keep.has(entry.name)) continue;
		await rm(join(cacheRoot, entry.name), { recursive: true, force: true });
	}
}

export async function pruneMarketplacePluginCaches({ codexHome, marketplaceName, pluginNames }) {
	const cacheRoot = join(codexHome, "plugins", "cache", marketplaceName);
	if (!(await exists(cacheRoot))) return;
	for (const pluginName of pluginNames) {
		await rm(join(cacheRoot, pluginName), { recursive: true, force: true });
	}
	if ((await readdir(cacheRoot)).length === 0) {
		await rm(cacheRoot, { recursive: true, force: true });
	}
}

async function maybeRunNpmInstall(cwd, runCommand, args = ["install"]) {
	if (!(await exists(join(cwd, "package.json")))) return;
	await runCommand("npm", args, { cwd });
}

async function maybeRunNpmBuild(cwd, runCommand) {
	if (!(await exists(join(cwd, "package.json")))) return;
	const packageJson = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
	if (!isRecord(packageJson.scripts) || typeof packageJson.scripts.build !== "string") return;
	await runCommand("npm", ["run", "build"], { cwd });
}

function createTempSiblingPath(targetPath) {
	return join(dirname(targetPath), `.tmp-${basename(targetPath)}-${process.pid}-${Date.now()}`);
}

function createBackupSiblingPath(targetPath) {
	return join(dirname(targetPath), `.backup-${basename(targetPath)}-${process.pid}-${Date.now()}`);
}

async function copyDirectory(sourcePath, targetPath, filter) {
	await mkdir(dirname(targetPath), { recursive: true });
	await cp(sourcePath, targetPath, {
		recursive: true,
		filter: (source) => filter(source, sourcePath),
	});
}

async function promoteDirectory(tempPath, targetPath, renameDirectory) {
	const backupPath = createBackupSiblingPath(targetPath);
	await rm(backupPath, { recursive: true, force: true });
	let backupMoved = false;
	try {
		if (await exists(targetPath)) {
			await renameDirectory(targetPath, backupPath);
			backupMoved = true;
		}
		await renameDirectory(tempPath, targetPath);
	} catch (error) {
		if (backupMoved) await restoreBackupDirectory(backupPath, targetPath, renameDirectory);
		throw error;
	}
	if (backupMoved) await rm(backupPath, { recursive: true, force: true });
}

async function restoreBackupDirectory(backupPath, targetPath, renameDirectory) {
	if (!(await exists(backupPath))) return;
	await rm(targetPath, { recursive: true, force: true });
	await renameDirectory(backupPath, targetPath);
}

function shouldCopyPluginPath(path, root) {
	const relative = path === root ? "" : path.slice(root.length + sep.length);
	if (relative === "") return true;
	const parts = relative.split(sep);
	if (parts[parts.length - 1] === "package-lock.json") return false;
	return !parts.some((part) => part === ".git" || part === "node_modules");
}

export async function rewriteCachedMcpManifest(pluginRoot, sourceRoot = pluginRoot) {
	const manifestPath = join(pluginRoot, ".mcp.json");
	if (!(await exists(manifestPath))) return;
	const raw = await readFile(manifestPath, "utf8");
	const parsed = JSON.parse(raw);
	if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) return;
	let changed = false;
	const rewriteRuntimeArg = createCachedMcpRuntimeArgRewriter();
	for (const [serverName, server] of Object.entries(parsed.mcpServers)) {
		if (!isRecord(server)) continue;
		if (server.cwd === "." || server.cwd === "./") {
			delete server.cwd;
			changed = true;
		}
		if (!Array.isArray(server.args)) continue;
		const nextArgs = await Promise.all(
			server.args.map((arg) => rewriteRuntimeArg({ arg, pluginRoot, serverName, sourceRoot })),
		);
		if (nextArgs.some((value, index) => value !== server.args[index])) {
			server.args = nextArgs;
			changed = true;
		}
	}
	if (changed) await writeFile(manifestPath, `${JSON.stringify(parsed, null, "\t")}\n`);
}

async function rewriteCachedManifestRoot(pluginRoot, fromRoot, toRoot) {
	const manifestPath = join(pluginRoot, ".mcp.json");
	if (!(await exists(manifestPath))) return;
	const raw = await readFile(manifestPath, "utf8");
	const parsed = JSON.parse(raw);
	if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) return;
	let changed = false;
	for (const server of Object.values(parsed.mcpServers)) {
		if (!isRecord(server) || !Array.isArray(server.args)) continue;
		const nextArgs = server.args.map((arg) => {
			if (typeof arg !== "string") return arg;
			if (arg === fromRoot) return toRoot;
			const prefix = `${fromRoot}${sep}`;
			if (!arg.startsWith(prefix)) return arg;
			return `${toRoot}${arg.slice(fromRoot.length)}`;
		});
		if (nextArgs.some((value, index) => value !== server.args[index])) {
			server.args = nextArgs;
			changed = true;
		}
	}
	if (changed) await writeFile(manifestPath, `${JSON.stringify(parsed, null, "\t")}\n`);
}

async function rewriteCachedPackageLocalFileDependencies(pluginRoot, sourceRoot) {
	const packageJsonPaths = [];
	await collectPackageJsonPaths(pluginRoot, pluginRoot, packageJsonPaths);
	for (const packageJsonPath of packageJsonPaths) {
		const raw = await readFile(packageJsonPath, "utf8");
		const parsed = JSON.parse(raw);
		if (!isRecord(parsed)) continue;
		const packageDir = dirname(packageJsonPath);
		const sourcePackageDir = join(sourceRoot, relative(pluginRoot, packageDir));
		let changed = false;
		for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
			const dependencies = parsed[field];
			if (!isRecord(dependencies)) continue;
			for (const [name, specifier] of Object.entries(dependencies)) {
				if (typeof specifier !== "string" || !specifier.startsWith("file:")) continue;
				const filePath = specifier.slice("file:".length);
				if (filePath.length === 0 || isAbsolute(filePath)) continue;
				const targetPath = resolve(packageDir, filePath);
				if (isPathInside(targetPath, pluginRoot)) continue;
				dependencies[name] = `file:${resolve(sourcePackageDir, filePath)}`;
				changed = true;
			}
		}
		if (changed) await writeFile(packageJsonPath, `${JSON.stringify(parsed, null, "\t")}\n`);
	}
}

async function collectPackageJsonPaths(directory, root, paths) {
	const entries = await readdir(directory, { withFileTypes: true });
	if (entries.some((entry) => entry.isFile() && entry.name === "package.json")) {
		paths.push(join(directory, "package.json"));
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
		const childPath = join(directory, entry.name);
		if (!childPath.startsWith(root)) continue;
		await collectPackageJsonPaths(childPath, root, paths);
	}
}

function isPathInside(candidatePath, rootPath) {
	const pathFromRoot = relative(rootPath, candidatePath);
	return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}
