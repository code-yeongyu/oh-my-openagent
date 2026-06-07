#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	DEFAULT_LOCK_STALE_MS,
	acquireLock,
	appendUpdateLog,
	readState,
	resolveLockPath,
	resolveStatePath,
	writeState,
} from "./auto-update-state.mjs";
import { migrateCodexConfig } from "./migrate-codex-config.mjs";
import { resolveSpawnInvocation } from "./spawn-command.mjs";

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_RETRY_INTERVAL_MS = 30 * 60 * 1_000;
const DEFAULT_UPDATE_COMMAND = "npx";
const DEFAULT_UPDATE_ARGS = ["--yes", "lazycodex-ai@latest", "install", "--no-tui", "--codex-autonomous"];
const INSTALLED_VERSION_FILE = "lazycodex-install.json";

export function resolveAutoUpdatePlan({ env = process.env, now = Date.now(), lastCheckedAt, lastAttemptedAt, lastStatus } = {}) {
	if (env.LAZYCODEX_AUTO_UPDATE_DISABLED === "1" || env.OMO_CODEX_AUTO_UPDATE_DISABLED === "1") {
		return { shouldRun: false, reason: "disabled" };
	}

	const intervalMs = parsePositiveInteger(env.LAZYCODEX_AUTO_UPDATE_INTERVAL_MS, DEFAULT_INTERVAL_MS);
	const successStatus = lastStatus === undefined || lastStatus === "success";
	if (successStatus && typeof lastCheckedAt === "number" && intervalMs > 0 && now - lastCheckedAt < intervalMs) {
		return { shouldRun: false, reason: "throttled" };
	}
	const retryIntervalMs = parsePositiveInteger(env.LAZYCODEX_AUTO_UPDATE_RETRY_INTERVAL_MS, DEFAULT_RETRY_INTERVAL_MS);
	if (!successStatus && typeof lastAttemptedAt === "number" && retryIntervalMs > 0 && now - lastAttemptedAt < retryIntervalMs) {
		return { shouldRun: false, reason: "retry-throttled" };
	}

	const updatePlan = resolveLazyCodexUpdatePlan({
		currentVersion: resolveCurrentVersion(env),
		latestVersion: resolveLatestVersion(env),
		command: resolveCommand(env),
		args: resolveArgs(env),
	});
	if (!updatePlan.shouldUpdate) return { shouldRun: false, reason: updatePlan.reason };

	return {
		shouldRun: true,
		command: updatePlan.command,
		args: updatePlan.args,
		env: {
			...env,
			LAZYCODEX_AUTO_UPDATE_DISABLED: "1",
			OMO_CODEX_AUTO_UPDATE_DISABLED: "1",
		},
	};
}

export function resolveLazyCodexUpdatePlan({ currentVersion, latestVersion, command = DEFAULT_UPDATE_COMMAND, args = DEFAULT_UPDATE_ARGS } = {}) {
	const current = parseVersion(currentVersion);
	if (current === null) return { shouldUpdate: false, reason: "unknown-current" };
	const latest = parseVersion(latestVersion);
	if (latest === null) return { shouldUpdate: false, reason: "unknown-latest" };
	if (compareVersions(latest, current) <= 0) return { shouldUpdate: false, reason: "up-to-date" };
	return { shouldUpdate: true, command, args };
}

export async function runLazyCodexManualUpdate({ env = process.env, dryRun = false, log = console.log, runCommand } = {}) {
	const commandRunner = runCommand ?? defaultRunCommandForManualUpdate;
	const currentVersion = resolveCurrentVersion(env);
	const latestVersion = resolveLatestVersion(env);
	const plan = resolveLazyCodexUpdatePlan({
		currentVersion,
		latestVersion,
		command: resolveCommand(env),
		args: resolveArgs(env),
	});
	if (!plan.shouldUpdate) {
		const printableVersion = currentVersion ?? "unknown";
		log(plan.reason === "up-to-date"
			? `lazycodex-ai ${printableVersion} is already up to date.`
			: `Unable to check lazycodex-ai updates (${plan.reason}).`);
		return plan.reason === "up-to-date" ? 0 : 1;
	}
	if (dryRun) {
		log(`${plan.command} ${plan.args.join(" ")}`);
		return 0;
	}
	await commandRunner(plan.command, plan.args, { cwd: process.cwd(), env });
	return 0;
}

