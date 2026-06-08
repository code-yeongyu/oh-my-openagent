import { chmod, lstat, mkdir, readFile, readdir, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

import { COMMAND_SHIM_MARKER } from "./command-shim.mjs";
import { removeLegacyCodexComponentBins } from "./legacy-bins.mjs";

const RESERVED_NESTED_BIN_NAMES = new Set(["omo", "lazycodex", "lazycodex-ai", "oh-my-opencode", "oh-my-openagent"]);
const RUNTIME_WRAPPER_MARKER = "OMO_GENERATED_RUNTIME_WRAPPER";

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
		if (!isPathInside(childPath, root)) continue;
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
			links.push(createPackageBinLink(name, bin, packageRoot));
		}
		return;
	}
	if (!isRecord(bin)) return;
	for (const [name, target] of Object.entries(bin)) {
		if (typeof target !== "string") continue;
		if (isReservedNestedBinName(name, packageRoot, root)) continue;
		links.push(createPackageBinLink(name, target, packageRoot));
	}
}

function createPackageBinLink(name, target, packageRoot) {
	assertSafeBinName(name);
	if (target.includes("\0")) {
		throw new Error(`package bin target for ${name} contains a NUL byte`);
	}
	const resolvedTarget = resolve(packageRoot, target);
	if (!isPathInside(resolvedTarget, packageRoot)) {
		throw new Error(`package bin target for ${name} escapes package root`);
	}
	return { name, target: resolvedTarget };
}

function assertSafeBinName(name) {
	if (
		name.length === 0 ||
		name === "." ||
		name === ".." ||
		name.includes("\0") ||
		name.includes("/") ||
		name.includes("\\")
	) {
		throw new Error(`invalid package bin name: ${name}`);
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

function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPathInside(candidatePath, rootPath) {
	const pathFromRoot = relative(rootPath, candidatePath);
	return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !pathFromRoot.startsWith(`..\\`) && !isDriveRelative(pathFromRoot));
}

function isDriveRelative(path) {
	return /^[a-zA-Z]:/.test(path);
}
