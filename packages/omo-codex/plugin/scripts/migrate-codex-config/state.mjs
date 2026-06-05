import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function resolveStatePath(env) {
	const explicitStatePath = env.LAZYCODEX_MODEL_CATALOG_STATE_PATH?.trim();
	if (explicitStatePath) return explicitStatePath;
	const dataRoot = env.PLUGIN_DATA?.trim() || join(homedir(), ".local", "share", "lazycodex");
	return join(dataRoot, "model-catalog-state.json");
}

export async function readState(statePath) {
	try {
		const parsed = JSON.parse(await readFile(statePath, "utf8"));
		return isRecord(parsed) ? parsed : {};
	} catch (error) {
		if (error instanceof Error) return {};
		throw error;
	}
}

export async function writeState(statePath, state) {
	await mkdir(dirname(statePath), { recursive: true });
	await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
