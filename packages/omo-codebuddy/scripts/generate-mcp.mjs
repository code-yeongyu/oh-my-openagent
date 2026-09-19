#!/usr/bin/env node
/**
 * Generates the plugin's `.mcp.json`.
 *
 * Remote servers (context7, grep_app) are always declared — they match the
 * built-in MCPs the other omo editions inject. Local stdio servers (`lsp`,
 * `ast-grep`) are declared ONLY when their runtime has been staged into
 * `plugin/runtime/`, because a declared-but-missing command makes CodeBuddy
 * report a broken server on every session start.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const pluginRoot = join(packageRoot, "plugin");
const targetFile = join(pluginRoot, ".mcp.json");
const runtimeDir = join(pluginRoot, "runtime");

export const REMOTE_SERVERS = {
	context7: { type: "remote", url: "https://mcp.context7.com/mcp" },
	grep_app: { type: "remote", url: "https://mcp.grep.app" },
};

export function buildMcpConfig({ hasLsp = false, hasAstGrep = false } = {}) {
	const servers = { ...REMOTE_SERVERS };
	if (hasLsp) {
		servers.lsp = {
			command: "node",
			args: ["${CODEBUDDY_PLUGIN_ROOT}/runtime/lsp-daemon/cli.js", "mcp"],
		};
	}
	if (hasAstGrep) {
		servers.ast_grep = {
			command: "node",
			args: ["${CODEBUDDY_PLUGIN_ROOT}/runtime/ast-grep-mcp/cli.js", "mcp"],
		};
	}
	return { mcpServers: servers };
}

export async function generateMcp({ check = false } = {}) {
	const config = buildMcpConfig({
		hasLsp: existsSync(join(runtimeDir, "lsp-daemon", "cli.js")),
		hasAstGrep: existsSync(join(runtimeDir, "ast-grep-mcp", "cli.js")),
	});
	const serialized = `${JSON.stringify(config, null, 2)}\n`;

	if (check) {
		let actual = null;
		try {
			actual = await readFile(targetFile, "utf8");
		} catch {
			throw new Error(".mcp.json is missing");
		}
		if (actual !== serialized) throw new Error(".mcp.json is stale");
		return config;
	}

	await rm(targetFile, { force: true });
	await mkdir(pluginRoot, { recursive: true });
	await writeFile(targetFile, serialized, "utf8");
	return config;
}

if (import.meta.main) {
	const check = process.argv.includes("--check");
	const config = await generateMcp({ check });
	const names = Object.keys(config.mcpServers);
	console.log(check ? `mcp check passed (${names.join(", ")})` : `generated .mcp.json (${names.join(", ")})`);
}
