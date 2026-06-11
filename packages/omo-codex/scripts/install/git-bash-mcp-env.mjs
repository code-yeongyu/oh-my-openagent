import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { exists, isRecord } from "./utils.mjs";

const GIT_BASH_ENV_KEY = "OMO_CODEX_GIT_BASH_PATH";

// Codex spawns plugin MCP servers with a restricted environment, so a user's
// OMO_CODEX_GIT_BASH_PATH never reaches the git_bash server unless the cached
// manifest forwards it explicitly.
export async function stampGitBashMcpEnv({ pluginRoot, env = process.env, platform = process.platform }) {
	if (platform !== "win32") return false;
	const override = typeof env[GIT_BASH_ENV_KEY] === "string" ? env[GIT_BASH_ENV_KEY].trim() : "";
	if (override === "") return false;

	const manifestPath = join(pluginRoot, ".mcp.json");
	if (!(await exists(manifestPath))) return false;
	const parsed = JSON.parse(await readFile(manifestPath, "utf8"));
	if (!isRecord(parsed) || !isRecord(parsed.mcpServers) || !isRecord(parsed.mcpServers.git_bash)) return false;

	const server = parsed.mcpServers.git_bash;
	const serverEnv = isRecord(server.env) ? server.env : {};
	if (serverEnv[GIT_BASH_ENV_KEY] === override) return false;

	server.env = { ...serverEnv, [GIT_BASH_ENV_KEY]: override };
	await writeFile(manifestPath, `${JSON.stringify(parsed, null, "\t")}\n`);
	return true;
}
