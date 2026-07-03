import type { CompactionSettings } from "../../../compaction/index.ts";
import type { ContextUsage } from "../../types.ts";

const MIN_ADAPTIVE_THRESHOLD_RATIO = 0.4;
const MAX_ADAPTIVE_THRESHOLD_RATIO = 0.7;
const HIGH_YIELD_SAVING_RATIO = 0.5;
const LOW_YIELD_SAVING_RATIO = 0.1;
const YIELD_ADJUSTMENT_RATIO = 0.05;
const MIN_EFFECTIVE_KEEP_RECENT_TOKENS = 1024;

export const SPECULATIVE_FRACTION = 0.75;

export interface CompactionYield {
	savedTokens: number;
	tokensBefore: number;
}

function clampThresholdRatio(ratio: number): number {
	return Math.min(MAX_ADAPTIVE_THRESHOLD_RATIO, Math.max(MIN_ADAPTIVE_THRESHOLD_RATIO, ratio));
}

function adjustThresholdRatio(ratio: number, savedTokens: number, tokensBefore: number): number {
	if (tokensBefore <= 0) {
		return ratio;
	}

	const savedRatio = savedTokens / tokensBefore;
	if (savedRatio > HIGH_YIELD_SAVING_RATIO) {
		return clampThresholdRatio(ratio - YIELD_ADJUSTMENT_RATIO);
	}
	if (savedRatio < LOW_YIELD_SAVING_RATIO) {
		return clampThresholdRatio(ratio + YIELD_ADJUSTMENT_RATIO);
	}
	return ratio;
}

function adjustEffectiveThresholdRatio(ratio: number, savedTokens: number, tokensBefore: number): number {
	if (tokensBefore <= 0) {
		return ratio;
	}

	const savedRatio = savedTokens / tokensBefore;
	if (savedRatio > HIGH_YIELD_SAVING_RATIO) {
		return ratio - YIELD_ADJUSTMENT_RATIO;
	}
	if (savedRatio < LOW_YIELD_SAVING_RATIO) {
		return ratio + YIELD_ADJUSTMENT_RATIO;
	}
	return ratio;
}

export function computeAdaptiveThresholdRatio(contextWindow: number, priorCompactionSavedTokens?: number): number {
	let ratio: number;
	if (!(contextWindow > 0)) {
		ratio = 0.5;
	} else if (contextWindow <= 16_000) {
		ratio = 0.45;
	} else if (contextWindow <= 32_000) {
		ratio = 0.5;
	} else if (contextWindow <= 64_000) {
		ratio = 0.55;
	} else if (contextWindow <= 128_000) {
		ratio = 0.6;
	} else {
		ratio = 0.65;
	}

	if (priorCompactionSavedTokens === undefined) {
		return ratio;
	}

	return adjustThresholdRatio(ratio, priorCompactionSavedTokens, contextWindow);
}

export function computeEffectiveThreshold(contextWindow: number, lastYield?: CompactionYield | number): number {
	if (typeof lastYield === "number") {
		return Math.max(contextWindow, lastYield);
	}

	let ratio = computeAdaptiveThresholdRatio(contextWindow);
	if (lastYield) {
		ratio = adjustEffectiveThresholdRatio(ratio, lastYield.savedTokens, lastYield.tokensBefore);
	}
	return clampThresholdRatio(ratio);
}

export function computeEffectiveKeepRecentTokens(
	setting: number,
	contextWindow: number,
	thresholdRatio: number,
	margin = 0.05,
): number {
	const capped = Math.floor(contextWindow * (1 - thresholdRatio - margin));
	return Math.min(setting, Math.max(MIN_EFFECTIVE_KEEP_RECENT_TOKENS, capped));
}

export function shouldStartSpeculativeCompaction(
	usage: ContextUsage,
	contextWindow: number,
	settings: CompactionSettings,
	lastYield?: CompactionYield,
): boolean {
	if (settings.speculativeEnabled === false || usage.tokens === null || contextWindow <= 0) {
		return false;
	}

	const fraction = settings.speculativeFraction ?? SPECULATIVE_FRACTION;
	return usage.tokens >= contextWindow * computeEffectiveThreshold(contextWindow, lastYield) * fraction;
}

export function isAtHardLimit(
	usage: ContextUsage,
	contextWindow: number,
	reserveTokens: number,
	additionalTokens = 0,
): boolean {
	return usage.tokens !== null && usage.tokens + additionalTokens + reserveTokens >= contextWindow;
}

export function shouldTriggerCompaction(
	usage: ContextUsage,
	contextWindow: number,
	settings: CompactionSettings,
	lastYield?: CompactionYield,
): boolean {
	if (!settings.enabled || usage.tokens === null || contextWindow <= 0) {
		return false;
	}

	return usage.tokens >= contextWindow * computeEffectiveThreshold(contextWindow, lastYield);
}
