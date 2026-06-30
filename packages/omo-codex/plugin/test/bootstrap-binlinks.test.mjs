import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const CLI_URL = new URL("../components/bootstrap/dist/cli.js", import.meta.url);
const { runBootstrapWorker, runWorkerSetup } = await import(CLI_URL.href);

const MARKETPLACE_SOURCE_LINE = 'source = "https://github.com/code-yeongyu/lazycodex.git"';
const COMPONENT_BIN_NAME = "omo-toolbox";
const execFileAsync = promisify(execFile);
const OMO_CLI_DEGRADED_ENTRY = {
	component: "omo-cli",
	hint: "use npx lazycodex-ai for the omo CLI",
	reason: "marketplace payload has no dist/cli",
};

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function withBinLinkFixture(run) {
	const root = await mkdtemp(join(tmpdir(), "omo-bootstrap-binlinks-"));
	try {
		const binDir = join(root, "bin");
		const codexHome = join(root, "codex-home");
		const pluginData = join(root, "plugin-data");
		await mkdir(codexHome, { recursive: true });
		await mkdir(pluginData, { recursive: true });
		await writeFile(join(codexHome, "config.toml"), `[marketplaces.sisyphuslabs]\n${MARKETPLACE_SOURCE_LINE}\n`);
		await run({ binDir, codexHome, pluginData, root });
	} finally {
		await rm(root, { force: true, recursive: true });
	}
}

