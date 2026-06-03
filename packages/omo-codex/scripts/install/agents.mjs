import { basename, join } from "node:path";
import { copyFile, lstat, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";

import { exists } from "./utils.mjs";

const MANIFEST_FILE = ".installed-agents.json";


export async function capturePreservedAgentReasoning({ codexHome }) {
	const agentsDir = join(codexHome, "agents");
	if (!(await exists(agentsDir))) return new Map();

	const preserved = new Map();
	const agentEntries = await readdir(agentsDir, { withFileTypes: true });
	for (const entry of agentEntries) {
		if (!entry.name.endsWith(".toml")) continue;
		const content = await readTextIfExists(join(agentsDir, entry.name));
		if (content === null) continue;
		const effort = extractReasoningEffort(content);
		if (effort !== null) preserved.set(agentNameFromToml(entry.name), effort);
	}
	return preserved;
}

export async function linkCachedPluginAgents({ codexHome, pluginRoot, platform = process.platform, preservedReasoning = new Map() }) {
	const bundledAgents = await discoverBundledAgents(pluginRoot);
	if (bundledAgents.length === 0) {
		await writeManifest(pluginRoot, []);
		return [];
	}

	const agentsDir = join(codexHome, "agents");
	await mkdir(agentsDir, { recursive: true });
	const linked = [];
	for (const agentPath of bundledAgents) {
		const agentFileName = basename(agentPath);
		const agentName = agentNameFromToml(agentFileName);
		const linkPath = join(agentsDir, agentFileName);
		if (platform === "win32") {
			await replaceWithCopy(linkPath, agentPath);
		} else {
			await replaceWithSymlink(linkPath, agentPath);
		}
		await restorePreservedReasoning({ linkPath, target: agentPath, value: preservedReasoning.get(agentName) });
		linked.push({ name: agentFileName, path: linkPath, target: agentPath });
	}
	await writeManifest(pluginRoot, linked.map((entry) => entry.path));
	return linked;
}

async function discoverBundledAgents(pluginRoot) {
	const componentsRoot = join(pluginRoot, "components");
	if (!(await exists(componentsRoot))) return [];

	const componentEntries = await readdir(componentsRoot, { withFileTypes: true });
	const agents = [];
	for (const entry of componentEntries) {
		if (!entry.isDirectory()) continue;
		const agentsRoot = join(componentsRoot, entry.name, "agents");
		if (!(await exists(agentsRoot))) continue;
		const agentEntries = await readdir(agentsRoot, { withFileTypes: true });
		for (const file of agentEntries) {
			if (!file.isFile() || !file.name.endsWith(".toml")) continue;
			agents.push(join(agentsRoot, file.name));
		}
	}
	agents.sort();
	return agents;
}

async function replaceWithSymlink(linkPath, target) {
	await prepareReplacement(linkPath);
	await symlink(target, linkPath);
}

async function replaceWithCopy(linkPath, target) {
	await prepareReplacement(linkPath);
	await copyFile(target, linkPath);
}

async function prepareReplacement(linkPath) {
	if (!(await lstatExists(linkPath))) return;
	const entryStat = await lstat(linkPath);
	if (entryStat.isDirectory() && !entryStat.isSymbolicLink()) {
		throw new Error(`${linkPath} already exists and is a directory; refusing to replace`);
	}
	await rm(linkPath, { force: true });
}

async function writeManifest(pluginRoot, agentPaths) {
	const manifestPath = join(pluginRoot, MANIFEST_FILE);
	const payload = { agents: [...agentPaths].sort() };
	await writeFile(manifestPath, `${JSON.stringify(payload, null, "\t")}\n`);
}

async function restorePreservedReasoning({ linkPath, target, value }) {
	if (value === undefined) return;
	const content = await readFile(target, "utf8");
	if (extractReasoningEffort(content) === value) return;
	const replacement = replaceReasoningEffort(content, value);
	if (!replacement.replaced) return;
	await writeFile(linkPath, replacement.content);
}

async function readTextIfExists(path) {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (nodeErrorCode(error) === "ENOENT") return null;
		throw error;
	}
}

function extractReasoningEffort(content) {
	for (const line of content.split(/\n/)) {
		if (isSectionHeader(line)) return null;
		const match = line.match(/^\s*model_reasoning_effort\s*=\s*("(?:[^"\\]|\\.)*")/);
		if (match === null) continue;
		return JSON.parse(match[1]);
	}
	return null;
}

function replaceReasoningEffort(content, value) {
	let replaced = false;
	const lines = content.split(/\n/);
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (isSectionHeader(line)) break;
		if (!/^\s*model_reasoning_effort\s*=/.test(line)) continue;
		lines[index] = line.replace(/=\s*"(?:[^"\\]|\\.)*"/, `= ${JSON.stringify(value)}`);
		replaced = true;
		break;
	}
	return { content: lines.join("\n"), replaced };
}

function isSectionHeader(line) {
	const trimmed = line.trim();
	return trimmed.startsWith("[") && trimmed.endsWith("]");
}

function agentNameFromToml(fileName) {
	return fileName.endsWith(".toml") ? fileName.slice(0, -".toml".length) : fileName;
}

async function lstatExists(path) {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
}

function nodeErrorCode(error) {
	if (!(error instanceof Error) || !("code" in error)) return null;
	return typeof error.code === "string" ? error.code : null;
}
