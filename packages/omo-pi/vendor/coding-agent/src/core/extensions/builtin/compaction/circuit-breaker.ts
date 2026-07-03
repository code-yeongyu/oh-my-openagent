import type { CompactionReason } from "../../types.ts";
import type { CompactionExtensionState } from "./state.ts";

export const FAILURE_TRIP_THRESHOLD = 3;
export const COOLDOWN_MS = 60_000;

export interface BreakerNotification {
	tripped: true;
	failureCount: number;
	trippedAt: number;
	reason: CompactionReason | "threshold";
}

export interface RecordFailureOptions {
	onTrip?: (notification: BreakerNotification) => void;
	route?: CompactionReason;
}

export interface ShouldBypassOptions {
	manual?: boolean;
	reason?: CompactionReason;
}

export function recordSuccess(state: CompactionExtensionState): CompactionExtensionState {
	return { ...state, consecutiveFailures: 0, trippedAt: null };
}

export function recordFailure(
	state: CompactionExtensionState,
	now: number,
	opts?: RecordFailureOptions,
): CompactionExtensionState {
	let working = state;
	if (working.trippedAt !== null && now >= working.trippedAt + COOLDOWN_MS) {
		working = { ...working, consecutiveFailures: 0, trippedAt: null };
	}
	const next: CompactionExtensionState = {
		...working,
		consecutiveFailures: working.consecutiveFailures + 1,
	};
	if (next.consecutiveFailures >= FAILURE_TRIP_THRESHOLD && next.trippedAt === null) {
		next.trippedAt = now;
		opts?.onTrip?.({
			tripped: true,
			failureCount: next.consecutiveFailures,
			trippedAt: now,
			reason: opts.route ?? "threshold",
		});
	}
	return next;
}

export function isTripped(state: CompactionExtensionState, now: number): boolean {
	return state.trippedAt !== null && now < state.trippedAt + COOLDOWN_MS;
}

export function shouldBypass(_state: CompactionExtensionState, opts?: ShouldBypassOptions): boolean {
	if (opts?.manual === true) return true;
	if (opts?.reason === "manual") return true;
	return false;
}
