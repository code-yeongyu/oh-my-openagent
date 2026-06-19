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
import { detectInstallFlow, resolveInstallSnapshotPath } from "./install-flow.mjs";
import { migrateCodexConfig } from "./migrate-codex-config.mjs";
import { migrateOmoSotConfig } from "./migrate-omo-sot.mjs";
import { resolveSpawnInvocation } from "./spawn-command.mjs";

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_RETRY_INTERVAL_MS = 30 * 60 * 1_000;
const DEFAULT_UPDATE_COMMAND = "npx";
const DEFAULT_UPDATE_ARGS = ["--yes", "lazycodex-ai@latest", "install", "--no-tui", "--codex-autonomous"];
const MARKETPLACE_FLOW_NOTICE =
	"[LazyCodex] Auto-update skipped: this LazyCodex install is managed by the Codex plugin marketplace, so the npx self-update was not started. Tell the user to upgrade with `codex plugin marketplace upgrade sisyphuslabs`, and that Codex will require hook re-approval after the upgrade.";

export function resolveAutoUpdatePlan({ env = process.env, now = Date.now(), lastCheckedAt, lastAttemptedAt, lastStatus, installFlow } = {}) {
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

	const flow = installFlow ?? detectAutoUpdateInstallFlow(env).flow;
	if (flow === "marketplace") return { shouldRun: false, reason: "marketplace-flow" };

	const currentVersion = resolveCurrentVersion(env);
	const latestVersion = resolveLatestVersion(env);
	const updatePlan = resolveLazyCodexUpdatePlan({
		currentVersion,
		latestVersion,
		command: resolveCommand(env),
		args: resolveArgs(env),
	});
	if (!updatePlan.shouldUpdate) return { shouldRun: false, reason: updatePlan.reason };

	return {
		shouldRun: true,
		command: updatePlan.command,
		args: updatePlan.args,
		currentVersion,
		latestVersion,
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
	const notices = [];
	const state = await settlePendingNotice({ env, now, statePath, state: await readState(statePath), notices });
	const installFlow = detectAutoUpdateInstallFlow(env);
	if (installFlow.flow === "unknown") {
		await appendUpdateLog(env, now, "install-flow-unknown", { reason: installFlow.reason });
	}
	const plan = resolveAutoUpdatePlan({
		env,
		now,
		lastCheckedAt: state.lastCheckedAt,
		lastAttemptedAt: state.lastAttemptedAt,
		lastStatus: state.lastStatus,
		installFlow: installFlow.flow,
	});
	if (!plan.shouldRun) {
		if (plan.reason === "marketplace-flow") {
			await appendUpdateLog(env, now, "skipped", { kind: "marketplace-flow" });
			await writeState(statePath, { ...state, lastCheckedAt: now, lastStatus: "success" });
			notices.push(MARKETPLACE_FLOW_NOTICE);
			return { started: false, reason: plan.reason, notices };
		}
		await appendUpdateLog(env, now, "skipped", { reason: plan.reason });
		if (plan.reason === "up-to-date") {
			await writeState(statePath, { ...state, lastCheckedAt: now, lastStatus: "success" });
		}
		return { started: false, reason: plan.reason, notices };
	}

	const lockStaleMs = parsePositiveInteger(env.LAZYCODEX_AUTO_UPDATE_LOCK_STALE_MS, DEFAULT_LOCK_STALE_MS);
	const lock = await acquireLock(resolveLockPath(env, statePath), now, lockStaleMs);
	if (lock === null) {
		await appendUpdateLog(env, now, "locked");
		return { started: false, reason: "locked", notices };
	}
	try {
		await appendUpdateLog(env, now, "started", { command: plan.command, args: plan.args });
		const pendingNotice = { fromVersion: plan.currentVersion, toVersion: plan.latestVersion, startedAt: now };
		if (env.LAZYCODEX_AUTO_UPDATE_WAIT === "1") {
			const invocation = resolveSpawnInvocation(plan.command, plan.args);
			const result = spawnSync(invocation.command, invocation.args, {
				env: plan.env,
				stdio: "ignore",
			});
			const status = result.status ?? (result.error === undefined ? 0 : 1);
			await appendUpdateLog(env, now, "finished", { status });
			if (status === 0) {
				await writeState(statePath, { lastCheckedAt: now, lastAttemptedAt: now, lastStatus: "success", pendingNotice });
				await recordUpdateStartedNotice({ env, now, notices, pendingNotice });
			} else {
				await writeState(statePath, { lastAttemptedAt: now, lastStatus: "failed" });
			}
			return { started: true, status, notices };
		}

		const invocation = resolveSpawnInvocation(plan.command, plan.args);
		const child = spawn(invocation.command, invocation.args, {
			env: plan.env,
			stdio: "ignore",
			detached: true,
		});
		await writeState(statePath, { lastAttemptedAt: now, lastStatus: "started", pendingNotice });
		await recordUpdateStartedNotice({ env, now, notices, pendingNotice });
		child.unref();
		return { started: true, notices };
	} finally {
		await lock.release();
	}
}

async function settlePendingNotice({ env, now, statePath, state, notices }) {
	const pendingNotice = state.pendingNotice;
	if (pendingNotice === undefined) return state;
	const current = parseVersion(resolveCurrentVersion(env));
	const target = parseVersion(pendingNotice.toVersion);
	if (current !== null && target !== null && compareVersions(current, target) < 0) return state;
	const nextState = { ...state };
	delete nextState.pendingNotice;
	await writeState(statePath, nextState);
	if (current !== null && target !== null) {
		notices.push(`[LazyCodex] Auto-update completed: v${pendingNotice.fromVersion} -> v${pendingNotice.toVersion}. This session is already running the new version. Tell the user the auto-update was applied.`);
		await appendUpdateLog(env, now, "notified", {
			kind: "update-completed",
			fromVersion: pendingNotice.fromVersion,
			toVersion: pendingNotice.toVersion,
		});
	}
	return nextState;
}

async function recordUpdateStartedNotice({ env, now, notices, pendingNotice }) {
	notices.push(`[LazyCodex] Auto-update started in the background: v${pendingNotice.fromVersion} -> v${pendingNotice.toVersion}. Tell the user a new LazyCodex version is installing and that they should start a new Codex session after it completes to apply it.`);
	await appendUpdateLog(env, now, "notified", {
		kind: "update-started",
		fromVersion: pendingNotice.fromVersion,
		toVersion: pendingNotice.toVersion,
	});
}

async function runConfigMigration({ env }) {
	if (env.LAZYCODEX_CONFIG_MIGRATION_DISABLED === "1" || env.OMO_CODEX_CONFIG_MIGRATION_DISABLED === "1") return;
	try {
		await migrateOmoSotConfig({ env, seed: true });
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

function detectAutoUpdateInstallFlow(env) {
	return detectInstallFlow({ pluginRoot: resolveAutoUpdatePluginRoot(env), env });
}

function resolveAutoUpdatePluginRoot(env) {
	if (env.PLUGIN_ROOT?.trim()) return env.PLUGIN_ROOT.trim();
	return dirname(dirname(fileURLToPath(import.meta.url)));
}

function resolveCurrentVersion(env) {
	if (env.LAZYCODEX_CURRENT_VERSION?.trim()) return env.LAZYCODEX_CURRENT_VERSION.trim();
	const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
	return (
		readVersionManifest(resolveInstallSnapshotPath(env, pluginRoot)) ??
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
	runAutoUpdateCheck()
		.then(({ notices }) => {
			if (notices.length === 0) return;
			console.log(JSON.stringify({
				hookSpecificOutput: {
					hookEventName: "SessionStart",
					additionalContext: notices.join("\n\n"),
				},
			}));
		})
		.catch((error) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(0);
		});
}
