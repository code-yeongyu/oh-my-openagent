import { basename, join } from "node:path";
import { copyFile, lstat, mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";

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
		if (platform === "win32") {
			await replaceWithCopy(linkPath, agentPath);
		} else {
			await replaceWithSymlink(linkPath, agentPath);
		}
		linked.push({ name: basename(agentPath), path: linkPath, target: agentPath });
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

async function lstatExists(path) {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
}
