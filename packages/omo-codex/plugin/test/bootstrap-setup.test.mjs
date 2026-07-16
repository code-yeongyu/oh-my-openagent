import assert from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const PERMISSIONS_KEY_PATTERN = /approval_policy|sandbox_mode|network_access/;

import {
	BUNDLED_EXPLORER_TOML,
	BUNDLED_METIS_TOML,
	MARKETPLACE_SOURCE_LINE,
	readConfig,
	runWorkerSetup,
	setupOptions,
	withSetupFixture,
} from "./bootstrap-setup-fixture.mjs";

test("#given a marketplace-flow CODEX_HOME #when the worker setup runs #then config gains plugin, hook-state, and agent blocks without permissions keys", async () => {
	await withSetupFixture(async (fixture) => {
		const outcome = await runWorkerSetup(setupOptions(fixture));

		assert.deepEqual(outcome.degraded, []);
		const config = await readConfig(fixture);
		assert.match(config, /\[plugins\."omo@sisyphuslabs"\]\nenabled = true/);
		assert.match(
			config,
			/\[plugins\."omo@sisyphuslabs"\.mcp_servers\.context7\]\nenabled = true/,
		);
		assert.match(
			config,
			/\[plugins\."omo@sisyphuslabs"\.mcp_servers\.git_bash\]\nenabled = false/,
		);
		assert.match(
			config,
			/\[hooks\.state\."omo@sisyphuslabs:hooks\/hooks\.json:session_start:0:0"\]\ntrusted_hash = "sha256:[0-9a-f]{64}"/,
		);
		assert.match(
			config,
			/\[agents\.explorer\]\nconfig_file = "\.\/agents\/explorer\.toml"/,
		);
		assert.match(
			config,
			/\[agents\.metis\]\nconfig_file = "\.\/agents\/metis\.toml"/,
		);
		assert.doesNotMatch(config, PERMISSIONS_KEY_PATTERN);
		assert.equal(
			await readFile(
				join(fixture.codexHome, "agents", "explorer.toml"),
				"utf8",
			),
			BUNDLED_EXPLORER_TOML,
		);
		assert.equal(
			await readFile(join(fixture.codexHome, "agents", "metis.toml"), "utf8"),
			BUNDLED_METIS_TOML,
		);
	});
});

test("#given an existing git marketplace source #when the worker setup runs #then the [marketplaces.sisyphuslabs] block stays byte-identical", async () => {
	await withSetupFixture(async (fixture) => {
		await runWorkerSetup(setupOptions(fixture));

		const config = await readConfig(fixture);
		assert.ok(
			config.includes(
				`[marketplaces.sisyphuslabs]\n${MARKETPLACE_SOURCE_LINE}`,
			),
			"git source line must stay verbatim",
		);
		assert.doesNotMatch(config, /source_type/);
		assert.doesNotMatch(config, /last_updated/);
	});
});

test("#given a completed first run #when the worker setup runs again #then config.toml is byte-identical (idempotent)", async () => {
	await withSetupFixture(async (fixture) => {
		await runWorkerSetup(setupOptions(fixture));
		const firstRun = await readConfig(fixture);

		const outcome = await runWorkerSetup(setupOptions(fixture));

		assert.deepEqual(outcome.degraded, []);
		assert.equal(await readConfig(fixture), firstRun);
	});
});

test("#given a package-relative CodeGraph MCP path #when worker setup runs #then the path is stamped absolute", async () => {
	await withSetupFixture(async (fixture) => {
		await writeFile(
			join(fixture.pluginRoot, ".mcp.json"),
			`${JSON.stringify(
				{
					mcpServers: {
						codegraph: {
							args: ["components/codegraph/dist/serve.js"],
							command: "node",
							cwd: ".",
							required: false,
						},
						git_bash: { args: ["serve"], command: "node", env: {} },
					},
				},
				null,
				"\t",
			)}\n`,
		);

		await runWorkerSetup(setupOptions(fixture));

		const manifest = JSON.parse(
			await readFile(join(fixture.pluginRoot, ".mcp.json"), "utf8"),
		);
		assert.deepEqual(manifest.mcpServers.codegraph.args, [
			join(fixture.pluginRoot, "components", "codegraph", "dist", "serve.js"),
		]);
		assert.equal(manifest.mcpServers.codegraph.cwd, ".");
	});
});

test("#given bootstrap-managed staging #when agents are linked #then nothing is persisted under PLUGIN_ROOT", async () => {
	await withSetupFixture(async (fixture) => {
		await runWorkerSetup(setupOptions(fixture));

		await assert.rejects(() =>
			stat(join(fixture.pluginRoot, ".installed-agents.json")),
		);
		const manifest = JSON.parse(
			await readFile(
				join(
					fixture.pluginData,
					"bootstrap",
					"agents-stage",
					".installed-agents.json",
				),
				"utf8",
			),
		);
		assert.equal(manifest.agents.length, 2);
	});
});

test("#given user-tuned reasoning and service tier on an installed agent #when agents are re-linked #then both are preserved", async () => {
	await withSetupFixture(async (fixture) => {
		await mkdir(join(fixture.codexHome, "agents"), { recursive: true });
		await writeFile(
			join(fixture.codexHome, "agents", "explorer.toml"),
			'description = "Explorer agent"\nmodel_reasoning_effort = "low"\nservice_tier = "flex"\n',
		);

		await runWorkerSetup(setupOptions(fixture));

		const linked = await readFile(
			join(fixture.codexHome, "agents", "explorer.toml"),
			"utf8",
		);
		assert.match(linked, /model_reasoning_effort = "low"/);
		assert.match(linked, /service_tier = "flex"/);
	});
});

test("#given project config without a root model #when the worker setup runs #then Codex keeps root model inheritance", async () => {
	await withSetupFixture(async (fixture) => {
		await runWorkerSetup(setupOptions(fixture));

		const config = await readConfig(fixture);
		assert.doesNotMatch(
			config,
			/^(?:model|model_context_window|model_reasoning_effort|plan_mode_reasoning_effort)\s*=/m,
		);
		assert.match(config, /^tool_namespace = "agents"$/m);
		assert.match(config, /^hide_spawn_agent_metadata = false$/m);
	});
});
