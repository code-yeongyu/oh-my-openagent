import type { TrustAnchor } from "../crypto/anchor.ts";
import type { RejectionCounter } from "../crypto/rejection.ts";
import type { DeviceKeyring } from "../keyring-port.ts";
import { signedAppend } from "./keyring-append.ts";
import type {
	EnrollRefusal,
	RecoveryBridge,
	RecoveryEvent,
	RecoveryTransport,
	TransportRefusal,
} from "./ports.ts";
import { MAX_RECOVERY_KEYS } from "./salt-inputs.ts";
import {
	committedWrap,
	expectedHistory,
	loadServedChain,
} from "./served-chain.ts";

export type EnrollOutcome =
	| { readonly ok: true; readonly credentialId: string; readonly seq: number }
	| {
			readonly ok: false;
			readonly reason:
				| EnrollRefusal
				| "unavailable"
				| "unverified"
				| "not-member"
				| "too-many-recovery-keys"
				| TransportRefusal;
	  };

export type EnrollInput = {
	/** This member device's pinned trust anchor (loadTrustAnchor); no pin means re-pair or recover first. */
	readonly anchor: TrustAnchor;
	readonly account: string;
	readonly rpId: string;
	readonly userName: string;
	readonly roaming: boolean;
	readonly keyring: DeviceKeyring;
	readonly bridge: RecoveryBridge;
	readonly transport: RecoveryTransport;
	readonly rejections: RejectionCounter;
	readonly onEvent?: (event: RecoveryEvent) => void;
};

/**
 * Enrolls one recovery passkey from a member device: verify the served chain, hand the bridge
 * this member's committed current-epoch wrap, then append the member-signed `recovery-key` record
 * with its one wrap atomically. The bridge returns only public values.
 */
export const enrollRecoveryKey = async (
	input: EnrollInput,
): Promise<EnrollOutcome> => {
	const refuse = (
		reason: Exclude<EnrollOutcome, { ok: true }>["reason"],
	): EnrollOutcome => {
		input.onEvent?.("sync.recovery.enroll_refused");
		return { ok: false, reason };
	};
	const served = await loadServedChain(
		input.transport,
		input.account,
		input.rejections,
		input.anchor,
	);
	if (!served.ok)
		return refuse(
			served.reason === "anchor-mismatch" ? "unverified" : served.reason,
		);
	const { state } = served;
	const authority = state.authority;
	const head = state.head;
	const self = input.keyring.principal().id;
	const member = authority?.members.get(self);
	if (
		authority === null ||
		head === null ||
		member === undefined ||
		member.signing_public_key !== input.keyring.publicKeys().signing
	) {
		return refuse("not-member");
	}
	const deviceWrap = committedWrap(state, authority.epoch, `device:${self}`);
	if (deviceWrap === null) return refuse("not-member");
	if (authority.registry.size >= MAX_RECOVERY_KEYS)
		return refuse("too-many-recovery-keys");
	const enrolled = await input.bridge.enroll({
		account: input.account,
		rpId: input.rpId,
		userName: input.userName,
		roaming: input.roaming,
		usedCredentialIds: [...authority.enrolledEver],
		custodyRoot: authority.custodyRoot,
		predecessor: head.keyring_link,
		epoch: authority.epoch,
		deviceWrap,
		expectedHistory: expectedHistory(authority, authority.epoch),
	});
	if (!enrolled.ok) return refuse(enrolled.reason);
	const body = {
		kind: "recovery-key",
		account: input.account,
		epoch: authority.epoch,
		...enrolled.key,
		countersign: enrolled.countersign,
		wraps_digest: enrolled.wrapsDigest,
	};
	const appended = await input.transport.appendKeys(
		await signedAppend(input.keyring, head, body, [enrolled.wrap]),
	);
	if (!appended.ok) {
		await input.bridge.signalRemoved(input.rpId, enrolled.key.credential_id);
		return refuse(appended.reason);
	}
	input.onEvent?.("sync.recovery.enrolled");
	return {
		ok: true,
		credentialId: enrolled.key.credential_id,
		seq: appended.seq,
	};
};
