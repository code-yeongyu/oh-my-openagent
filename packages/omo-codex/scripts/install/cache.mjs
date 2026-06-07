import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { chmod, cp, lstat, mkdir, readFile, readdir, readlink, rename, rm, stat, symlink, writeFile } from "node:fs/promises";

import { createCachedMcpRuntimeArgRewriter } from "./mcp-runtime-cache.mjs";
import { exists, isRecord } from "./utils.mjs";
import { COMMAND_SHIM_MARKER } from "./command-shim.mjs";
import { removeLegacyCodexComponentBins } from "./legacy-bins.mjs";

const RESERVED_NESTED_BIN_NAMES = new Set(["omo", "lazycodex", "lazycodex-ai", "oh-my-opencode", "oh-my-openagent"]);
const RUNTIME_WRAPPER_MARKER = "OMO_GENERATED_RUNTIME_WRAPPER";

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

export async function linkRootRuntimeBin({ binDir, codexHome, repoRoot, platform = process.platform }) {
	const cliPath = join(repoRoot, "dist", "cli", "index.js");
	if (!(await isFile(cliPath))) return null;

	await mkdir(binDir, { recursive: true });
	if (platform === "win32") {
		const linkPath = join(binDir, "omo.cmd");
		await replaceRuntimeWrapper(linkPath, windowsRuntimeWrapper(cliPath, codexHome, binDir));
		return { name: "omo", path: linkPath, target: cliPath };
	}

	const linkPath = join(binDir, "omo");
	await replaceRuntimeWrapper(linkPath, posixRuntimeWrapper(cliPath, codexHome, binDir));
	await chmod(linkPath, 0o755);
	return { name: "omo", path: linkPath, target: cliPath };
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

async function isFile(path) {
	try {
		return (await stat(path)).isFile();
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
		throw error;
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

async function discoverPackageBins(root) {
	const links = [];
	await collectPackageBins(root, root, links);
	return links;
}

async function collectPackageBins(directory, root, links) {
	const entries = await readdir(directory, { withFileTypes: true });
	const packageJsonPath = join(directory, "package.json");
	if (entries.some((entry) => entry.isFile() && entry.name === "package.json")) {
		await appendPackageBinLinks(packageJsonPath, directory, root, links);
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
		const childPath = join(directory, entry.name);
		if (!childPath.startsWith(root)) continue;
		await collectPackageBins(childPath, root, links);
	}
}

async function appendPackageBinLinks(packageJsonPath, packageRoot, root, links) {
	const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
	if (!isRecord(packageJson)) return;
	const bin = packageJson.bin;
	if (typeof bin === "string" && typeof packageJson.name === "string") {
		const name = basename(packageJson.name);
		if (!isReservedNestedBinName(name, packageRoot, root)) {
			links.push({ name, target: join(packageRoot, bin) });
		}
		return;
	}
	if (!isRecord(bin)) return;
	for (const [name, target] of Object.entries(bin)) {
		if (typeof target !== "string") continue;
		if (isReservedNestedBinName(name, packageRoot, root)) continue;
		links.push({ name, target: join(packageRoot, target) });
	}
}

function isReservedNestedBinName(name, packageRoot, root) {
	return packageRoot !== root && RESERVED_NESTED_BIN_NAMES.has(name);
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

async function replaceRuntimeWrapper(linkPath, content) {
	if (await existingNonRuntimeWrapper(linkPath)) {
		throw new Error(`${linkPath} already exists and is not a generated OMO runtime wrapper`);
	}
	await rm(linkPath, { force: true });
	await writeFile(linkPath, content);
}

async function existingNonRuntimeWrapper(path) {
	try {
		const stat = await lstat(path);
		if (stat.isSymbolicLink()) return false;
		if (!stat.isFile()) return true;
		const content = await readFile(path, "utf8");
		return !content.includes(RUNTIME_WRAPPER_MARKER);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
}

function posixRuntimeWrapper(cliPath, codexHome, binDir) {
	const ulwLoopBin = join(binDir, "omo-ulw-loop");
	return [
		"#!/bin/sh",
		`# ${RUNTIME_WRAPPER_MARKER}`,
		`export CODEX_HOME="\${CODEX_HOME:-${escapePosixDoubleQuoted(codexHome)}}"`,
		'export OMO_SPARKSHELL_APP_SERVER_SOCKET="${OMO_SPARKSHELL_APP_SERVER_SOCKET:-$CODEX_HOME/app-server-control/app-server-control.sock}"',
		'BUN_BINARY="${BUN_BINARY:-bun}"',
		'if [ "$1" = "ulw-loop" ] && [ -x "' + escapePosixDoubleQuoted(ulwLoopBin) + '" ]; then',
		"  shift",
		'  exec "' + escapePosixDoubleQuoted(ulwLoopBin) + '" "$@"',
		"fi",
		`exec "$BUN_BINARY" "${escapePosixDoubleQuoted(cliPath)}" "$@"`,
		"",
	].join("\n");
}

function windowsRuntimeWrapper(cliPath, codexHome, binDir) {
	const ulwLoopBin = join(binDir, "omo-ulw-loop.cmd");
	return [
		"@echo off",
		`rem ${RUNTIME_WRAPPER_MARKER}`,
		`if not defined CODEX_HOME set "CODEX_HOME=${codexHome}"`,
		'if not defined OMO_SPARKSHELL_APP_SERVER_SOCKET set "OMO_SPARKSHELL_APP_SERVER_SOCKET=%CODEX_HOME%\\app-server-control\\app-server-control.sock"',
		`if "%~1"=="ulw-loop" if exist "${ulwLoopBin}" (`,
		"  shift /1",
		`  "${ulwLoopBin}" %*`,
		"  exit /b %ERRORLEVEL%",
		")",
		`if defined BUN_BINARY ("%BUN_BINARY%" "${cliPath}" %*) else bun "${cliPath}" %*`,
		"",
	].join("\r\n");
}

function escapePosixDoubleQuoted(value) {
	return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("$", "\\$").replaceAll("`", "\\`");
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
