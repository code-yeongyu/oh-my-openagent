import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { detectInstallFlow, resolveInstallSnapshotPath } from "./install-flow.mjs";
import { resolveSpawnInvocation } from "./spawn-command.mjs";

const DEFAULT_UPDATE_COMMAND = "npx";
const DEFAULT_UPDATE_ARGS = ["--yes", "lazycodex-ai@latest", "install", "--no-tui", "--codex-autonomous"];
const DEFAULT_LATEST_VERSION_TIMEOUT_MS = 1_500;

export function resolveLazyCodexUpdatePlan({ currentVersion, latestVersion, command = DEFAULT_UPDATE_COMMAND, args = DEFAULT_UPDATE_ARGS } = {}) {
	const current = parseVersion(currentVersion);
	if (current === null) return { shouldUpdate: false, reason: "unknown-current" };
	const latest = parseVersion(latestVersion);
	if (latest === null) return { shouldUpdate: false, reason: "unknown-latest" };
	if (compareVersions(latest, current) <= 0) return { shouldUpdate: false, reason: "up-to-date" };
	return { shouldUpdate: true, command, args };
}

export function resolveCommand(env) {
	return env.LAZYCODEX_AUTO_UPDATE_COMMAND?.trim() || DEFAULT_UPDATE_COMMAND;
}

export function resolveArgs(env) {
	if (env.LAZYCODEX_AUTO_UPDATE_ARGS_JSON) {
		const parsed = JSON.parse(env.LAZYCODEX_AUTO_UPDATE_ARGS_JSON);
		if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
			throw new TypeError("LAZYCODEX_AUTO_UPDATE_ARGS_JSON must be a JSON string array");
		}
		return parsed;
	}
	return DEFAULT_UPDATE_ARGS;
}

export function detectAutoUpdateInstallFlow(env) {
	return detectInstallFlow({ pluginRoot: resolveAutoUpdatePluginRoot(env), env });
}

export function resolveCurrentVersion(env) {
	if (env.LAZYCODEX_CURRENT_VERSION?.trim()) return env.LAZYCODEX_CURRENT_VERSION.trim();
	const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
	return (
		readVersionManifest(resolveInstallSnapshotPath(env, pluginRoot)) ??
		readVersionManifest(join(pluginRoot, "..", "..", "..", "package.json")) ??
		readVersionManifest(join(pluginRoot, ".codex-plugin", "plugin.json"))
	);
}

export function resolveLatestVersion(env) {
	if (env.LAZYCODEX_LATEST_VERSION?.trim()) return env.LAZYCODEX_LATEST_VERSION.trim();
	const timeout = parsePositiveInteger(env.LAZYCODEX_LATEST_VERSION_TIMEOUT_MS, DEFAULT_LATEST_VERSION_TIMEOUT_MS);
	const invocation = resolveSpawnInvocation("npm", ["view", "lazycodex-ai", "version", "--silent"]);
	const result = spawnSync(invocation.command, invocation.args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
		timeout,
	});
	if (result.status !== 0) return undefined;
	const version = result.stdout.trim();
	return version.length > 0 ? version : undefined;
}

export function defaultRunCommandForManualUpdate(command, args, options) {
	return new Promise((resolve, reject) => {
		const invocation = resolveSpawnInvocation(command, args);
		const child = spawn(invocation.command, invocation.args, {
			cwd: options.cwd,
			env: options.env,
			stdio: "inherit",
		});
		child.once("error", reject);
		child.once("close", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`${command} ${args.join(" ")} exited with ${code ?? "unknown status"}`));
		});
	});
}

export function parseVersion(version) {
	if (typeof version !== "string") return null;
	const match = /^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?(?:\+.*)?$/.exec(version.trim());
	if (match === null) return null;
	const major = Number.parseInt(match[1], 10);
	const minor = Number.parseInt(match[2], 10);
	const patch = Number.parseInt(match[3], 10);
	const prerelease = match[4];
	return Number.isFinite(major) && Number.isFinite(minor) && Number.isFinite(patch)
		? { major, minor, patch, prerelease }
		: null;
}

export function compareVersions(left, right) {
	for (const key of ["major", "minor", "patch"]) {
		const leftValue = left[key];
		const rightValue = right[key];
		if (leftValue > rightValue) return 1;
		if (leftValue < rightValue) return -1;
	}
	if (left.prerelease === undefined && right.prerelease !== undefined) return 1;
	if (left.prerelease !== undefined && right.prerelease === undefined) return -1;
	if (left.prerelease !== undefined && right.prerelease !== undefined) {
		return left.prerelease.localeCompare(right.prerelease);
	}
	return 0;
}

export function parsePositiveInteger(value, fallback) {
	if (value === undefined || value === "") return fallback;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function resolveAutoUpdatePluginRoot(env) {
	if (env.PLUGIN_ROOT?.trim()) return env.PLUGIN_ROOT.trim();
	return dirname(dirname(fileURLToPath(import.meta.url)));
}

function readVersionManifest(path) {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		if (typeof parsed.version !== "string") return undefined;
		const version = parsed.version.trim();
		return version.length > 0 ? version : undefined;
	} catch (error) {
		if (error instanceof Error) return undefined;
		throw error;
	}
}
