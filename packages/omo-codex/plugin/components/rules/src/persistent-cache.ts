import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
	type PostCompactPendingKind,
	type PostCompactPendingState,
	postCompactKindState,
	postCompactPendingKinds,
	postCompactRecoveringKinds,
} from "./post-compact-state.js";
import type { Engine } from "@oh-my-opencode/rules-engine/engine";
import { SESSION_STATE_LOCK_CONTENDED, withSessionStateLock } from "./session-state-lock.js";

export type PostCompactClaimResult = "claimed" | "not-pending" | "contended";

interface SerializedSessionState {
	staticDedup: string[];
	dynamicDedup: Record<string, string[]>;
	dynamicTargetFingerprints?: Record<string, string>;
	postCompactPending?: PostCompactPendingState;
	postCompactRecovering?: PostCompactPendingState;
	compacted?: boolean;
}

export function hydrateEngineState(engine: Engine, cachePath: string): void {
	const state = readSessionState(cachePath);
	engine.state.staticDedup.clear();
	engine.state.dynamicDedup.clear();
	engine.state.dynamicTargetFingerprints.clear();

	for (const key of state.staticDedup) {
		engine.state.staticDedup.add(key);
	}
	for (const [scope, keys] of Object.entries(state.dynamicDedup)) {
		engine.state.dynamicDedup.set(scope, new Set(keys));
	}
	for (const [targetKey, fingerprint] of Object.entries(state.dynamicTargetFingerprints ?? {})) {
		engine.state.dynamicTargetFingerprints.set(targetKey, fingerprint);
	}
}

export function persistEngineState(
	engine: Engine,
	cachePath: string,
	completedPostCompactKind?: PostCompactPendingKind,
): void {
	const currentState = readSessionState(cachePath);
	const dynamicDedup: Record<string, string[]> = {};
	for (const [scope, keys] of engine.state.dynamicDedup.entries()) {
		dynamicDedup[scope] = [...keys];
	}

	const postCompactPending = nextPostCompactPending(currentState, completedPostCompactKind);
	const postCompactRecovering = nextPostCompactRecovering(currentState, completedPostCompactKind);
	writeSessionState(cachePath, {
		staticDedup: [...engine.state.staticDedup],
		dynamicDedup,
		dynamicTargetFingerprints: Object.fromEntries(engine.state.dynamicTargetFingerprints.entries()),
		...(postCompactPending === undefined ? {} : { postCompactPending }),
		...(postCompactRecovering === undefined ? {} : { postCompactRecovering }),
	});
}

export function clearSessionState(cachePath: string): void {
	rmSync(cachePath, { force: true });
}

export function markSessionCompacted(cachePath: string): void {
	const state = readSessionState(cachePath);
	// Compaction drops injected static rule bodies, so pre-compaction static
	// dedup marks must not suppress the post-compact recovery directive.
	// Dynamic dedup survives: those rules are recovered as read-directive paths.
	writeSessionState(cachePath, {
		staticDedup: [],
		dynamicDedup: state.dynamicDedup,
		...(state.dynamicTargetFingerprints === undefined
			? {}
			: { dynamicTargetFingerprints: state.dynamicTargetFingerprints }),
		postCompactPending: { static: true, dynamic: true },
	});
}

export function hasPostCompactPending(cachePath: string): boolean {
	const state = readSessionState(cachePath);
	return postCompactPendingKinds(state).size > 0 || postCompactRecoveringKinds(state).size > 0;
}

export function isPostCompactPending(cachePath: string, kind: PostCompactPendingKind): boolean {
	return postCompactPendingKinds(readSessionState(cachePath)).has(kind);
}

export function claimPostCompactPending(cachePath: string, kind: PostCompactPendingKind): PostCompactClaimResult {
	const result = withSessionStateLock(cachePath, () => {
		const state = readSessionState(cachePath);
		const pendingKinds = postCompactPendingKinds(state);
		if (!pendingKinds.has(kind)) {
			return "not-pending";
		}

		pendingKinds.delete(kind);
		const recoveringKinds = postCompactRecoveringKinds(state);
		recoveringKinds.add(kind);
		writeSessionState(cachePath, stateWithPostCompactKinds(state, pendingKinds, recoveringKinds));
		return "claimed";
	});
	return result === SESSION_STATE_LOCK_CONTENDED ? "contended" : result;
}

export function isPostCompactRecoveryInProgress(cachePath: string, kind: PostCompactPendingKind): boolean {
	return postCompactRecoveringKinds(readSessionState(cachePath)).has(kind);
}

