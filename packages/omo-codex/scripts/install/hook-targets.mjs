import { readFile } from "node:fs/promises";
import { join, sep } from "node:path";

import { exists, isRecord } from "./utils.mjs";

const PLUGIN_ROOT_TARGET_PATTERN = /\$\{PLUGIN_ROOT\}\/([^"']+)/g;

export async function findMissingHookCommandTargets(pluginRoot) {
	const manifestPath = join(pluginRoot, "hooks", "hooks.json");
	if (!(await exists(manifestPath))) return [];

	const commands = [];
	collectCommands(JSON.parse(await readFile(manifestPath, "utf8")), commands);

	const missing = [];
	const seen = new Set();
	for (const command of commands) {
		for (const match of command.matchAll(PLUGIN_ROOT_TARGET_PATTERN)) {
			const target = join(pluginRoot, ...match[1].split("/"));
			if (seen.has(target)) continue;
			seen.add(target);
			if (!(await exists(target))) missing.push(target);
		}
	}
	return missing;
}

export async function assertHookCommandTargets(pluginRoot) {
	const missing = await findMissingHookCommandTargets(pluginRoot);
	if (missing.length === 0) return;
	const relativeMissing = missing.map((path) => path.split(`${pluginRoot}${sep}`).join("").split(sep).join("/"));
	throw new Error(
		`Plugin payload is missing ${missing.length} hook command target(s) referenced by hooks.json: ${relativeMissing.join(", ")}. ` +
			"The previous plugin cache was left untouched; this payload was not activated.",
	);
}

function collectCommands(value, commands) {
	if (Array.isArray(value)) {
		for (const entry of value) collectCommands(entry, commands);
		return;
	}
	if (!isRecord(value)) return;
	if (value.type === "command" && typeof value.command === "string") commands.push(value.command);
	for (const entry of Object.values(value)) collectCommands(entry, commands);
}
