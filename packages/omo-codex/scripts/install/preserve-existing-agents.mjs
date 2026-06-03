import { lstat, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { exists } from "./utils.mjs";

export async function materializeExistingCodexAgentFiles(codexHome) {
	const agentsDir = join(codexHome, "agents");
	if (!(await exists(agentsDir))) return [];

	const materialized = [];
	const entries = await readdir(agentsDir, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.name.endsWith(".toml")) continue;
		const agentPath = join(agentsDir, entry.name);
		const stat = await lstat(agentPath);
		if (!stat.isSymbolicLink()) continue;

		const content = await readExistingSymlinkContent(agentPath);
		await rm(agentPath, { force: true });
		if (content === null) continue;

		await writeFile(agentPath, content);
		materialized.push(agentPath);
	}
	return materialized.sort();
}

async function readExistingSymlinkContent(path) {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
		throw error;
	}
}
