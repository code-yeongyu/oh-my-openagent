import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { cp, lstat, mkdir, readFile, readdir, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";

import { createCachedMcpRuntimeArgRewriter } from "./mcp-runtime-cache.mjs";
import { exists, isRecord } from "./utils.mjs";
import { COMMAND_SHIM_MARKER } from "./command-shim.mjs";
import { removeLegacyCodexComponentBins } from "./legacy-bins.mjs";

export async function installCachedPlugin({ codexHome, marketplaceName, name, runCommand, sourcePath, version }) {
	await maybeRunNpmInstall(sourcePath, runCommand);
	await maybeRunNpmBuild(sourcePath, runCommand);

	const targetPath = join(codexHome, "plugins", "cache", marketplaceName, name, version);
	await replaceDirectory(sourcePath, targetPath, shouldCopyPluginPath);
	await rewriteCachedPackageLocalFileDependencies(targetPath, sourcePath);
	await maybeRunNpmInstall(targetPath, runCommand, ["install", "--omit=dev"]);
	await rewriteCachedMcpManifest(targetPath, sourcePath);
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

export async function linkCachedPluginBins({ binDir, pluginRoot, platform = process.platform }) {
	const binLinks = await discoverPackageBins(pluginRoot);
	await mkdir(binDir, { recursive: true });
	await removeLegacyCodexComponentBins(binDir, platform);
	const linked = [];
	for (const link of binLinks) {
		const linkPath = await linkCachedPluginBin(binDir, link, platform);
		linked.push({ name: link.name, path: linkPath, target: link.target });
	}
	return linked;
}

async function linkCachedPluginBin(binDir, link, platform) {
	if (platform === "win32") {
		const linkPath = join(binDir, `${link.name}.cmd`);
		await replaceCommandShim(linkPath, link.target);
		return linkPath;
	}

	const linkPath = join(binDir, link.name);
	await replaceSymlink(linkPath, link.target);
	return linkPath;
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

async function replaceDirectory(sourcePath, targetPath, filter) {
	await mkdir(dirname(targetPath), { recursive: true });
	const tempPath = join(dirname(targetPath), `.tmp-${basename(targetPath)}-${process.pid}-${Date.now()}`);
	await rm(tempPath, { recursive: true, force: true });
	await cp(sourcePath, tempPath, {
		recursive: true,
		filter: (source) => filter(source, sourcePath),
	});
	await rm(targetPath, { recursive: true, force: true });
	await rename(tempPath, targetPath);
}

async function discoverPackageBins(root) {
	const links = [];
	await collectPackageBins(root, root, links);
	return links;
}

async function collectPackageBins(directory, root, links) {
	const entries = await readdir(directory, { withFileTypes: true });
	const packageJsonPath = join(directory, "package.json");
	if (entries.some((entry) => entry.isFile() && entry.name === "package.json")) {
		await appendPackageBinLinks(packageJsonPath, directory, links);
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
		const childPath = join(directory, entry.name);
		if (!childPath.startsWith(root)) continue;
		await collectPackageBins(childPath, root, links);
	}
}

async function appendPackageBinLinks(packageJsonPath, packageRoot, links) {
	const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
	if (!isRecord(packageJson)) return;
	const bin = packageJson.bin;
	if (typeof bin === "string" && typeof packageJson.name === "string") {
		links.push({ name: basename(packageJson.name), target: join(packageRoot, bin) });
		return;
	}
	if (!isRecord(bin)) return;
	for (const [name, target] of Object.entries(bin)) {
		if (typeof target !== "string") continue;
		links.push({ name, target: join(packageRoot, target) });
	}
}

async function replaceSymlink(linkPath, targetPath) {
	if (await existingNonSymlink(linkPath)) {
		throw new Error(`${linkPath} already exists and is not a symlink`);
	}
	await rm(linkPath, { force: true });
	await symlink(targetPath, linkPath);
}

async function replaceCommandShim(linkPath, targetPath) {
	if (await existingNonShim(linkPath)) {
		throw new Error(`${linkPath} already exists and is not a command shim`);
	}
	await writeFile(linkPath, `@echo off\r\n${COMMAND_SHIM_MARKER}\r\nnode "${targetPath}" %*\r\n`);
}

async function existingNonShim(path) {
	try {
		const stat = await lstat(path);
		if (!stat.isFile()) return true;
		const content = await readFile(path, "utf8");
		if (content.includes(COMMAND_SHIM_MARKER)) return false;
		throw new Error(`${path} already exists and is not a generated command shim`);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
}

async function existingNonSymlink(path) {
	try {
		const stat = await lstat(path);
		if (!stat.isSymbolicLink()) return true;
		await readlink(path);
		return false;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
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
