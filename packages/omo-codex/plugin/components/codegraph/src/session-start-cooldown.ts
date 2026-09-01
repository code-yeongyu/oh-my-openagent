import { mkdirSync, readFileSync, rmSync } from "node:fs";

import { writeFileAtomically } from "../../../../../utils/src/atomic-write.ts";
import { resolveSessionStartStatePaths, stateParent } from "./session-start-paths.js";

export const DEFAULT_SESSION_START_COOLDOWN_MS = 15 * 60 * 1_000;
export const MAX_SESSION_START_COOLDOWN_MS = 24 * 60 * 60 * 1_000;

export type SessionStartFailureAction =
	| "failed"
	| "skipped-probe-error"
	| "skipped-status"
	| "skipped-unavailable"
	| "skipped-unsupported-node"
	| "spawn-failed"
	| "stale-lock"
	| "timeout";

export interface SessionStartCooldownState {
	readonly action: SessionStartFailureAction;
	readonly cooldownUntil: number;
	readonly failureCount: number;
	readonly lastFailureAt: number;
	readonly projectRoot: string;
	readonly version: 1;
}

export type SessionStartCooldownDecision =
	| { readonly cooldownUntil: number; readonly failureCount: number; readonly kind: "active" }
	| { readonly failureCount: number; readonly kind: "inactive" }
	| { readonly kind: "inconclusive"; readonly reason: string };

export interface SessionStartCooldownOptions {
	readonly baseCooldownMs: number;
	readonly homeDir: string;
	readonly maxCooldownMs?: number;
	readonly nowMs: number;
	readonly projectRoot: string;
}

export function readSessionStartCooldown(options: SessionStartCooldownOptions): SessionStartCooldownDecision {
	const paths = resolveSessionStartStatePaths(options.homeDir, options.projectRoot);
	const state = readCooldownState(paths.cooldownPath, paths.canonicalProjectRoot);
	if (state.kind === "inconclusive") return state;
	if (state.kind === "missing") return { failureCount: 0, kind: "inactive" };
	const cooldownUntil = state.value.lastFailureAt + cooldownDuration(
		options.baseCooldownMs,
		state.value.failureCount,
		options.maxCooldownMs ?? MAX_SESSION_START_COOLDOWN_MS,
	);
	return options.nowMs < cooldownUntil
		? { cooldownUntil, failureCount: state.value.failureCount, kind: "active" }
		: { failureCount: state.value.failureCount, kind: "inactive" };
}

export function recordSessionStartFailure(
	options: SessionStartCooldownOptions & { readonly action: SessionStartFailureAction },
): SessionStartCooldownState {
	const paths = resolveSessionStartStatePaths(options.homeDir, options.projectRoot);
	const existing = readCooldownState(paths.cooldownPath, paths.canonicalProjectRoot);
	const failureCount = existing.kind === "present" ? existing.value.failureCount + 1 : 1;
	const cooldownUntil = options.nowMs + cooldownDuration(
		options.baseCooldownMs,
		failureCount,
		options.maxCooldownMs ?? MAX_SESSION_START_COOLDOWN_MS,
	);
	const state: SessionStartCooldownState = {
		action: options.action,
		cooldownUntil,
		failureCount,
		lastFailureAt: options.nowMs,
		projectRoot: paths.canonicalProjectRoot,
		version: 1,
	};
	mkdirSync(stateParent(paths.cooldownPath), { recursive: true });
	writeFileAtomically(paths.cooldownPath, `${JSON.stringify(state)}\n`);
	return state;
}

export function clearSessionStartCooldown(options: { readonly homeDir: string; readonly projectRoot: string }): void {
	const path = resolveSessionStartStatePaths(options.homeDir, options.projectRoot).cooldownPath;
	rmSync(path, { force: true });
}

function cooldownDuration(baseCooldownMs: number, failureCount: number, maxCooldownMs: number): number {
	let duration = Math.min(baseCooldownMs, maxCooldownMs);
	for (let attempt = 1; attempt < failureCount && duration < maxCooldownMs; attempt += 1) {
		duration = Math.min(duration * 2, maxCooldownMs);
	}
	return duration;
}

type CooldownReadResult =
	| { readonly kind: "inconclusive"; readonly reason: string }
	| { readonly kind: "missing" }
	| { readonly kind: "present"; readonly value: SessionStartCooldownState };

function readCooldownState(path: string, projectRoot: string): CooldownReadResult {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		const state = parseCooldownState(parsed, projectRoot);
		return state === null
			? { kind: "inconclusive", reason: "cooldown state is invalid" }
			: { kind: "present", value: state };
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		if (errorCode(error) === "ENOENT") return { kind: "missing" };
		return { kind: "inconclusive", reason: error.message };
	}
}

function parseCooldownState(value: unknown, projectRoot: string): SessionStartCooldownState | null {
	if (typeof value !== "object" || value === null) return null;
	const action = Reflect.get(value, "action");
	const cooldownUntil = Reflect.get(value, "cooldownUntil");
	const failureCount = Reflect.get(value, "failureCount");
	const lastFailureAt = Reflect.get(value, "lastFailureAt");
	const recordedRoot = Reflect.get(value, "projectRoot");
	const version = Reflect.get(value, "version");
	if (!isFailureAction(action)) return null;
	if (typeof cooldownUntil !== "number" || !Number.isFinite(cooldownUntil)) return null;
	if (typeof failureCount !== "number" || !Number.isInteger(failureCount) || failureCount < 1) return null;
	if (typeof lastFailureAt !== "number" || !Number.isFinite(lastFailureAt)) return null;
	if (recordedRoot !== projectRoot || version !== 1) return null;
	return { action, cooldownUntil, failureCount, lastFailureAt, projectRoot: recordedRoot, version };
}

function isFailureAction(value: unknown): value is SessionStartFailureAction {
	return typeof value === "string" && [
		"failed",
		"skipped-probe-error",
		"skipped-status",
		"skipped-unavailable",
		"skipped-unsupported-node",
		"spawn-failed",
		"stale-lock",
		"timeout",
	].includes(value);
}

function errorCode(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null) return undefined;
	const code = Reflect.get(error, "code");
	return typeof code === "string" ? code : undefined;
}
