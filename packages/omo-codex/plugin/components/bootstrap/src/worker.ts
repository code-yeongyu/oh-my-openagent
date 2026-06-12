import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readState, writeState } from "../../../scripts/auto-update-state.mjs";
import { bootstrapLocks, resolveBootstrapStatePath, resolveCodexHome } from "./environment.ts";
import { runSgProvision } from "./provision.ts";
import type { SgProvisionSeams } from "./provision.ts";
import { runWorkerSetup } from "./setup.ts";

export const BOOTSTRAP_DOCTOR_HINT = "npx lazycodex-ai doctor";

export type BootstrapRunStatus = "success" | "degraded";

export interface BootstrapDegradedEntry {
	readonly component: string;
	readonly reason: string;
	readonly hint?: string;
}

export interface BootstrapState {
	readonly completedForVersion?: string;
	readonly lastAttemptAt?: number;
	readonly lastStatus?: BootstrapRunStatus;
	readonly degraded?: readonly BootstrapDegradedEntry[];
}

export interface BootstrapWorkerFlags {
	readonly codexHome?: string;
	readonly manifestDir?: string;
	readonly once: boolean;
	readonly only?: string;
}

export interface BootstrapWorkerContext {
	readonly codexHome: string;
	readonly env: Record<string, string | undefined>;
	readonly flags: BootstrapWorkerFlags;
	readonly now: number;
	readonly platform: NodeJS.Platform;
	readonly pluginData: string;
	readonly pluginRoot: string;
	readonly pluginVersion: string | undefined;
}

export interface BootstrapStepOutcome {
	readonly degraded: readonly BootstrapDegradedEntry[];
}

export interface BootstrapWorkerStep {
	readonly name: string;
	readonly run: (context: BootstrapWorkerContext) => Promise<BootstrapStepOutcome>;
}

export type BootstrapWorkerSkipReason = "locked" | "already-completed";

export type BootstrapWorkerResult =
	| { readonly ran: false; readonly reason: BootstrapWorkerSkipReason }
	| {
			readonly ran: true;
			readonly status: BootstrapRunStatus;
			readonly degraded: readonly BootstrapDegradedEntry[];
			readonly statePath: string;
	  };

export interface RunBootstrapWorkerOptions {
	readonly argv?: readonly string[];
	readonly env?: Record<string, string | undefined>;
	readonly now?: number;
	readonly platform?: NodeJS.Platform;
	readonly steps?: readonly BootstrapWorkerStep[];
}

export function parseWorkerFlags(argv: readonly string[]): BootstrapWorkerFlags {
	let codexHome: string | undefined;
	let manifestDir: string | undefined;
	let once = false;
	let only: string | undefined;
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		if (flag === "--once") {
			once = true;
			continue;
		}
		if (flag === "--codex-home") {
			codexHome = requireFlagValue(argv, index, flag);
			index += 1;
			continue;
		}
		if (flag === "--only") {
			only = requireFlagValue(argv, index, flag);
			index += 1;
			continue;
		}
		if (flag === "--manifest-dir") {
			manifestDir = requireFlagValue(argv, index, flag);
			index += 1;
			continue;
		}
		throw new Error(`unknown worker flag: ${flag}`);
	}
	return {
		once,
		...(codexHome === undefined ? {} : { codexHome }),
		...(manifestDir === undefined ? {} : { manifestDir }),
		...(only === undefined ? {} : { only }),
	};
}

export function resolvePluginDataRoot(env: Record<string, string | undefined>): string {
	const fromEnv = env["PLUGIN_DATA"]?.trim();
	if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
	return join(homedir(), ".local", "share", "lazycodex");
}

