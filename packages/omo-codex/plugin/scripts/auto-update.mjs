#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { appendFile, mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { migrateCodexConfig } from "./migrate-codex-config.mjs";

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_LOCK_STALE_MS = 10 * 60 * 1_000;
const DEFAULT_UPDATE_COMMAND = "npx";
const DEFAULT_UPDATE_ARGS = ["--yes", "lazycodex-ai@latest", "install", "--no-tui", "--skip-auth"];

export function resolveAutoUpdatePlan({ env = process.env, now = Date.now(), lastCheckedAt } = {}) {
	if (env.LAZYCODEX_AUTO_UPDATE_DISABLED === "1" || env.OMO_CODEX_AUTO_UPDATE_DISABLED === "1") {
		return { shouldRun: false, reason: "disabled" };
	}

	const intervalMs = parsePositiveInteger(env.LAZYCODEX_AUTO_UPDATE_INTERVAL_MS, DEFAULT_INTERVAL_MS);
	if (typeof lastCheckedAt === "number" && intervalMs > 0 && now - lastCheckedAt < intervalMs) {
		return { shouldRun: false, reason: "throttled" };
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
	const plan = resolveAutoUpdatePlan({ env, now, lastCheckedAt: state.lastCheckedAt });
	if (!plan.shouldRun) return { started: false, reason: plan.reason };

	const lock = await acquireLock(resolveLockPath(env, statePath), now, env);
	if (lock === null) {
		await appendUpdateLog(env, now, "locked");
		return { started: false, reason: "locked" };
	}
	try {
		await writeState(statePath, { lastCheckedAt: now });
		await appendUpdateLog(env, now, "started", { command: plan.command, args: plan.args });
		if (env.LAZYCODEX_AUTO_UPDATE_WAIT === "1") {
			const result = spawnSync(plan.command, plan.args, {
				env: plan.env,
				stdio: "ignore",
			});
			await appendUpdateLog(env, now, "finished", { status: result.status ?? 0 });
			return { started: true, status: result.status ?? 0 };
		}

		const child = spawn(plan.command, plan.args, {
			env: plan.env,
			stdio: "ignore",
			detached: true,
		});
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
	try {
		const raw = spawnSync("node", ["-e", "const fs=require('node:fs'); const path=require('node:path'); const p=path.resolve(process.cwd(), '.codex-plugin/plugin.json'); process.stdout.write(JSON.parse(fs.readFileSync(p, 'utf8')).version || '')"], {
			encoding: "utf8",
			cwd: dirname(dirname(fileURLToPath(import.meta.url))),
			stdio: ["ignore", "pipe", "ignore"],
		});
		const version = raw.stdout.trim();
		return version.length > 0 ? version : undefined;
	} catch (error) {
		if (error instanceof Error) return undefined;
		throw error;
	}
}

function resolveLatestVersion(env) {
	if (env.LAZYCODEX_LATEST_VERSION?.trim()) return env.LAZYCODEX_LATEST_VERSION.trim();
	const result = spawnSync("npm", ["view", "lazycodex-ai", "version", "--silent"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	if (result.status !== 0) return undefined;
	const version = result.stdout.trim();
	return version.length > 0 ? version : undefined;
}

function defaultRunCommandForManualUpdate(command, args, options) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
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

function resolveStatePath(env) {
	if (env.LAZYCODEX_AUTO_UPDATE_STATE_PATH?.trim()) return env.LAZYCODEX_AUTO_UPDATE_STATE_PATH;
	const dataRoot = env.PLUGIN_DATA?.trim() || join(homedir(), ".local", "share", "lazycodex");
	return join(dataRoot, "auto-update.json");
}

function resolveLogPath(env) {
	if (env.LAZYCODEX_AUTO_UPDATE_LOG_PATH?.trim()) return env.LAZYCODEX_AUTO_UPDATE_LOG_PATH;
	const dataRoot = env.PLUGIN_DATA?.trim() || join(homedir(), ".local", "share", "lazycodex");
	return join(dataRoot, "auto-update.log");
}

function resolveLockPath(env, statePath) {
	if (env.LAZYCODEX_AUTO_UPDATE_LOCK_PATH?.trim()) return env.LAZYCODEX_AUTO_UPDATE_LOCK_PATH;
	return `${statePath}.lock`;
}

async function acquireLock(lockPath, now, env) {
	await mkdir(dirname(lockPath), { recursive: true });
	const staleMs = parsePositiveInteger(env.LAZYCODEX_AUTO_UPDATE_LOCK_STALE_MS, DEFAULT_LOCK_STALE_MS);
	try {
		const handle = await open(lockPath, "wx");
		await handle.writeFile(`${now}\n`);
		await handle.close();
		return {
			release: () => rm(lockPath, { force: true }),
		};
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
		if (!(await removeStaleLock(lockPath, now, staleMs))) return null;
		return acquireLock(lockPath, now, { ...env, LAZYCODEX_AUTO_UPDATE_LOCK_STALE_MS: "0" });
	}
}

async function removeStaleLock(lockPath, now, staleMs) {
	if (staleMs <= 0) return false;
	try {
		const lockStat = await stat(lockPath);
		if (now - lockStat.mtimeMs < staleMs) return false;
		await rm(lockPath, { force: true });
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return true;
		throw error;
	}
}

async function readState(statePath) {
	try {
		const raw = await readFile(statePath, "utf8");
		const parsed = JSON.parse(raw);
		return typeof parsed === "object" && parsed !== null ? parsed : {};
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
		return {};
	}
}

async function writeState(statePath, state) {
	await mkdir(dirname(statePath), { recursive: true });
	await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

async function appendUpdateLog(env, now, event, details = {}) {
	const logPath = resolveLogPath(env);
	await mkdir(dirname(logPath), { recursive: true });
	const entry = {
		timestamp: new Date(now).toISOString(),
		event,
		...details,
	};
	await appendFile(logPath, `${JSON.stringify(entry)}\n`);
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
