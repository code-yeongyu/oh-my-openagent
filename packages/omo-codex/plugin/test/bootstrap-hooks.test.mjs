import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";

import {
	collectCommandHooks,
	readAggregateHookManifests,
	readComponentHookManifests,
	readJson,
	root,
} from "./aggregate-plugin-fixture.mjs";

const PLUGIN_ROOT_TARGET_PATTERN = /\$\{PLUGIN_ROOT\}([^"']+)/g;
const SKIPPED_DIRECTORY_NAMES = new Set([".git", "node_modules"]);
const EXPECTED_BOOTSTRAP_COMMAND = 'node "${PLUGIN_ROOT}/components/bootstrap/dist/cli.js" hook session-start';
const EXPECTED_BOOTSTRAP_COMMAND_WINDOWS =
	'powershell -NoProfile -ExecutionPolicy Bypass -File "${PLUGIN_ROOT}\\components\\bootstrap\\scripts\\bootstrap.ps1"';
const EXPECTED_NODE_DISPATCH_PREFIX =
	'powershell -NoProfile -ExecutionPolicy Bypass -File "${PLUGIN_ROOT}\\components\\bootstrap\\scripts\\node-dispatch.ps1"';

async function pathExists(absolutePath) {
	try {
		await stat(absolutePath);
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
}

async function findHooksManifestPaths(directory, results = []) {
	const entries = await readdir(directory, { withFileTypes: true });
	for (const entry of entries) {
		if (SKIPPED_DIRECTORY_NAMES.has(entry.name)) continue;
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			await findHooksManifestPaths(path, results);
			continue;
		}
		if (entry.name === "hooks.json") results.push(path);
	}
	return results;
}

function collectAsyncOptIns(value, manifestPath, offenders) {
	if (Array.isArray(value)) {
		for (const entry of value) collectAsyncOptIns(entry, manifestPath, offenders);
		return offenders;
	}
	if (typeof value !== "object" || value === null) return offenders;
	if (value.async === true) offenders.push(manifestPath);
	for (const entry of Object.values(value)) collectAsyncOptIns(entry, manifestPath, offenders);
	return offenders;
}

function collectPluginRootTargets(handler) {
	const targets = [];
	for (const commandText of [handler.command, handler.commandWindows]) {
		if (typeof commandText !== "string") continue;
		for (const match of commandText.matchAll(PLUGIN_ROOT_TARGET_PATTERN)) {
			targets.push(match[1].split(/[\\/]/).filter((part) => part.length > 0));
		}
	}
	return targets;
}

async function readHookManifestsWithRoots() {
	const aggregate = (await readAggregateHookManifests()).map(({ source, hooks }) => ({ source, hooks, roots: [root] }));
	const components = (await readComponentHookManifests()).map(({ source, hooks }) => ({
		source,
		hooks,
		roots: [dirname(dirname(join(root, source))), root],
	}));
	return [...aggregate, ...components];
}

function findBootstrapSessionStartHandlers(hooks) {
	const groups = Array.isArray(hooks.hooks?.SessionStart) ? hooks.hooks.SessionStart : [];
	const located = [];
	for (const group of groups) {
		for (const handler of group.hooks ?? []) {
			if (typeof handler.command !== "string") continue;
			if (!handler.command.includes("components/bootstrap/dist/cli.js")) continue;
			located.push({ group, handler });
		}
	}
	return located;
}

test("#given every hooks.json under the plugin #when handlers are inspected #then no entry opts into unsupported async execution", async () => {
	// given
	const manifestPaths = await findHooksManifestPaths(root);

	// when
	const offenders = [];
	for (const manifestPath of manifestPaths) {
		collectAsyncOptIns(JSON.parse(await readFile(manifestPath, "utf8")), manifestPath, offenders);
	}

	// then
	assert(manifestPaths.length >= 2, "expected the aggregate and component hooks manifests to be discovered");
	assert.deepEqual(offenders, [], `Codex skips async hooks silently; remove "async": true from: ${offenders.join(", ")}`);
});

test("#given aggregate and component hook manifests #when command targets are resolved #then every command and commandWindows target exists", async () => {
	// given
	const manifests = await readHookManifestsWithRoots();

	// when
	const missing = [];
	for (const manifest of manifests) {
		for (const { handler } of collectCommandHooks(manifest.hooks, manifest.source)) {
			for (const targetParts of collectPluginRootTargets(handler)) {
				const candidates = manifest.roots.map((rootPath) => join(rootPath, ...targetParts));
				let found = false;
				for (const candidate of candidates) {
					if (await pathExists(candidate)) {
						found = true;
						break;
					}
				}
				if (!found) missing.push(`${manifest.source}: ${targetParts.join("/")}`);
			}
		}
	}

	// then
	assert.deepEqual(missing, []);
});

test("#given aggregate hook manifests #when command handlers are inspected #then each has a Windows dispatcher", async () => {
	// given
	const aggregateHooks = await readAggregateHookManifests();

	// when
	const missing = [];
	for (const manifest of aggregateHooks) {
		for (const { handler } of collectCommandHooks(manifest.hooks, manifest.source)) {
			if (typeof handler.commandWindows === "string" && handler.commandWindows.length > 0) continue;
			missing.push(`${manifest.source}: ${handler.command}`);
		}
	}

	// then
	assert.deepEqual(missing, [], `Aggregate hook commands need commandWindows dispatchers:\n${missing.join("\n")}`);
});

test("#given the bootstrap component #when its SessionStart registration is inspected #then aggregate and component entries declare both platform commands", async () => {
	// given
	const aggregateHooks = (await readAggregateHookManifests()).find(({ source }) =>
		source.endsWith("session-start-checking-bootstrap-provisioning.json"),
	)?.hooks;
	const componentHooks = await readJson("components/bootstrap/hooks/hooks.json");

	// when
	const aggregateEntries = findBootstrapSessionStartHandlers(aggregateHooks ?? {});
	const componentEntries = findBootstrapSessionStartHandlers(componentHooks);

	// then
	for (const [label, entries] of [
		["aggregate", aggregateEntries],
		["component", componentEntries],
	]) {
		assert.equal(entries.length, 1, `${label} hooks.json must register exactly one bootstrap SessionStart handler`);
		const { group, handler } = entries[0];
		assert.equal(group.matcher, undefined, `${label} bootstrap SessionStart entry must be matcher-less`);
		assert.equal(handler.type, "command");
		assert.equal(handler.command, EXPECTED_BOOTSTRAP_COMMAND);
		assert.equal(handler.commandWindows, EXPECTED_BOOTSTRAP_COMMAND_WINDOWS);
		assert.equal(typeof handler.timeout, "number");
		assert(handler.timeout <= 60, `${label} bootstrap timeout must stay <= 60 seconds`);
		assert.equal(typeof handler.statusMessage, "string");
		assert.match(handler.statusMessage, /^\(OmO [^)]+\) .+$/);
	}
});

test("#given non-bootstrap aggregate hook manifests #when commandWindows entries are read #then they launch the managed Node dispatcher", async () => {
	// given
	const aggregateHooks = await readAggregateHookManifests();

	// when
	const offenders = [];
	for (const manifest of aggregateHooks) {
		for (const { handler } of collectCommandHooks(manifest.hooks, manifest.source)) {
			if (handler.command === EXPECTED_BOOTSTRAP_COMMAND) continue;
			if (typeof handler.commandWindows !== "string" || !handler.commandWindows.startsWith(EXPECTED_NODE_DISPATCH_PREFIX)) {
				offenders.push(`${manifest.source}: ${handler.commandWindows ?? "<missing>"}`);
			}
		}
	}

	// then
	assert.deepEqual(offenders, [], `Non-bootstrap aggregate hooks must use node-dispatch.ps1 on Windows:\n${offenders.join("\n")}`);
});

test("#given the built bootstrap bundle #when its module references are inspected #then it depends on Node built-ins only", async () => {
	// given
	const bundlePath = join(root, "components", "bootstrap", "dist", "cli.js");
	assert.equal(await pathExists(bundlePath), true, "components/bootstrap/dist/cli.js must exist after the plugin build");
	const bundle = await readFile(bundlePath, "utf8");

	// when
	const externalSpecifiers = [
		...[...bundle.matchAll(/\brequire\(["']([^"']+)["']\)/g)].map((match) => match[1]),
		...[...bundle.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((match) => match[1]),
	].filter((specifier) => !specifier.startsWith("node:"));

	// then
	assert(bundle.length > 0, "bootstrap bundle must not be empty");
	assert.deepEqual(externalSpecifiers, [], "bootstrap dist must bundle everything except node: built-ins");
});
