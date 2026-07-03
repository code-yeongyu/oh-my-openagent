import type { CompactionReason } from "../../types.ts";
import type { CompactionExtensionState } from "./state.ts";

export const softCap = 3;
export const hardCap = 10;

export interface ShouldRejectByCapOptions {
	manual?: boolean;
	reason?: CompactionReason;
}

export function incrementAccepted(state: CompactionExtensionState): CompactionExtensionState {
	return {
		...state,
		acceptedThisTurn: state.acceptedThisTurn + 1,
		acceptedAbsolute: state.acceptedAbsolute + 1,
	};
}

export function isOverSoftCap(state: CompactionExtensionState): boolean {
	return state.acceptedThisTurn >= softCap;
}

export function isOverHardCap(state: CompactionExtensionState): boolean {
	return state.acceptedAbsolute >= hardCap;
}

export function shouldRejectByCap(
	state: CompactionExtensionState,
	opts?: ShouldRejectByCapOptions,
): { cancel: boolean } {
	const bypass = opts?.manual === true || opts?.reason === "manual" || opts?.reason === "extension";
	if (bypass) {
		return { cancel: isOverHardCap(state) };
	}
	if (isOverSoftCap(state)) {
		return { cancel: true };
	}
	return { cancel: false };
}
