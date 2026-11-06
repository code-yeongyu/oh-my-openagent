import { b64urlEncode } from "../crypto/vendor/sync-format/jcs.ts";
import { disposeRecoveryKeys, type RecoveryKeyPairs } from "./derive.ts";

export const RECOVERY_HANDLE_TTL_MS = 120_000;

export type HeldRecovery = {
	readonly account: string;
	readonly credentialId: string;
	readonly sealing_public_key: string;
	readonly signing_public_key: string;
	readonly keys: RecoveryKeyPairs;
};

export type RecoveryHandles = {
	/** Holds derived keys under a fresh unguessable handle; any earlier handle is disposed first. */
	hold(recovery: HeldRecovery): string;
	/** Removes and returns a live handle's recovery, or null when it is unknown, used or expired. */
	take(handle: string): HeldRecovery | null;
	/** Zeroes and forgets every live handle (a second begin, abort, window or app quit). */
	disposeAll(): void;
};

/** Arms a one-shot timer and returns its cancel; the default never keeps the process alive. */
export type Schedule = (delayMs: number, run: () => void) => () => void;

const unrefTimer: Schedule = (delayMs, run) => {
	const timer = setTimeout(run, delayMs);
	timer.unref?.();
	return () => clearTimeout(timer);
};

/**
 * The bridge-side store of recovery keys between begin and finish (review r3 option A): at most
 * one live handle, a 32-byte random id, and a two-minute TTL enforced twice: a timer armed at hold
 * zeroes the keys when it fires even if nothing calls the store again (#10412 review H1), and every
 * use re-reads `now`. Every exit path overwrites the private keys.
 */
export const createRecoveryHandles = (
	now: () => number = Date.now,
	ttlMs = RECOVERY_HANDLE_TTL_MS,
	schedule: Schedule = unrefTimer,
): RecoveryHandles => {
	let live: {
		readonly handle: string;
		readonly expiresAt: number;
		readonly recovery: HeldRecovery;
		readonly cancel: () => void;
	} | null = null;
	const disposeAll = (): void => {
		if (live !== null) {
			live.cancel();
			disposeRecoveryKeys(live.recovery.keys);
		}
		live = null;
	};
	return {
		hold: (recovery) => {
			disposeAll();
			const handle = b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
			const cancel = schedule(ttlMs, () => {
				if (live?.handle === handle) disposeAll();
			});
			live = { handle, expiresAt: now() + ttlMs, recovery, cancel };
			return handle;
		},
		take: (handle) => {
			const current = live;
			if (current === null) return null;
			if (now() > current.expiresAt) {
				disposeAll();
				return null;
			}
			if (current.handle !== handle) return null;
			current.cancel();
			live = null;
			return current.recovery;
		},
		disposeAll,
	};
};
