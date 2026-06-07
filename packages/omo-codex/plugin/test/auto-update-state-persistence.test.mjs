import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runAutoUpdateCheck } from "../scripts/auto-update.mjs";

function autoUpdateEnv(root, extra = {}) {
	return {
		CODEX_HOME: join(root, "codex-home"),
		LAZYCODEX_CURRENT_VERSION: "1.0.1",
		LAZYCODEX_LATEST_VERSION: "1.0.1",
		LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json"),
		LAZYCODEX_AUTO_UPDATE_STATE_PATH: join(root, "state.json"),
		LAZYCODEX_AUTO_UPDATE_LOG_PATH: join(root, "auto-update.log"),
		...extra,
	};
}

test("#given lazycodex is up to date #when running check #then persists checked success state", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-auto-update-state-"));
	const env = autoUpdateEnv(root);

	const result = await runAutoUpdateCheck({
		env,
		now: 123_456,
	});

	assert.equal(result.started, false);
	assert.equal(result.reason, "up-to-date");
	assert.deepEqual(JSON.parse(await readFile(env.LAZYCODEX_AUTO_UPDATE_STATE_PATH, "utf8")), {
		lastCheckedAt: 123_456,
		lastStatus: "success",
	});
});
