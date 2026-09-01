import type { PostCompactClaimResult } from "./persistent-cache.js";
import type { PostCompactPendingKind } from "./post-compact-state.js";

export function claimedPostCompactKind<T extends PostCompactPendingKind>(
	result: PostCompactClaimResult,
	kind: T,
): T | undefined {
	return result === "claimed" ? kind : undefined;
}

export function shouldSkipPostCompactClaim(result: PostCompactClaimResult, recoveryInProgress: boolean): boolean {
	return result === "contended" || (result === "not-pending" && recoveryInProgress);
}
