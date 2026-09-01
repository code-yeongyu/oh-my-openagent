import type { LoadedRule, SessionState } from "./types.js";

const DYNAMIC_SESSION_KEY = "__pi-rules-session__";

export function createSessionState(cwd?: string): SessionState {
	return {
		cwd,
		staticDedup: new Set(),
		dynamicDedup: new Map(),
		dynamicTargetFingerprints: new Map(),
		loadedRules: [],
		diagnostics: [],
	};
}

export function staticDedupKey(cwd: string, rulePath: string, contentHash: string): string {
	return `${cwd}::${rulePath}::${contentHash}`;
}

export function dynamicDedupKey(rulePath: string, contentHash: string): string {
	return `${rulePath}::${contentHash}`;
}

export function markStaticInjected(state: SessionState, rule: LoadedRule): boolean {
	const key = staticDedupKey(state.cwd ?? "", rule.realPath, rule.contentHash);
	if (state.staticDedup.has(key)) {
		return false;
	}

	state.staticDedup.add(key);
	return true;
}

export function markDynamicInjected(state: SessionState, rule: LoadedRule): boolean {
	let keys = state.dynamicDedup.get(DYNAMIC_SESSION_KEY);
	if (keys === undefined) {
		keys = new Set();
		state.dynamicDedup.set(DYNAMIC_SESSION_KEY, keys);
	}

	const key = dynamicDedupKey(rule.realPath, rule.contentHash);
	if (keys.has(key)) {
		return false;
	}

	keys.add(key);
	return true;
}

export function isStaticInjected(state: SessionState, rule: LoadedRule): boolean {
	return state.staticDedup.has(staticDedupKey(state.cwd ?? "", rule.realPath, rule.contentHash));
}

export function isDynamicInjected(state: SessionState, rule: LoadedRule): boolean {
	return state.dynamicDedup.get(DYNAMIC_SESSION_KEY)?.has(dynamicDedupKey(rule.realPath, rule.contentHash)) === true;
}

export function clearSession(state: SessionState): void {
	state.staticDedup.clear();
	state.dynamicDedup.clear();
	state.dynamicTargetFingerprints.clear();
	state.loadedRules.length = 0;
	state.diagnostics.length = 0;
}
