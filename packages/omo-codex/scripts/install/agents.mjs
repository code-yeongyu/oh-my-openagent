import { basename, join } from "node:path";
import { copyFile, lstat, mkdir, readdir, symlink, writeFile } from "node:fs/promises";

import { exists } from "./utils.mjs";

const MANIFEST_FILE = ".installed-agents.json";

export async function linkCachedPluginAgents({ codexHome, pluginRoot, platform = process.platform }) {
	const bundledAgents = await discoverBundledAgents(pluginRoot);
	if (bundledAgents.length === 0) {
		await writeManifest(pluginRoot, []);
		return [];
	}

	const agentsDir = join(codexHome, "agents");
	await mkdir(agentsDir, { recursive: true });
	const linked = [];
	for (const agentPath of bundledAgents) {
		const linkPath = join(agentsDir, basename(agentPath));
		const installed = platform === "win32"
			? await copyIfMissing(linkPath, agentPath)
			: await symlinkIfMissing(linkPath, agentPath);
		linked.push({ name: basename(agentPath), path: linkPath, target: installed.target, managed: installed.managed });
	}
	await writeManifest(pluginRoot, linked.filter((entry) => entry.managed).map((entry) => entry.path));
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

async function symlinkIfMissing(linkPath, target) {
	if (await existingAgentFile(linkPath)) return { target: linkPath, managed: false };
	await symlink(target, linkPath);
	return { target, managed: true };
}

async function copyIfMissing(linkPath, target) {
	if (await existingAgentFile(linkPath)) return { target: linkPath, managed: false };
	await copyFile(target, linkPath);
	return { target, managed: true };
}

async function existingAgentFile(linkPath) {
	if (!(await lstatExists(linkPath))) return false;
	const entryStat = await lstat(linkPath);
	if (entryStat.isDirectory() && !entryStat.isSymbolicLink()) {
		throw new Error(`${linkPath} already exists and is a directory; refusing to replace`);
	}
	return true;
}

async function writeManifest(pluginRoot, agentPaths) {
	const manifestPath = join(pluginRoot, MANIFEST_FILE);
	const payload = { agents: [...agentPaths].sort() };
	await writeFile(manifestPath, `${JSON.stringify(payload, null, "\t")}\n`);
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
