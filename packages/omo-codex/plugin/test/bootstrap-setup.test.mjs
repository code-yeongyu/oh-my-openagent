import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CLI_URL = new URL("../components/bootstrap/dist/cli.js", import.meta.url);
const { runBootstrapWorker, runWorkerSetup } = await import(CLI_URL.href);

const REPO_MODEL_CATALOG_PATH = fileURLToPath(new URL("../model-catalog.json", import.meta.url));
const MARKETPLACE_SOURCE_LINE = 'source = "https://github.com/code-yeongyu/lazycodex.git"';
const PERMISSIONS_KEY_PATTERN = /approval_policy|sandbox_mode|network_access/;
const PLUGIN_VERSION = "9.9.9";

const BUNDLED_EXPLORER_TOML = 'description = "Explorer agent"\nmodel_reasoning_effort = "medium"\n';
const BUNDLED_METIS_TOML = 'description = "Metis agent"\nmodel_reasoning_effort = "high"\n';

async function withSetupFixture(run) {
	const root = await mkdtemp(join(tmpdir(), "omo-bootstrap-setup-"));
	try {
		const pluginRoot = join(root, "plugin");
		const pluginData = join(root, "plugin-data");
		const codexHome = join(root, "codex-home");
		await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true });
		await mkdir(join(pluginRoot, "hooks"), { recursive: true });
		await mkdir(join(pluginRoot, "components", "ultrawork", "agents"), { recursive: true });
		// A complete npx-style payload ships dist/cli; the marketplace-payload
		// (no dist/cli -> degraded omo-cli) path is covered by
		// bootstrap-binlinks.test.mjs.
		await mkdir(join(pluginRoot, "dist", "cli"), { recursive: true });
		await writeFile(join(pluginRoot, "dist", "cli", "index.js"), "");
		await mkdir(pluginData, { recursive: true });
		await mkdir(codexHome, { recursive: true });
		await writeFile(
			join(pluginRoot, ".codex-plugin", "plugin.json"),
			`${JSON.stringify({ hooks: "./hooks/hooks.json", name: "omo", version: PLUGIN_VERSION })}\n`,
		);
		await writeFile(
			join(pluginRoot, "hooks", "hooks.json"),
			`${JSON.stringify({
				hooks: {
					SessionStart: [
						{
							hooks: [
								{
									command: 'node "${PLUGIN_ROOT}/components/bootstrap/dist/cli.js" hook session-start',
									statusMessage: "LazyCodex(9.9.9): Checking Bootstrap Provisioning",
									timeout: 30,
									type: "command",
								},
							],
						},
					],
				},
			})}\n`,
		);
		await writeFile(
			join(pluginRoot, ".mcp.json"),
			`${JSON.stringify({ mcpServers: { git_bash: { args: ["serve"], command: "node", env: {} } } }, null, "\t")}\n`,
		);
		await writeFile(join(pluginRoot, "components", "ultrawork", "agents", "explorer.toml"), BUNDLED_EXPLORER_TOML);
		await writeFile(join(pluginRoot, "components", "ultrawork", "agents", "metis.toml"), BUNDLED_METIS_TOML);
		await writeFile(join(codexHome, "config.toml"), `[marketplaces.sisyphuslabs]\n${MARKETPLACE_SOURCE_LINE}\n`);
		await run({ codexHome, pluginData, pluginRoot, root });
	} finally {
		await rm(root, { force: true, recursive: true });
	}
}

function setupOptions(fixture, overrides = {}) {
	return {
		codexHome: fixture.codexHome,
		env: {},
		platform: "darwin",
		pluginData: fixture.pluginData,
		pluginRoot: fixture.pluginRoot,
		...overrides,
	};
}

async function readConfig(fixture) {
	return readFile(join(fixture.codexHome, "config.toml"), "utf8");
}