export async function readPluginVersion(pluginRoot: string): Promise<string | undefined> {
	try {
		const parsed: unknown = JSON.parse(await readFile(join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
		if (typeof parsed !== "object" || parsed === null) return undefined;
		const version = (parsed as Record<string, unknown>)["version"];
		if (typeof version !== "string") return undefined;
		const trimmed = version.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	} catch {
		return undefined;
	}
}

export async function readBootstrapState(statePath: string): Promise<BootstrapState> {
	return parseBootstrapState(await readState(statePath));
}

export function parseBootstrapState(raw: Record<string, unknown>): BootstrapState {
	const completedForVersion = typeof raw["completedForVersion"] === "string" ? raw["completedForVersion"] : undefined;
	const lastAttemptAt = typeof raw["lastAttemptAt"] === "number" ? raw["lastAttemptAt"] : undefined;
	const lastStatus = raw["lastStatus"] === "success" || raw["lastStatus"] === "degraded" ? raw["lastStatus"] : undefined;
	const degraded = parseDegradedEntries(raw["degraded"]);
	return {
		...(completedForVersion === undefined ? {} : { completedForVersion }),
		...(lastAttemptAt === undefined ? {} : { lastAttemptAt }),
		...(lastStatus === undefined ? {} : { lastStatus }),
		...(degraded === undefined ? {} : { degraded }),
	};
}

export interface DefaultWorkerStepsSeams {
	readonly sg?: SgProvisionSeams;
}

export function defaultWorkerSteps(seams: DefaultWorkerStepsSeams = {}): readonly BootstrapWorkerStep[] {
	return [
		{
			name: "setup",
			run: (context) => runWorkerSetup(context),
		},
		{
			name: "sg",
			run: (context) => runSgProvision(context, seams.sg),
		},
	];
}

export async function runBootstrapWorker(options: RunBootstrapWorkerOptions = {}): Promise<BootstrapWorkerResult> {
	const env = options.env ?? process.env;
	const now = options.now ?? Date.now();
	const platform = options.platform ?? process.platform;
	const flags = parseWorkerFlags(options.argv ?? []);
	const steps = options.steps ?? defaultWorkerSteps();
	const pluginRoot = resolvePluginRoot(env);
	const pluginData = resolvePluginDataRoot(env);
	const statePath = resolveBootstrapStatePath(pluginData);
	// Pin BOTH lock paths (bootstrap + auto-update) under the resolved plugin
	// data root even when PLUGIN_DATA is missing from the environment.
	const lockEnv = { ...env, PLUGIN_DATA: pluginData };

	const locks = await bootstrapLocks({ env: lockEnv, now, pluginData });
	if (locks === null) return { ran: false, reason: "locked" };
	try {
		const pluginVersion = await readPluginVersion(pluginRoot);
		const marker = await readBootstrapState(statePath);
		// TOCTOU re-check under lock: another worker may have completed between
		// the hook's unlocked read and this acquisition.
		if (!flags.once && pluginVersion !== undefined && marker.completedForVersion === pluginVersion) {
			await appendBootstrapLog(pluginData, now, "worker-skipped", { reason: "already-completed", version: pluginVersion });
			return { ran: false, reason: "already-completed" };
		}

		const codexHome = flags.codexHome ?? (await resolveCodexHome({ env, pluginRoot })).path;
		const context: BootstrapWorkerContext = { codexHome, env, flags, now, platform, pluginData, pluginRoot, pluginVersion };
		await appendBootstrapLog(pluginData, now, "worker-started", { version: pluginVersion ?? "unknown" });

		const degraded: BootstrapDegradedEntry[] = [];
		if (pluginVersion === undefined) {
			degraded.push({
				component: "bootstrap",
				hint: BOOTSTRAP_DOCTOR_HINT,
				reason: `plugin version unresolved from ${join(pluginRoot, ".codex-plugin", "plugin.json")}`,
			});
		}
		for (const step of steps) {
			if (flags.only !== undefined && step.name !== flags.only) continue;
			degraded.push(...(await runStep(step, context)));
		}

		const status: BootstrapRunStatus = degraded.length === 0 ? "success" : "degraded";
		const state: BootstrapState = {
			...(pluginVersion === undefined ? {} : { completedForVersion: pluginVersion }),
			degraded,
			lastAttemptAt: now,
			lastStatus: status,
		};
		await writeState(statePath, state);
		await appendBootstrapLog(pluginData, now, "worker-finished", { degradedCount: degraded.length, status });
		return { degraded, ran: true, statePath, status };
	} finally {
		await locks.release();
	}
}

async function runStep(step: BootstrapWorkerStep, context: BootstrapWorkerContext): Promise<readonly BootstrapDegradedEntry[]> {
	try {
		return (await step.run(context)).degraded;
	} catch (error) {
		return [
			{
				component: step.name,
				hint: BOOTSTRAP_DOCTOR_HINT,
				reason: error instanceof Error ? error.message : String(error),
			},
		];
	}
}

function resolvePluginRoot(env: Record<string, string | undefined>): string {
	const fromEnv = env["PLUGIN_ROOT"]?.trim();
	if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
	// dist/cli.js lives at <pluginRoot>/components/bootstrap/dist/cli.js.
	return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

export async function appendBootstrapLog(
	pluginData: string,
	now: number,
	event: string,
	details: Record<string, unknown>,
): Promise<void> {
	try {
		const logPath = join(pluginData, "bootstrap", "bootstrap.log");
		await mkdir(dirname(logPath), { recursive: true });
		await appendFile(logPath, `${JSON.stringify({ timestamp: new Date(now).toISOString(), event, ...details })}\n`);
	} catch {
		// Logging must never fail the worker.
	}
}

function parseDegradedEntries(raw: unknown): readonly BootstrapDegradedEntry[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const entries: BootstrapDegradedEntry[] = [];
	for (const candidate of raw) {
		if (typeof candidate !== "object" || candidate === null) continue;
		const record = candidate as Record<string, unknown>;
		if (typeof record["component"] !== "string" || typeof record["reason"] !== "string") continue;
		entries.push({
			component: record["component"],
			reason: record["reason"],
			...(typeof record["hint"] === "string" ? { hint: record["hint"] } : {}),
		});
	}
	return entries;
}

function requireFlagValue(argv: readonly string[], index: number, flag: string): string {
	const value = argv[index + 1];
	if (value === undefined || value.startsWith("--")) {
		throw new Error(`${flag} requires a value`);
	}
	return value;
}