export async function runAutoUpdateCheck({ env = process.env, now = Date.now() } = {}) {
	await runConfigMigration({ env });
	const statePath = resolveStatePath(env);
	const state = await readState(statePath);
	const plan = resolveAutoUpdatePlan({
		env,
		now,
		lastCheckedAt: state.lastCheckedAt,
		lastAttemptedAt: state.lastAttemptedAt,
		lastStatus: state.lastStatus,
	});
	if (!plan.shouldRun) {
		await appendUpdateLog(env, now, "skipped", { reason: plan.reason });
		if (plan.reason === "up-to-date") {
			await writeState(statePath, { ...state, lastCheckedAt: now, lastStatus: "success" });
		}
		return { started: false, reason: plan.reason };
	}

	const lockStaleMs = parsePositiveInteger(env.LAZYCODEX_AUTO_UPDATE_LOCK_STALE_MS, DEFAULT_LOCK_STALE_MS);
	const lock = await acquireLock(resolveLockPath(env, statePath), now, lockStaleMs);
	if (lock === null) {
		await appendUpdateLog(env, now, "locked");
		return { started: false, reason: "locked" };
	}
	try {
		await appendUpdateLog(env, now, "started", { command: plan.command, args: plan.args });
		if (env.LAZYCODEX_AUTO_UPDATE_WAIT === "1") {
			const invocation = resolveSpawnInvocation(plan.command, plan.args);
			const result = spawnSync(invocation.command, invocation.args, {
				env: plan.env,
				stdio: "ignore",
			});
			const status = result.status ?? (result.error === undefined ? 0 : 1);
			await appendUpdateLog(env, now, "finished", { status });
			await writeState(statePath, status === 0
				? { lastCheckedAt: now, lastAttemptedAt: now, lastStatus: "success" }
				: { lastAttemptedAt: now, lastStatus: "failed" });
			return { started: true, status };
		}

		const invocation = resolveSpawnInvocation(plan.command, plan.args);
		const child = spawn(invocation.command, invocation.args, {
			env: plan.env,
			stdio: "ignore",
			detached: true,
		});
		await writeState(statePath, { lastAttemptedAt: now, lastStatus: "started" });
		child.unref();
		return { started: true };
	} finally {
		await lock.release();
	}
}

async function runConfigMigration({ env }) {
	if (env.LAZYCODEX_CONFIG_MIGRATION_DISABLED === "1" || env.OMO_CODEX_CONFIG_MIGRATION_DISABLED === "1") return;
	try {
		await migrateCodexConfig({ env });
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		return;
	}
}

function resolveCommand(env) {
	return env.LAZYCODEX_AUTO_UPDATE_COMMAND?.trim() || DEFAULT_UPDATE_COMMAND;
}

function resolveArgs(env) {
	if (env.LAZYCODEX_AUTO_UPDATE_ARGS_JSON) {
		const parsed = JSON.parse(env.LAZYCODEX_AUTO_UPDATE_ARGS_JSON);
		if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
			throw new TypeError("LAZYCODEX_AUTO_UPDATE_ARGS_JSON must be a JSON string array");
		}
		return parsed;
	}
	return DEFAULT_UPDATE_ARGS;
}

function resolveCurrentVersion(env) {
	if (env.LAZYCODEX_CURRENT_VERSION?.trim()) return env.LAZYCODEX_CURRENT_VERSION.trim();
	const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
	return (
		readVersionManifest(resolveInstalledVersionPath(env, pluginRoot)) ??
		readVersionManifest(join(pluginRoot, "..", "..", "..", "package.json")) ??
		readVersionManifest(join(pluginRoot, ".codex-plugin", "plugin.json"))
	);
}

function resolveLatestVersion(env) {
	if (env.LAZYCODEX_LATEST_VERSION?.trim()) return env.LAZYCODEX_LATEST_VERSION.trim();
	const invocation = resolveSpawnInvocation("npm", ["view", "lazycodex-ai", "version", "--silent"]);
	const result = spawnSync(invocation.command, invocation.args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	if (result.status !== 0) return undefined;
	const version = result.stdout.trim();
	return version.length > 0 ? version : undefined;
}

function defaultRunCommandForManualUpdate(command, args, options) {
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

function parseVersion(version) {
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

function compareVersions(left, right) {
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

function resolveInstalledVersionPath(env, pluginRoot) {
	if (env.LAZYCODEX_INSTALLED_VERSION_PATH?.trim()) return env.LAZYCODEX_INSTALLED_VERSION_PATH;
	return join(pluginRoot, INSTALLED_VERSION_FILE);
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

function parsePositiveInteger(value, fallback) {
	if (value === undefined || value === "") return fallback;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	runAutoUpdateCheck().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(0);
	});
}
