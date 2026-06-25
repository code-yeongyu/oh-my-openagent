#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
	DEFAULT_LOCK_STALE_MS,
	acquireLock,
	appendUpdateLog,
	readState,
	resolveLockPath,
	resolveStatePath,
	writeState,
} from "./auto-update-state.mjs";
import {
	compareVersions,
	defaultRunCommandForManualUpdate,
	detectAutoUpdateInstallFlow,
	parsePositiveInteger,
	parseVersion,
	resolveArgs,
	resolveCommand,
	resolveCurrentVersion,
	resolveLatestVersion,
	resolveLazyCodexUpdatePlan,
} from "./auto-update-plan.mjs";
import { formatMarketplaceFlowNotice, formatUpdateStartedNotice, resolveReleaseNotes } from "./auto-update-release-notes.mjs";
import { migrateCodexConfig } from "./migrate-codex-config.mjs";
import { migrateOmoSotConfig } from "./migrate-omo-sot.mjs";
import { resolveSpawnInvocation } from "./spawn-command.mjs";

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_RETRY_INTERVAL_MS = 30 * 60 * 1_000;

export { resolveLazyCodexUpdatePlan };

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
	const migrationNotices = await runConfigMigration({ env });
	const statePath = resolveStatePath(env);
	const notices = [...migrationNotices];
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
			const updateContext = resolveUpdateContext({ env });
			const releaseNotes = updateContext.shouldUpdate
				? await resolveReleaseNotes({ env, latestVersion: updateContext.latestVersion })
				: undefined;
			notices.push(formatMarketplaceFlowNotice({ updateContext, releaseNotes }));
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
		const releaseNotes = await resolveReleaseNotes({ env, latestVersion: plan.latestVersion });
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
				await recordUpdateStartedNotice({ env, now, notices, pendingNotice, releaseNotes });
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
		await recordUpdateStartedNotice({ env, now, notices, pendingNotice, releaseNotes });
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

async function recordUpdateStartedNotice({ env, now, notices, pendingNotice, releaseNotes }) {
	notices.push(formatUpdateStartedNotice({ pendingNotice, releaseNotes }));
	await appendUpdateLog(env, now, "notified", {
		kind: "update-started",
		fromVersion: pendingNotice.fromVersion,
		toVersion: pendingNotice.toVersion,
	});
}

function resolveUpdateContext({ env }) {
	const currentVersion = resolveCurrentVersion(env);
	const latestVersion = resolveLatestVersion(env);
	const plan = resolveLazyCodexUpdatePlan({ currentVersion, latestVersion });
	return { currentVersion, latestVersion, shouldUpdate: plan.shouldUpdate };
}

async function runConfigMigration({ env }) {
	if (env.LAZYCODEX_CONFIG_MIGRATION_DISABLED === "1" || env.OMO_CODEX_CONFIG_MIGRATION_DISABLED === "1") return [];
	try {
		await migrateOmoSotConfig({ env, seed: true });
		const result = await migrateCodexConfig({ env });
		if (result.modeChanged.length === 0) return [];
		return [
			"[LazyCodex] Removed unsupported Codex root multi_agent_mode from config.toml. Tell the user LazyCodex cleaned up a stale OMO-managed setting so Codex uses its supported per-turn multiAgentMode API.",
		];
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		return [];
	}
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