test("#given a marketplace-flow CODEX_HOME #when the worker setup runs #then config gains plugin, hook-state, and agent blocks without permissions keys", async () => {
	await withSetupFixture(async (fixture) => {
		const outcome = await runWorkerSetup(setupOptions(fixture));

		assert.deepEqual(outcome.degraded, []);
		const config = await readConfig(fixture);
		assert.match(config, /\[plugins\."omo@sisyphuslabs"\]\nenabled = true/);
		assert.match(config, /\[plugins\."omo@sisyphuslabs"\.mcp_servers\.context7\]\nenabled = true/);
		assert.match(config, /\[plugins\."omo@sisyphuslabs"\.mcp_servers\.git_bash\]\nenabled = false/);
		assert.match(
			config,
			/\[hooks\.state\."omo@sisyphuslabs:hooks\/hooks\.json:session_start:0:0"\]\ntrusted_hash = "sha256:[0-9a-f]{64}"/,
		);
		assert.match(config, /\[agents\.explorer\]\nconfig_file = "\.\/agents\/explorer\.toml"/);
		assert.match(config, /\[agents\.metis\]\nconfig_file = "\.\/agents\/metis\.toml"/);
		assert.doesNotMatch(config, PERMISSIONS_KEY_PATTERN);
		assert.equal(await readFile(join(fixture.codexHome, "agents", "explorer.toml"), "utf8"), BUNDLED_EXPLORER_TOML);
		assert.equal(await readFile(join(fixture.codexHome, "agents", "metis.toml"), "utf8"), BUNDLED_METIS_TOML);
	});
});

