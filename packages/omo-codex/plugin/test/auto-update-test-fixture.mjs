import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function autoUpdateEnv(root, extra = {}) {
	return {
		CODEX_HOME: join(root, "codex-home"),
		LAZYCODEX_CURRENT_VERSION: "1.0.0",
		LAZYCODEX_LATEST_VERSION: "1.0.1",
		LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json"),
		LAZYCODEX_AUTO_UPDATE_STATE_PATH: join(root, "state.json"),
		LAZYCODEX_AUTO_UPDATE_LOG_PATH: join(root, "auto-update.log"),
		...extra,
	};
}

export async function makeStorePluginRoot(prefix) {
	const root = await mkdtemp(join(tmpdir(), prefix));
	const pluginRoot = join(root, "store", "omo", "1.0.0");
	await mkdir(pluginRoot, { recursive: true });
	return { root, pluginRoot };
}

export function marketplaceCheckEnv(
	root,
	pluginRoot,
	spawnLogPath,
	extra = {},
) {
	return autoUpdateEnv(root, {
		PLUGIN_ROOT: pluginRoot,
		LAZYCODEX_CONFIG_MIGRATION_DISABLED: "1",
		LAZYCODEX_AUTO_UPDATE_INTERVAL_MS: "0",
		LAZYCODEX_AUTO_UPDATE_WAIT: "1",
		LAZYCODEX_AUTO_UPDATE_COMMAND: process.execPath,
		LAZYCODEX_AUTO_UPDATE_ARGS_JSON: JSON.stringify([
			"-e",
			`require("node:fs").writeFileSync(${JSON.stringify(spawnLogPath)}, "ok")`,
		]),
		...extra,
	});
}
