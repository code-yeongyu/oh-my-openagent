import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { Engine } from "./rules/engine.js";

export type PostCompactPendingKind = "static" | "dynamic";

interface PostCompactPendingState {
	static?: boolean;
	dynamic?: boolean;
}

interface SerializedSessionState {
	staticDedup: string[];
	dynamicDedup: Record<string, string[]>;
	dynamicTargetFingerprints?: Record<string, string>;
	postCompactPending?: PostCompactPendingState;
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
	writeSessionState(cachePath, {
		staticDedup: [...engine.state.staticDedup],
		dynamicDedup,
		dynamicTargetFingerprints: Object.fromEntries(engine.state.dynamicTargetFingerprints.entries()),
		...(postCompactPending === undefined ? {} : { postCompactPending }),
	});
}

export function clearSessionState(cachePath: string): void {
	rmSync(cachePath, { force: true });
}

export function markSessionCompacted(cachePath: string): void {
	writeSessionState(cachePath, { ...emptyState(), postCompactPending: { static: true, dynamic: true } });
}

export function hasPostCompactPending(cachePath: string): boolean {
	return postCompactPendingKinds(readSessionState(cachePath)).size > 0;
}

export function isPostCompactPending(cachePath: string, kind: PostCompactPendingKind): boolean {
	return postCompactPendingKinds(readSessionState(cachePath)).has(kind);
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

function postCompactPendingKinds(state: SerializedSessionState): Set<PostCompactPendingKind> {
	const pendingKinds = new Set<PostCompactPendingKind>();
	if (state.compacted === true || state.postCompactPending?.static === true) {
		pendingKinds.add("static");
	}
	if (state.compacted === true || state.postCompactPending?.dynamic === true) {
		pendingKinds.add("dynamic");
	}
	return pendingKinds;
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
