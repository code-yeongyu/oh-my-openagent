import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CLI_URL = new URL("../components/bootstrap/dist/cli.js", import.meta.url);
const CLI_PATH = fileURLToPath(CLI_URL);
const {
	BOOTSTRAP_RESTART_NOTICE,
	bootstrapLocks,
	executeSessionStartHook,
	parseWorkerFlags,
	runBootstrapWorker,
	runSessionStartHook,
} = await import(CLI_URL.href);

const PLUGIN_VERSION = "9.9.9";

async function withFixture(run, options = {}) {
	const root = await mkdtemp(join(tmpdir(), "omo-bootstrap-orch-"));
	try {
		const pluginRoot = join(root, "plugin");
		const pluginData = join(root, "plugin-data");
		await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true });
		await mkdir(pluginData, { recursive: true });
		await writeFile(
			join(pluginRoot, ".codex-plugin", "plugin.json"),
			`${JSON.stringify({ name: "omo", version: options.version ?? PLUGIN_VERSION })}\n`,
		);
		await run({
			env: { PLUGIN_DATA: pluginData, PLUGIN_ROOT: pluginRoot },
			pluginData,
			pluginRoot,
			root,
		});
	} finally {
		await rm(root, { force: true, recursive: true });
	}
}

function hookRecorder() {
	const notices = [];
	const spawned = [];
	return {
		notices,
		spawned,
		spawnWorker: (invocation) => {
			spawned.push(invocation);
		},
		writeNotice: (line) => {
			notices.push(line);
		},
	};
}

async function readStateFile(pluginData) {
	return JSON.parse(await readFile(join(pluginData, "bootstrap", "state.json"), "utf8"));
}

async function writeStateFile(pluginData, state) {
	await mkdir(join(pluginData, "bootstrap"), { recursive: true });
	await writeFile(join(pluginData, "bootstrap", "state.json"), `${JSON.stringify(state)}\n`);
}

test("#given a fresh PLUGIN_DATA #when the session-start hook runs #then it spawns the detached worker and emits the restart notice", async () => {
	await withFixture(async (fixture) => {
		const recorder = hookRecorder();

		const result = await executeSessionStartHook({ env: fixture.env, ...recorder });

		assert.equal(result.exitCode, 0);
		assert.equal(result.action, "spawned");
		assert.equal(recorder.spawned.length, 1);
		assert.equal(recorder.spawned[0].command, process.execPath);
		assert.deepEqual(recorder.spawned[0].args, [CLI_PATH, "worker"]);
		assert.equal(recorder.spawned[0].env.PLUGIN_DATA, fixture.pluginData);
		assert.equal(recorder.notices.length, 1);
		assert.deepEqual(JSON.parse(recorder.notices[0]), {
			hookSpecificOutput: {
				hookEventName: "SessionStart",
				additionalContext: BOOTSTRAP_RESTART_NOTICE,
			},
		});
	});
});

test("#given a completed marker for the current version #when the hook runs #then it exits 0 silently without spawning", async () => {
	await withFixture(async (fixture) => {
		await writeStateFile(fixture.pluginData, { completedForVersion: PLUGIN_VERSION, lastAttemptAt: 1, lastStatus: "success" });
		const recorder = hookRecorder();

		const result = await executeSessionStartHook({ env: fixture.env, ...recorder });

		assert.equal(result.exitCode, 0);
		assert.equal(result.action, "skip-completed");
		assert.deepEqual(recorder.spawned, []);
		assert.deepEqual(recorder.notices, []);
	});
});

test("#given a marker stamped for an older plugin version #when the hook runs #then the version bump re-spawns the worker", async () => {
	await withFixture(async (fixture) => {
		await writeStateFile(fixture.pluginData, { completedForVersion: "0.0.1", lastAttemptAt: 1, lastStatus: "success" });
		const recorder = hookRecorder();

		const result = await executeSessionStartHook({ env: fixture.env, ...recorder });

		assert.equal(result.action, "spawned");
		assert.equal(recorder.spawned.length, 1);
	});
});

test("#given a fresh bootstrap lock held by another process #when the hook runs #then it exits 0 without spawning", async () => {
	await withFixture(async (fixture) => {
		await mkdir(join(fixture.pluginData, "bootstrap"), { recursive: true });
		await writeFile(join(fixture.pluginData, "bootstrap", "state.json.lock"), `${Date.now()}\n`);
		const recorder = hookRecorder();

		const result = await executeSessionStartHook({ env: fixture.env, ...recorder });

		assert.equal(result.exitCode, 0);
		assert.equal(result.action, "skip-locked");
		assert.deepEqual(recorder.spawned, []);
		assert.deepEqual(recorder.notices, []);
	});
});