export function completePostCompactRecovery(cachePath: string, kind: PostCompactPendingKind): void {
	withSessionStateLock(cachePath, () => {
		const state = readSessionState(cachePath);
		const pendingKinds = postCompactPendingKinds(state);
		const recoveringKinds = postCompactRecoveringKinds(state);
		recoveringKinds.delete(kind);
		writeSessionState(cachePath, stateWithPostCompactKinds(state, pendingKinds, recoveringKinds));
	});
}

export function sessionCachePath(sessionId: string, pluginDataRoot: string | undefined): string {
	const root = pluginDataRoot ?? process.env["PLUGIN_DATA"] ?? join(homedir(), ".codex", "codex-rules");
	return join(root, "sessions", `${safePathSegment(sessionId)}.json`);
}

function readSessionState(cachePath: string): SerializedSessionState {
	try {
		const parsed = JSON.parse(readFileSync(cachePath, "utf8"));
		if (!isSerializedSessionState(parsed)) return emptyState();
		return parsed;
	} catch {
		return emptyState();
	}
}

function writeSessionState(cachePath: string, state: SerializedSessionState): void {
	mkdirSync(dirname(cachePath), { recursive: true });
	writeFileSync(cachePath, `${JSON.stringify(state)}\n`);
}

function emptyState(): SerializedSessionState {
	return { staticDedup: [], dynamicDedup: {}, dynamicTargetFingerprints: {} };
}

function nextPostCompactPending(
	state: SerializedSessionState,
	completedKind: PostCompactPendingKind | undefined,
): PostCompactPendingState | undefined {
	const pendingKinds = postCompactPendingKinds(state);
	if (completedKind !== undefined) {
		pendingKinds.delete(completedKind);
	}

	if (pendingKinds.size === 0) {
		return undefined;
	}

	return {
		...(pendingKinds.has("static") ? { static: true } : {}),
		...(pendingKinds.has("dynamic") ? { dynamic: true } : {}),
	};
}

function nextPostCompactRecovering(
	state: SerializedSessionState,
	completedKind: PostCompactPendingKind | undefined,
): PostCompactPendingState | undefined {
	const recoveringKinds = postCompactRecoveringKinds(state);
	if (completedKind !== undefined) {
		recoveringKinds.delete(completedKind);
	}

	return postCompactKindState(recoveringKinds);
}

function stateWithPostCompactKinds(
	state: SerializedSessionState,
	pendingKinds: ReadonlySet<PostCompactPendingKind>,
	recoveringKinds: ReadonlySet<PostCompactPendingKind>,
): SerializedSessionState {
	const postCompactPending = postCompactKindState(pendingKinds);
	const postCompactRecovering = postCompactKindState(recoveringKinds);
	return {
		staticDedup: state.staticDedup,
		dynamicDedup: state.dynamicDedup,
		...(state.dynamicTargetFingerprints === undefined
			? {}
			: { dynamicTargetFingerprints: state.dynamicTargetFingerprints }),
		...(postCompactPending === undefined ? {} : { postCompactPending }),
		...(postCompactRecovering === undefined ? {} : { postCompactRecovering }),
	};
}

function safePathSegment(value: string): string {
	return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "unknown-session";
}

function isSerializedSessionState(value: unknown): value is SerializedSessionState {
	if (!isRecord(value) || !Array.isArray(value["staticDedup"]) || !isRecord(value["dynamicDedup"])) {
		return false;
	}
	const staticDedup = value["staticDedup"];
	const dynamicDedup = value["dynamicDedup"];
	const dynamicTargetFingerprints = value["dynamicTargetFingerprints"];
	const postCompactPending = value["postCompactPending"];
	const postCompactRecovering = value["postCompactRecovering"];
	const compacted = value["compacted"];
	return (
		staticDedup.every((item) => typeof item === "string") &&
		Object.values(dynamicDedup).every(
			(item) => Array.isArray(item) && item.every((nestedItem) => typeof nestedItem === "string"),
		) &&
		(dynamicTargetFingerprints === undefined ||
			(isRecord(dynamicTargetFingerprints) &&
				Object.entries(dynamicTargetFingerprints).every(
					([targetKey, fingerprint]) => typeof targetKey === "string" && typeof fingerprint === "string",
				))) &&
		(postCompactPending === undefined || isPostCompactPendingState(postCompactPending)) &&
		(postCompactRecovering === undefined || isPostCompactPendingState(postCompactRecovering)) &&
		(compacted === undefined || typeof compacted === "boolean")
	);
}

function isPostCompactPendingState(value: unknown): value is PostCompactPendingState {
	return (
		isRecord(value) &&
		(value["static"] === undefined || typeof value["static"] === "boolean") &&
		(value["dynamic"] === undefined || typeof value["dynamic"] === "boolean")
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
