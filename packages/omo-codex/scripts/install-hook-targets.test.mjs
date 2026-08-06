import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { assertHookCommandTargets, findMissingHookCommandTargets } from "./install-dist/install-local.mjs";

const HOOKS_MANIFEST = {
	hooks: {
		SessionStart: [
			{
				hooks: [
					{
						type: "command",
						command: 'node "${PLUGIN_ROOT}/components/git-bash/dist/cli.js" hook session-start',
					},
				],
			},
			{
				matcher: "^startup$",
				hooks: [
					{
						type: "command",
						command: 'node "${PLUGIN_ROOT}/scripts/auto-update.mjs" hook session-start',
					},
				],
			},
		],
		Stop: [
			{
				hooks: [
					{
						type: "command",
						command: 'node "${PLUGIN_ROOT}/components/ulw-loop/dist/cli.js" hook stop',
					},
				],
			},
		],
	},
};

async function createPluginRoot({ withGitBashDist }) {
	const pluginRoot = await mkdtemp(join(tmpdir(), "hook-targets-"));
	await mkdir(join(pluginRoot, "hooks"), { recursive: true });
	await writeFile(join(pluginRoot, "hooks", "hooks.json"), JSON.stringify(HOOKS_MANIFEST, null, "\t"));
	const targets = [
		"scripts/auto-update.mjs",
		"components/ulw-loop/dist/cli.js",
		...(withGitBashDist ? ["components/git-bash/dist/cli.js"] : []),
	];
	for (const target of targets) {
		await mkdir(dirname(join(pluginRoot, target)), { recursive: true });
		await writeFile(join(pluginRoot, target), "");
	}
	return pluginRoot;
}

async function createPluginRootWithHookArray({ withGitBashDist }) {
	const pluginRoot = await mkdtemp(join(tmpdir(), "hook-targets-array-"));
	await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true });
	await mkdir(join(pluginRoot, "hooks"), { recursive: true });
	await writeFile(
		join(pluginRoot, ".codex-plugin", "plugin.json"),
		JSON.stringify({ name: "omo", hooks: ["./hooks/session-start.json", "./hooks/stop.json"] }, null, "\t"),
	);
	await writeFile(
		join(pluginRoot, "hooks", "session-start.json"),
		JSON.stringify({ hooks: { SessionStart: HOOKS_MANIFEST.hooks.SessionStart } }, null, "\t"),
	);
	await writeFile(
		join(pluginRoot, "hooks", "stop.json"),
		JSON.stringify({ hooks: { Stop: HOOKS_MANIFEST.hooks.Stop } }, null, "\t"),
	);
	const targets = [
		"scripts/auto-update.mjs",
		"components/ulw-loop/dist/cli.js",
		...(withGitBashDist ? ["components/git-bash/dist/cli.js"] : []),
	];
	for (const target of targets) {
		await mkdir(dirname(join(pluginRoot, target)), { recursive: true });
		await writeFile(join(pluginRoot, target), "");
	}
	return pluginRoot;
}

async function createPluginRootWithWindowsHook({ withBootstrapScript }) {
	const pluginRoot = await mkdtemp(join(tmpdir(), "hook-targets-windows-"));
	await mkdir(join(pluginRoot, "hooks"), { recursive: true });
	await writeFile(
		join(pluginRoot, "hooks", "hooks.json"),
		JSON.stringify(
			{
				hooks: {
					SessionStart: [
						{
							hooks: [
								{
									type: "command",
									commandWindows:
										'powershell -NoProfile -ExecutionPolicy Bypass -File "${PLUGIN_ROOT}\\components\\bootstrap\\scripts\\bootstrap.ps1"',
								},
							],
						},
					],
				},
			},
			null,
			"\t",
		),
	);
	if (withBootstrapScript) {
		const target = join(pluginRoot, "components", "bootstrap", "scripts", "bootstrap.ps1");
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, "");
	}
	return pluginRoot;
}

test("#given a hook command target missing from the payload #when scanning #then exactly that path is reported", async (t) => {
	const pluginRoot = await createPluginRoot({ withGitBashDist: false });
	t.after(() => rm(pluginRoot, { recursive: true, force: true }));

	const missing = await findMissingHookCommandTargets(pluginRoot);

	assert.deepEqual(missing, [join(pluginRoot, "components/git-bash/dist/cli.js")]);
});

test("#given a Windows hook command target missing from the payload #when scanning #then the backslash path is reported", async (t) => {
	const pluginRoot = await createPluginRootWithWindowsHook({ withBootstrapScript: false });
	t.after(() => rm(pluginRoot, { recursive: true, force: true }));

	const missing = await findMissingHookCommandTargets(pluginRoot);

	assert.deepEqual(missing, [join(pluginRoot, "components", "bootstrap", "scripts", "bootstrap.ps1")]);
});

test("#given a Windows hook command target exists in the payload #when scanning #then nothing is missing", async (t) => {
	const pluginRoot = await createPluginRootWithWindowsHook({ withBootstrapScript: true });
	t.after(() => rm(pluginRoot, { recursive: true, force: true }));

	assert.deepEqual(await findMissingHookCommandTargets(pluginRoot), []);
});

test("#given a complete payload #when scanning #then nothing is missing", async (t) => {
	const pluginRoot = await createPluginRoot({ withGitBashDist: true });
	t.after(() => rm(pluginRoot, { recursive: true, force: true }));

	assert.deepEqual(await findMissingHookCommandTargets(pluginRoot), []);
});

test("#given hook manifests declared as an array #when scanning #then missing targets are reported", async (t) => {
	const pluginRoot = await createPluginRootWithHookArray({ withGitBashDist: false });
	t.after(() => rm(pluginRoot, { recursive: true, force: true }));

	const missing = await findMissingHookCommandTargets(pluginRoot);

	assert.deepEqual(missing, [join(pluginRoot, "components/git-bash/dist/cli.js")]);
});

test("#given hook manifests declared as an array and complete payload #when scanning #then nothing is missing", async (t) => {
	const pluginRoot = await createPluginRootWithHookArray({ withGitBashDist: true });
	t.after(() => rm(pluginRoot, { recursive: true, force: true }));

	assert.deepEqual(await findMissingHookCommandTargets(pluginRoot), []);
});

test("#given no hooks manifest #when scanning #then nothing is missing", async (t) => {
	const pluginRoot = await mkdtemp(join(tmpdir(), "hook-targets-"));
	t.after(() => rm(pluginRoot, { recursive: true, force: true }));

	assert.deepEqual(await findMissingHookCommandTargets(pluginRoot), []);
});

test("#given a broken payload #when asserting #then the error names the missing target and the plugin root", async (t) => {
	const pluginRoot = await createPluginRoot({ withGitBashDist: false });
	t.after(() => rm(pluginRoot, { recursive: true, force: true }));

	await assert.rejects(
		() => assertHookCommandTargets(pluginRoot),
		(error) =>
			error instanceof Error &&
			error.message.includes("components/git-bash/dist/cli.js") &&
			error.message.includes("hooks.json"),
	);
});

test("#given a complete payload #when asserting #then it resolves", async (t) => {
	const pluginRoot = await createPluginRoot({ withGitBashDist: true });
	t.after(() => rm(pluginRoot, { recursive: true, force: true }));

	await assertHookCommandTargets(pluginRoot);
});