test("#given a stale bootstrap lock #when the hook runs #then it spawns anyway", async () => {
	await withFixture(async (fixture) => {
		await mkdir(join(fixture.pluginData, "bootstrap"), { recursive: true });
		await writeFile(join(fixture.pluginData, "bootstrap", "state.json.lock"), "1\n");
		const staleNow = Date.now() + 11 * 60 * 1_000;
		const recorder = hookRecorder();

		const result = await executeSessionStartHook({ env: fixture.env, now: staleNow, ...recorder });

		assert.equal(result.action, "spawned");
	});
});

test("#given PLUGIN_DATA or PLUGIN_ROOT missing #when the hook runs #then it exits 0 silently", async () => {
	await withFixture(async (fixture) => {
		const recorder = hookRecorder();

		const noData = await executeSessionStartHook({ env: { PLUGIN_ROOT: fixture.pluginRoot }, ...recorder });
		const noRoot = await executeSessionStartHook({ env: { PLUGIN_DATA: fixture.pluginData }, ...recorder });

		assert.equal(noData.exitCode, 0);
		assert.equal(noData.action, "skip-missing-env");
		assert.equal(noRoot.action, "skip-missing-env");
		assert.deepEqual(recorder.spawned, []);
	});
});

test("#given an unreadable plugin version manifest #when the hook runs #then it exits 0 without spawning", async () => {
	await withFixture(async (fixture) => {
		await rm(join(fixture.pluginRoot, ".codex-plugin", "plugin.json"));
		const recorder = hookRecorder();

		const result = await executeSessionStartHook({ env: fixture.env, ...recorder });

		assert.equal(result.exitCode, 0);
		assert.equal(result.action, "skip-version-unresolved");
		assert.deepEqual(recorder.spawned, []);
	});
});

test("#given the public hook runner #when every branch resolves #then it always returns exit code 0", async () => {
	await withFixture(async (fixture) => {
		const recorder = hookRecorder();

		assert.equal(await runSessionStartHook({ env: fixture.env, ...recorder }), 0);
		assert.equal(await runSessionStartHook({ env: {}, ...recorder }), 0);
	});
});

test("#given a fresh state #when the worker runs #then steps execute and the versioned success marker is persisted", async () => {
	await withFixture(async (fixture) => {
		const contexts = [];
		const now = 42_000;

		const result = await runBootstrapWorker({
			argv: ["--codex-home", join(fixture.root, "codex-home")],
			env: fixture.env,
			now,
			steps: [
				{
					name: "setup",
					run: async (context) => {
						contexts.push(context);
						return { degraded: [] };
					},
				},
			],
		});

		assert.equal(result.ran, true);
		assert.equal(result.status, "success");
		assert.equal(contexts.length, 1);
		assert.equal(contexts[0].codexHome, join(fixture.root, "codex-home"));
		assert.equal(contexts[0].pluginRoot, fixture.pluginRoot);
		assert.equal(contexts[0].pluginData, fixture.pluginData);
		assert.equal(contexts[0].pluginVersion, PLUGIN_VERSION);
		assert.deepEqual(await readStateFile(fixture.pluginData), {
			completedForVersion: PLUGIN_VERSION,
			degraded: [],
			lastAttemptAt: now,
			lastStatus: "success",
		});
	});
});

test("#given a marker written between hook and worker start #when the worker re-checks under lock #then it honors the marker (TOCTOU)", async () => {
	await withFixture(async (fixture) => {
		await writeStateFile(fixture.pluginData, { completedForVersion: PLUGIN_VERSION, lastAttemptAt: 7, lastStatus: "success" });
		let stepRuns = 0;

		const result = await runBootstrapWorker({
			env: fixture.env,
			steps: [
				{
					name: "setup",
					run: async () => {
						stepRuns += 1;
						return { degraded: [] };
					},
				},
			],
		});

		assert.deepEqual(result, { ran: false, reason: "already-completed" });
		assert.equal(stepRuns, 0);
		assert.deepEqual(await readStateFile(fixture.pluginData), {
			completedForVersion: PLUGIN_VERSION,
			lastAttemptAt: 7,
			lastStatus: "success",
		});
	});
});