test("#given an existing git marketplace source #when the worker setup runs #then the [marketplaces.sisyphuslabs] block stays byte-identical", async () => {
	await withSetupFixture(async (fixture) => {
		await runWorkerSetup(setupOptions(fixture));

		const config = await readConfig(fixture);
		assert.ok(config.includes(`[marketplaces.sisyphuslabs]\n${MARKETPLACE_SOURCE_LINE}`), "git source line must stay verbatim");
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

test("#given a config.toml that already declares [agents.explorer] at a different path (Orca mirror) #when the worker setup runs #then no second colliding registration is added for that role", async () => {
	await withSetupFixture(async (fixture) => {
		const orcaMirrorPath = "/orca-mirrored-home/.codex/agents/explorer.toml";
		await writeFile(
			join(fixture.codexHome, "config.toml"),
			`[marketplaces.sisyphuslabs]\n${MARKETPLACE_SOURCE_LINE}\n\n[agents.explorer]\nconfig_file = "${orcaMirrorPath}"\n`,
		);

		const outcome = await runWorkerSetup(setupOptions(fixture));

		assert.deepEqual(outcome.degraded, []);
		const config = await readConfig(fixture);
		assert.equal(config.match(/\[agents\.explorer\]/g)?.length, 1, "exactly one [agents.explorer] block");
		assert.ok(
			config.includes(`[agents.explorer]\nconfig_file = "${orcaMirrorPath}"`),
			"the pre-existing mirrored entry stays untouched",
		);
		assert.ok(
			!config.includes('config_file = "./agents/explorer.toml"'),
			"no colliding ./agents registration for the mirrored role",
		);
		assert.match(config, /\[agents\.metis\]\nconfig_file = "\.\/agents\/metis\.toml"/);
		assert.equal(
			await readFile(join(fixture.codexHome, "agents", "explorer.toml"), "utf8"),
			BUNDLED_EXPLORER_TOML,
			"the linked toml is still staged for Codex directory discovery",
		);
	});
});

test("#given a config.toml with no pre-existing agent entries #when the worker setup runs #then all bundled registrations are written", async () => {
	await withSetupFixture(async (fixture) => {
		const outcome = await runWorkerSetup(setupOptions(fixture));

		assert.deepEqual(outcome.degraded, []);
		const config = await readConfig(fixture);
		assert.match(config, /\[agents\.explorer\]\nconfig_file = "\.\/agents\/explorer\.toml"/);
		assert.match(config, /\[agents\.metis\]\nconfig_file = "\.\/agents\/metis\.toml"/);
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

		const manifest = JSON.parse(await readFile(join(fixture.pluginRoot, ".mcp.json"), "utf8"));
		assert.deepEqual(manifest.mcpServers.codegraph.args, [
			join(fixture.pluginRoot, "components", "codegraph", "dist", "serve.js"),
		]);
		assert.equal(manifest.mcpServers.codegraph.cwd, ".");
	});
});

test("#given bootstrap-managed staging #when agents are linked #then nothing is persisted under PLUGIN_ROOT", async () => {
	await withSetupFixture(async (fixture) => {
		await runWorkerSetup(setupOptions(fixture));

		await assert.rejects(() => stat(join(fixture.pluginRoot, ".installed-agents.json")));
		const manifest = JSON.parse(
			await readFile(join(fixture.pluginData, "bootstrap", "agents-stage", ".installed-agents.json"), "utf8"),
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

		const linked = await readFile(join(fixture.codexHome, "agents", "explorer.toml"), "utf8");
		assert.match(linked, /model_reasoning_effort = "low"/);
		assert.match(linked, /service_tier = "flex"/);
	});
});

test("#given an unwritable config.toml #when the worker setup runs #then it degrades naming config.toml and leaves the file untouched", async () => {
	await withSetupFixture(async (fixture) => {
		const configPath = join(fixture.codexHome, "config.toml");
		const before = await readFile(configPath, "utf8");
		await chmod(configPath, 0o444);
		try {
			const outcome = await runWorkerSetup(setupOptions(fixture));

			const configEntries = outcome.degraded.filter((entry) => entry.component === "config");
			assert.equal(configEntries.length, 1);
			assert.match(configEntries[0].reason, /config\.toml/);
			assert.equal(await readFile(configPath, "utf8"), before);
			assert.equal((await stat(configPath)).mode & 0o777, 0o444);
		} finally {
			await chmod(configPath, 0o644);
		}
	});
});

test("#given win32 without Git Bash #when the worker setup runs #then it degrades instead of throwing and disables the git_bash MCP", async () => {
	await withSetupFixture(async (fixture) => {
		const outcome = await runWorkerSetup(
			setupOptions(fixture, {
				platform: "win32",
				resolveGitBash: () => ({ checkedPaths: [], found: false, installHint: "install git bash" }),
			}),
		);

		const gitBashEntries = outcome.degraded.filter((entry) => entry.component === "git-bash");
		assert.equal(gitBashEntries.length, 1);
		const config = await readConfig(fixture);
		assert.match(config, /\[plugins\."omo@sisyphuslabs"\.mcp_servers\.git_bash\]\nenabled = false/);
		assert.match(config, /\[plugins\."omo@sisyphuslabs"\]\nenabled = true/, "setup must continue past a missing Git Bash");
	});
});

test("#given win32 with Git Bash and OMO_CODEX_GIT_BASH_PATH #when the worker setup runs #then git_bash is enabled and the MCP env is stamped", async () => {
	await withSetupFixture(async (fixture) => {
		const bashPath = "C:\\Tools\\Git\\bin\\bash.exe";
		const outcome = await runWorkerSetup(
			setupOptions(fixture, {
				env: { OMO_CODEX_GIT_BASH_PATH: bashPath },
				platform: "win32",
				resolveGitBash: () => ({ checkedPaths: [bashPath], found: true, path: bashPath, source: "env" }),
			}),
		);

		assert.deepEqual(outcome.degraded, []);
		const config = await readConfig(fixture);
		assert.match(config, /\[plugins\."omo@sisyphuslabs"\.mcp_servers\.git_bash\]\nenabled = true/);
		const manifest = JSON.parse(await readFile(join(fixture.pluginRoot, ".mcp.json"), "utf8"));
		assert.equal(manifest.mcpServers.git_bash.env.OMO_CODEX_GIT_BASH_PATH, bashPath);
	});
});

test("#given the shipped plugin model catalog #when the worker setup stamps reasoning config #then the bundled fallback has not drifted from it", async () => {
	await withSetupFixture(async (fixture) => {
		const catalog = JSON.parse(await readFile(REPO_MODEL_CATALOG_PATH, "utf8"));

		await runWorkerSetup(setupOptions(fixture));

		const config = await readConfig(fixture);
		assert.ok(config.includes(`model = ${JSON.stringify(catalog.current.model)}`));
		assert.ok(config.includes(`model_context_window = ${catalog.current.model_context_window}`));
		assert.ok(config.includes(`model_reasoning_effort = ${JSON.stringify(catalog.current.model_reasoning_effort)}`));
		assert.ok(config.includes(`plan_mode_reasoning_effort = ${JSON.stringify(catalog.current.plan_mode_reasoning_effort)}`));
	});
});

test("#given the default worker step list #when the worker runs end to end #then the setup step updates config and records a success marker", async () => {
	await withSetupFixture(async (fixture) => {
		const result = await runBootstrapWorker({
			argv: ["--codex-home", fixture.codexHome, "--only", "setup"],
			env: { PLUGIN_DATA: fixture.pluginData, PLUGIN_ROOT: fixture.pluginRoot },
		});

		assert.equal(result.ran, true);
		assert.equal(result.status, "success");
		const state = JSON.parse(await readFile(join(fixture.pluginData, "bootstrap", "state.json"), "utf8"));
		assert.equal(state.completedForVersion, PLUGIN_VERSION);
		assert.equal(state.lastStatus, "success");
		const config = await readConfig(fixture);
		assert.match(config, /\[plugins\."omo@sisyphuslabs"\]\nenabled = true/);
		assert.ok(config.includes(`[marketplaces.sisyphuslabs]\n${MARKETPLACE_SOURCE_LINE}`));
	});
});
