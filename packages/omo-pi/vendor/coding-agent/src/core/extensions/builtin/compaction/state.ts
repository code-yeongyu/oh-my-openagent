import type { RestorationTrackerState } from "./restoration-tracker.ts";

export interface CompactionYieldSnapshot {
	savedTokens: number;
	tokensBefore: number;
}

export interface CompactionExtensionState {
	consecutiveFailures: number;
	trippedAt: number | null;
	acceptedThisTurn: number;
	acceptedAbsolute: number;
	lastYield: CompactionYieldSnapshot | null;
	turnId: string | null;
	restoration: RestorationTrackerState | null;
}

export function createInitialState(): CompactionExtensionState {
	return {
		consecutiveFailures: 0,
		trippedAt: null,
		acceptedThisTurn: 0,
		acceptedAbsolute: 0,
		lastYield: null,
		turnId: null,
		restoration: null,
	};
}

export function resetTurnCounter(state: CompactionExtensionState, turnId: string): CompactionExtensionState {
	return { ...state, acceptedThisTurn: 0, turnId };
}