test("#given both locks already held #when the worker starts #then it is refused without writing state", async () => {
	await withFixture(async (fixture) => {
		const locks = await bootstrapLocks({ env: fixture.env, pluginData: fixture.pluginData });
		assert.notEqual(locks, null);

		const result = await runBootstrapWorker({ env: fixture.env, steps: [] });

		assert.deepEqual(result, { ran: false, reason: "locked" });
		await assert.rejects(() => stat(join(fixture.pluginData, "bootstrap", "state.json")));
		await locks.release();
		await assert.rejects(() => stat(locks.bootstrapLockPath));
	});
});

test("#given throwing and degraded steps #when the worker runs #then degraded reasons are persisted and the worker still exits cleanly", async () => {
	await withFixture(async (fixture) => {
		const now = 84_000;

		const result = await runBootstrapWorker({
			env: fixture.env,
			now,
			steps: [
				{
					name: "setup",
					run: async () => {
						throw new Error("config.toml unwritable");
					},
				},
				{
					name: "sg",
					run: async () => ({
						degraded: [{ component: "ast_grep", hint: "npx lazycodex-ai doctor", reason: "checksum mismatch for darwin-arm64" }],
					}),
				},
			],
		});

		assert.equal(result.ran, true);
		assert.equal(result.status, "degraded");
		const state = await readStateFile(fixture.pluginData);
		assert.equal(state.completedForVersion, PLUGIN_VERSION);
		assert.equal(state.lastAttemptAt, now);
		assert.equal(state.lastStatus, "degraded");
		assert.equal(state.degraded.length, 2);
		assert.deepEqual(state.degraded[0], {
			component: "setup",
			hint: "npx lazycodex-ai doctor",
			reason: "config.toml unwritable",
		});
		assert.deepEqual(state.degraded[1], {
			component: "ast_grep",
			hint: "npx lazycodex-ai doctor",
			reason: "checksum mismatch for darwin-arm64",
		});
	});
});

test("#given a completed marker #when the worker runs with --once #then the marker is bypassed and steps run again", async () => {
	await withFixture(async (fixture) => {
		await writeStateFile(fixture.pluginData, { completedForVersion: PLUGIN_VERSION, lastAttemptAt: 7, lastStatus: "success" });
		let stepRuns = 0;

		const result = await runBootstrapWorker({
			argv: ["--once"],
			env: fixture.env,
			steps: [
				{
					name: "setup",
					run: async () => {
						stepRuns += 1;
						return { degraded: [] };
					},
				},
			],
		});

		assert.equal(result.ran, true);
		assert.equal(stepRuns, 1);
	});
});

test("#given --only sg #when the worker runs #then only the matching step executes", async () => {
	await withFixture(async (fixture) => {
		const ran = [];
		const step = (name) => ({
			name,
			run: async () => {
				ran.push(name);
				return { degraded: [] };
			},
		});

		const result = await runBootstrapWorker({
			argv: ["--only", "sg"],
			env: fixture.env,
			steps: [step("setup"), step("sg")],
		});

		assert.equal(result.ran, true);
		assert.deepEqual(ran, ["sg"]);
	});
});

test("#given worker CLI flags #when parsed #then --codex-home/--once/--only/--manifest-dir are recognized and unknown flags throw", () => {
	assert.deepEqual(parseWorkerFlags(["--codex-home", "/x", "--once", "--only", "sg", "--manifest-dir", "/m"]), {
		codexHome: "/x",
		manifestDir: "/m",
		once: true,
		only: "sg",
	});
	assert.deepEqual(parseWorkerFlags([]), { once: false });
	assert.throws(() => parseWorkerFlags(["--bogus"]), /--bogus/);
	assert.throws(() => parseWorkerFlags(["--codex-home"]), /--codex-home/);
});

test("#given a missing plugin version in the worker #when it runs #then it records a degraded state instead of crashing", async () => {
	await withFixture(async (fixture) => {
		await rm(join(fixture.pluginRoot, ".codex-plugin", "plugin.json"));

		const result = await runBootstrapWorker({ env: fixture.env, now: 5_000, steps: [] });

		assert.equal(result.ran, true);
		assert.equal(result.status, "degraded");
		const state = await readStateFile(fixture.pluginData);
		assert.equal(state.completedForVersion, undefined);
		assert.equal(state.lastStatus, "degraded");
		assert.match(state.degraded[0].reason, /plugin version/i);
	});
});