// Mirrors the Codex marketplace store layout: each plugin version is installed
// under its own root and old version dirs are deleted on upgrade
// (core-plugins store.rs), which is why stale bin links MUST be re-pointed.
async function writeVersionedRoot(root, version, { withRuntimeCli = false } = {}) {
	const pluginRoot = join(root, "store", "omo", version);
	await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true });
	await writeFile(
		join(pluginRoot, ".codex-plugin", "plugin.json"),
		`${JSON.stringify({ hooks: "./hooks/hooks.json", name: "omo", version })}\n`,
	);
	await mkdir(join(pluginRoot, "hooks"), { recursive: true });
	await writeFile(
		join(pluginRoot, "hooks", "hooks.json"),
		`${JSON.stringify({
			hooks: {
				SessionStart: [
					{
						hooks: [
							{
								command: 'node "${PLUGIN_ROOT}/components/bootstrap/dist/cli.js" hook session-start',
								statusMessage: "(OmO) Checking Bootstrap Provisioning",
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
	await mkdir(join(pluginRoot, "components", "ultrawork", "agents"), { recursive: true });
	await writeFile(
		join(pluginRoot, "components", "ultrawork", "agents", "explorer.toml"),
		'description = "Explorer agent"\nmodel_reasoning_effort = "medium"\n',
	);
	const componentRoot = join(pluginRoot, "components", "toolbox");
	await mkdir(join(componentRoot, "dist"), { recursive: true });
	await writeFile(
		join(componentRoot, "package.json"),
		`${JSON.stringify({ bin: { [COMPONENT_BIN_NAME]: "./dist/cli.js" }, name: "@sisyphuslabs/toolbox" })}\n`,
	);
	await writeFile(join(componentRoot, "dist", "cli.js"), "#!/usr/bin/env node\nconsole.log('toolbox');\n");
	if (withRuntimeCli) {
		await mkdir(join(pluginRoot, "dist", "cli"), { recursive: true });
		await writeFile(join(pluginRoot, "dist", "cli", "index.js"), "console.log('omo');\n");
		await mkdir(join(pluginRoot, "dist", "cli-node"), { recursive: true });
		await writeFile(join(pluginRoot, "dist", "cli-node", "index.js"), "console.log('omo node runtime');\n");
	}
	return pluginRoot;
}

function setupOptions(fixture, pluginRoot, overrides = {}) {
	return {
		codexHome: fixture.codexHome,
		env: { CODEX_LOCAL_BIN_DIR: fixture.binDir },
		platform: "darwin",
		pluginData: fixture.pluginData,
		pluginRoot,
		...overrides,
	};
}

async function symlinkTargets(binDir) {
	const targets = new Map();
	for (const name of await readdir(binDir)) {
		const linkPath = join(binDir, name);
		const stats = await lstat(linkPath);
		if (!stats.isSymbolicLink()) continue;
		targets.set(name, await readlink(linkPath));
	}
	return targets;
}

async function assertNoDanglingEntries(binDir) {
	for (const name of await readdir(binDir)) {
		// stat() follows symlinks, so a dangling link rejects here.
		await stat(join(binDir, name));
	}
}

async function assertComponentBinPointsTo(binDir, target, message) {
	if (process.platform !== "win32") {
		assert.equal(await readlink(join(binDir, COMPONENT_BIN_NAME)), target, message);
		return;
	}

	const shim = await readFile(join(binDir, `${COMPONENT_BIN_NAME}.cmd`), "utf8");
	assert.ok(shim.includes(target), message);
	await assert.rejects(() => lstat(join(binDir, COMPONENT_BIN_NAME)), "win32 must not leave a posix component link behind");
}

test("#given two versioned plugin roots #when the worker setup runs against each in turn #then bin links re-point to the new root and none resolve under the old", async () => {
	await withBinLinkFixture(async (fixture) => {
		const rootV1 = await writeVersionedRoot(fixture.root, "1.0.0");
		const rootV2 = await writeVersionedRoot(fixture.root, "2.0.0");

		await runWorkerSetup(setupOptions(fixture, rootV1));
		assert.equal(
			await readlink(join(fixture.binDir, COMPONENT_BIN_NAME)),
			join(rootV1, "components", "toolbox", "dist", "cli.js"),
			"CODEX_LOCAL_BIN_DIR must receive the v1 component bin link",
		);

		await runWorkerSetup(setupOptions(fixture, rootV2));

		const targets = await symlinkTargets(fixture.binDir);
		assert.equal(targets.get(COMPONENT_BIN_NAME), join(rootV2, "components", "toolbox", "dist", "cli.js"));
		for (const [name, target] of targets) {
			assert.ok(!target.startsWith(`${rootV1}${sep}`), `${name} still resolves under the old versioned root: ${target}`);
		}
		await assertNoDanglingEntries(fixture.binDir);
	});
});

test("#given a completed v1 marker #when the worker runs against a v2 root #then the version change re-runs setup and re-points stale links", async () => {
	await withBinLinkFixture(async (fixture) => {
		const rootV1 = await writeVersionedRoot(fixture.root, "1.0.0");
		const rootV2 = await writeVersionedRoot(fixture.root, "2.0.0");
		const workerEnv = (pluginRoot) => ({
			CODEX_LOCAL_BIN_DIR: fixture.binDir,
			PLUGIN_DATA: fixture.pluginData,
			PLUGIN_ROOT: pluginRoot,
		});
		const argv = ["--codex-home", fixture.codexHome, "--only", "setup"];

		const firstRun = await runBootstrapWorker({ argv, env: workerEnv(rootV1), platform: process.platform });
		assert.equal(firstRun.ran, true);

		const repeatRun = await runBootstrapWorker({ argv, env: workerEnv(rootV1), platform: process.platform });
		assert.deepEqual(repeatRun, { ran: false, reason: "already-completed" });
		await assertComponentBinPointsTo(
			fixture.binDir,
			join(rootV1, "components", "toolbox", "dist", "cli.js"),
			"a same-version skip must leave the existing links untouched",
		);

		const upgradeRun = await runBootstrapWorker({ argv, env: workerEnv(rootV2), platform: process.platform });
		assert.equal(upgradeRun.ran, true, "a changed completedForVersion marker must re-run the worker");
		await assertComponentBinPointsTo(
			fixture.binDir,
			join(rootV2, "components", "toolbox", "dist", "cli.js"),
			"a version change must re-point component bins to the new plugin root",
		);
		const state = JSON.parse(await readFile(join(fixture.pluginData, "bootstrap", "state.json"), "utf8"));
		assert.equal(state.completedForVersion, "2.0.0");
	});
});

test("#given platform win32 #when the worker setup links bins #then component bins become .cmd shims and the omo wrapper is omo.cmd", async () => {
	await withBinLinkFixture(async (fixture) => {
		const bashPath = "C:\\Tools\\Git\\bin\\bash.exe";
		const pluginRoot = await writeVersionedRoot(fixture.root, "1.0.0", { withRuntimeCli: true });

		const outcome = await runWorkerSetup(
			setupOptions(fixture, pluginRoot, {
				env: { CODEX_LOCAL_BIN_DIR: fixture.binDir, OMO_CODEX_GIT_BASH_PATH: bashPath },
				platform: "win32",
				resolveGitBash: () => ({ checkedPaths: [bashPath], found: true, path: bashPath, source: "env" }),
			}),
		);

		assert.deepEqual(outcome.degraded, []);
		const shim = await readFile(join(fixture.binDir, `${COMPONENT_BIN_NAME}.cmd`), "utf8");
		assert.match(shim, /@echo off/);
		const componentEntrypoint = join(pluginRoot, "components", "toolbox", "dist", "cli.js");
		assert.match(shim, /NODE_REPL_NODE_PATH/);
		assert.match(shim, /"%OMO_NODE_BINARY%"/);
		assert.match(shim, new RegExp(`"${escapeRegExp(componentEntrypoint)}" %\\*`));
		assert.doesNotMatch(shim, new RegExp(`node "${escapeRegExp(componentEntrypoint)}" %\\*`));
		const wrapper = await readFile(join(fixture.binDir, "omo.cmd"), "utf8");
		assert.ok(wrapper.includes(join(pluginRoot, "dist", "cli", "index.js")));
		await assert.rejects(() => lstat(join(fixture.binDir, COMPONENT_BIN_NAME)), "win32 must not leave posix symlinks behind");
	});
});

test("#given a legacy payload without root CLI dist #when the worker setup runs #then it records degraded omo-cli and leaves no broken link", async () => {
	await withBinLinkFixture(async (fixture) => {
		const pluginRoot = await writeVersionedRoot(fixture.root, "1.0.0");

		const outcome = await runWorkerSetup(setupOptions(fixture, pluginRoot, { now: 7_000, platform: process.platform }));

		assert.deepEqual(outcome.degraded, [OMO_CLI_DEGRADED_ENTRY]);
		await assert.rejects(() => lstat(join(fixture.binDir, "omo")), "no omo wrapper may be written without dist/cli");
		await assert.rejects(() => lstat(join(fixture.binDir, "omo.cmd")), "no Windows omo wrapper may be written without dist/cli");
		await assertNoDanglingEntries(fixture.binDir);
		const log = await readFile(join(fixture.pluginData, "bootstrap", "bootstrap.log"), "utf8");
		const warning = JSON.parse(log)["warning"];
		assert.equal(typeof warning, "string", `bootstrap.log warning must be a string, got: ${log}`);
		assert.ok(
			warning.includes("skipped the omo runtime wrapper because ") &&
				warning.includes(`${join("dist", "cli", "index.js")} is missing; `) &&
				warning.includes("omo sparkshell/ulw-loop commands will be unavailable until a package shipping dist/cli is installed"),
			`bootstrap.log must carry the install-local warning text, got: ${log}`,
		);
	});
});

test("#given a payload shipping dist/cli #when the worker setup runs with no bin-dir override #then the omo wrapper lands in <codexHome>/bin without a degraded entry", async () => {
	await withBinLinkFixture(async (fixture) => {
		const pluginRoot = await writeVersionedRoot(fixture.root, "1.0.0", { withRuntimeCli: true });

		const outcome = await runWorkerSetup(setupOptions(fixture, pluginRoot, { env: {}, platform: process.platform }));

		assert.deepEqual(outcome.degraded, []);
		const defaultBinDir = join(fixture.codexHome, "bin");
		const wrapperName = process.platform === "win32" ? "omo.cmd" : "omo";
		const wrapperPath = join(defaultBinDir, wrapperName);
		const wrapper = await readFile(wrapperPath, "utf8");
		assert.ok(wrapper.includes(join(pluginRoot, "dist", "cli", "index.js")));
		if (process.platform !== "win32") {
			assert.ok((await stat(wrapperPath)).mode & 0o111, "the posix omo wrapper must be executable");
			assert.equal(
				await readlink(join(defaultBinDir, COMPONENT_BIN_NAME)),
				join(pluginRoot, "components", "toolbox", "dist", "cli.js"),
			);
			const result = await execFileAsync(wrapperPath, ["--version"], {
				env: { ...process.env, OMO_RUNTIME: "node", PATH: `${dirname(process.execPath)}:/usr/bin:/bin` },
			});
			assert.match(result.stdout, /omo node runtime/);
		} else {
			const shim = await readFile(join(defaultBinDir, `${COMPONENT_BIN_NAME}.cmd`), "utf8");
			assert.ok(shim.includes(join(pluginRoot, "components", "toolbox", "dist", "cli.js")));
		}
	});
});
