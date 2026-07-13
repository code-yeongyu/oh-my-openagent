import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
	MARKETPLACE_SOURCE_LINE,
	PLUGIN_VERSION,
	readConfig,
	runBootstrapWorker,
	withSetupFixture,
} from "./bootstrap-setup-fixture.mjs";

test("#given the default worker step list #when the worker runs end to end #then the setup step updates config and records a success marker", async () => {
	await withSetupFixture(async (fixture) => {
		const result = await runBootstrapWorker({
			argv: ["--codex-home", fixture.codexHome, "--only", "setup"],
			env: { PLUGIN_DATA: fixture.pluginData, PLUGIN_ROOT: fixture.pluginRoot },
		});

		assert.equal(result.ran, true);
		assert.equal(result.status, "success");
		const state = JSON.parse(
			await readFile(
				join(fixture.pluginData, "bootstrap", "state.json"),
				"utf8",
			),
		);
		assert.equal(state.completedForVersion, PLUGIN_VERSION);
		assert.equal(state.lastStatus, "success");
		const config = await readConfig(fixture);
		assert.match(config, /\[plugins\."omo@sisyphuslabs"\]\nenabled = true/);
		assert.ok(
			config.includes(
				`[marketplaces.sisyphuslabs]\n${MARKETPLACE_SOURCE_LINE}`,
			),
		);
	});
});
