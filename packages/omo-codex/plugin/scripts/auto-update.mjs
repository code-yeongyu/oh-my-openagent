#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { migrateCodexConfig } from "./migrate-codex-config.mjs";

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_LOCK_STALE_MS = 10 * 60 * 1_000;

export function resolveAutoUpdatePlan({ env = process.env, now = Date.now(), lastCheckedAt } = {}) {
	if (env.LAZYCODEX_AUTO_UPDATE_DISABLED === "1" || env.OMO_CODEX_AUTO_UPDATE_DISABLED === "1") {
		return { shouldRun: false, reason: "disabled" };
	}

	const intervalMs = parsePositiveInteger(env.LAZYCODEX_AUTO_UPDATE_INTERVAL_MS, DEFAULT_INTERVAL_MS);
	if (typeof lastCheckedAt === "number" && intervalMs > 0 && now - lastCheckedAt < intervalMs) {
		return { shouldRun: false, reason: "throttled" };
	}

	return {
		shouldRun: true,
		command: resolveCommand(env),
		args: resolveArgs(env),
		env: {
			...env,
			LAZYCODEX_AUTO_UPDATE_DISABLED: "1",
			OMO_CODEX_AUTO_UPDATE_DISABLED: "1",
		},
	};
}

export async function runAutoUpdateCheck({ env = process.env, now = Date.now() } = {}) {
	await runConfigMigration({ env });
	const statePath = resolveStatePath(env);
	const state = await readState(statePath);
	const plan = resolveAutoUpdatePlan({ env, now, lastCheckedAt: state.lastCheckedAt });
	if (!plan.shouldRun) return { started: false, reason: plan.reason };

	const lock = await acquireLock(resolveLockPath(env, statePath), now, env);
	if (lock === null) return { started: false, reason: "locked" };
	try {
		await writeState(statePath, { lastCheckedAt: now });
		if (env.LAZYCODEX_AUTO_UPDATE_WAIT === "1") {
			const result = spawnSync(plan.command, plan.args, {
				env: plan.env,
				stdio: "ignore",
			});
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
	return env.LAZYCODEX_AUTO_UPDATE_COMMAND?.trim() || "npx";
}

function resolveArgs(env) {
	if (env.LAZYCODEX_AUTO_UPDATE_ARGS_JSON) {
		const parsed = JSON.parse(env.LAZYCODEX_AUTO_UPDATE_ARGS_JSON);
		if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
			throw new TypeError("LAZYCODEX_AUTO_UPDATE_ARGS_JSON must be a JSON string array");
		}
		return parsed;
	}
	return ["--yes", "lazycodex-ai@latest", "install", "--no-tui", "--skip-auth"];
}

function resolveStatePath(env) {
	if (env.LAZYCODEX_AUTO_UPDATE_STATE_PATH?.trim()) return env.LAZYCODEX_AUTO_UPDATE_STATE_PATH;
	const dataRoot = env.PLUGIN_DATA?.trim() || join(homedir(), ".local", "share", "lazycodex");
	return join(dataRoot, "auto-update.json");
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
