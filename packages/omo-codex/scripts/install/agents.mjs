import { basename, join } from "node:path";
import { copyFile, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";

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

export async function capturePreservedAgentServiceTier({ codexHome }) {
	const agentsDir = join(codexHome, "agents");
	if (!(await exists(agentsDir))) return new Map();

	const preserved = new Map();
	const agentEntries = await readdir(agentsDir, { withFileTypes: true });
	for (const entry of agentEntries) {
		if (!entry.name.endsWith(".toml")) continue;
		const content = await readTextIfExists(join(agentsDir, entry.name));
		if (content === null) continue;
		preserved.set(agentNameFromToml(entry.name), extractTopLevelStringSettingState(content, "service_tier"));
	}
	return preserved;
}

export async function linkCachedPluginAgents({ codexHome, pluginRoot, preservedReasoning = new Map(), preservedServiceTier = new Map() }) {
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
		await replaceWithCopy(linkPath, agentPath);
		await restorePreservedReasoning({ linkPath, target: agentPath, value: preservedReasoning.get(agentName) });
		await restorePreservedServiceTier({ linkPath, value: preservedServiceTier.get(agentName) });
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
	if (await lstatExists(linkPath)) {
		await rm(linkPath, { force: true });
	}
	await writeFile(linkPath, replacement.content);
}

async function restorePreservedServiceTier({ linkPath, value }) {
	if (value === undefined) return;
	const content = await readFile(linkPath, "utf8");
	const replacement = replaceTopLevelStringSetting(content, "service_tier", value);
	if (!replacement.changed) return;
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


function extractTopLevelStringSettingState(content, key) {
	for (const line of content.split(/\n/)) {
		if (isSectionHeader(line)) break;
		const match = line.match(new RegExp(`^\\s*${key}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")`));
		if (match === null) continue;
		return { present: true, value: JSON.parse(match[1]) };
	}
	return { present: false };
}

function replaceTopLevelStringSetting(content, key, state) {
	if (!state.present) return removeTopLevelSetting(content, key);
	return upsertTopLevelStringSetting(content, key, state.value);
}

function removeTopLevelSetting(content, key) {
	let changed = false;
	const lines = content.split(/\n/);
	const kept = [];
	for (const line of lines) {
		if (!changed && !isSectionHeader(line) && new RegExp(`^\\s*${key}\\s*=`).test(line)) {
			changed = true;
			continue;
		}
		kept.push(line);
	}
	return { content: kept.join("\n"), changed };
}

function upsertTopLevelStringSetting(content, key, value) {
	const lines = content.split(/\n/);
	const replacement = `${key} = ${JSON.stringify(value)}`;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (isSectionHeader(line)) break;
		if (!new RegExp(`^\\s*${key}\\s*=`).test(line)) continue;
		if (line === replacement) return { content, changed: false };
		lines[index] = replacement;
		return { content: lines.join("\n"), changed: true };
	}
	for (let index = 0; index < lines.length; index += 1) {
		if (!isSectionHeader(lines[index])) continue;
		lines.splice(index, 0, replacement);
		return { content: lines.join("\n"), changed: true };
	}
	lines.splice(Math.max(0, lines.length - 1), 0, replacement);
	return { content: lines.join("\n"), changed: true };
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
