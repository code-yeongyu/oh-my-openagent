import type { TrustAnchor } from "../crypto/anchor.ts";
import type { ChainState } from "../crypto/chain.ts";
import type { Authority } from "../crypto/fold.ts";
import type { RejectionCounter } from "../crypto/rejection.ts";
import type { DeviceKeyring } from "../keyring-port.ts";
import type { EpochMaterial } from "./key-material.ts";
import { ownMaterial, rotationAppend, signedAppend } from "./keyring-append.ts";
import type {
	RecoveryBridge,
	RecoveryEvent,
	RecoveryTransport,
	TransportRefusal,
} from "./ports.ts";
import {
	committedWrap,
	expectedHistory,
	loadServedChain,
} from "./served-chain.ts";

export type RemoveOutcome =
	| {
			readonly ok: true;
			readonly epoch: number;
			readonly platformSignal: "signalled" | "unsupported";
			readonly deleteFromPasskeyManager: true;
	  }
	| {
			readonly ok: false;
			readonly reason:
				| "unavailable"
				| "unverified"
				| "not-member"
				| "not-enrolled"
				| "confirm-last-key"
				| "wrap-refused"
				| TransportRefusal;
	  }
	| {
			/** The key is removed but no stored, verified rotation excludes it yet; call again to retry. */
			readonly ok: false;
			readonly reason: "rotation-pending";
			readonly platformSignal: "signalled" | "unsupported";
			readonly deleteFromPasskeyManager: true;
	  };

export type RemoveInput = {
	/** This member device's pinned trust anchor (loadTrustAnchor); no pin means re-pair or recover first. */
	readonly anchor: TrustAnchor;
	readonly account: string;
	readonly rpId: string;
	readonly credentialId: string;
	readonly confirmGivingUpRecovery: boolean;
	readonly keyring: DeviceKeyring;
	readonly bridge: RecoveryBridge | null;
	readonly transport: RecoveryTransport;
	readonly rejections: RejectionCounter;
	readonly onEvent?: (event: RecoveryEvent) => void;
};

/** A removal recorded at the current epoch with no rotation after it: the retry resumes there. */
const removalPending = (
	state: ChainState,
	authority: Authority,
	credentialId: string,
): boolean =>
	!authority.registry.has(credentialId) &&
	state.history.some(
		(record, index) =>
			record.body.kind === "recovery-key-removed" &&
			record.body.credentialId === credentialId &&
			state.received[index]?.epoch === authority.epoch,
	);

/**
 * Removes one recovery key (sync-design section 7): a member-signed `recovery-key-removed` record,
 * then the rotation that excludes it, so no later epoch is wrapped to the removed passkey. Success
 * means the rotation is stored and seen on a fresh reload (#10412 review M2); until then the outcome
 * is `rotation-pending`, and calling again resumes at the rotation. The platform provider is told
 * where it offers an API, and the user is always asked to delete the passkey. Removing the last key
 * needs explicit confirmation that recovery is being given up. The epoch key opened for the rotation
 * is zeroed on every exit (#10412 review H2).
 */
export const removeRecoveryKey = async (
	input: RemoveInput,
): Promise<RemoveOutcome> => {
	const served = await loadServedChain(
		input.transport,
		input.account,
		input.rejections,
		input.anchor,
	);
	if (!served.ok)
		return {
			ok: false,
			reason:
				served.reason === "anchor-mismatch" ? "unverified" : served.reason,
		};
	const authority = served.state.authority;
	const head = served.state.head;
	const self = input.keyring.principal().id;
	if (
		authority === null ||
		head === null ||
		authority.members.get(self)?.signing_public_key !==
			input.keyring.publicKeys().signing
	) {
		return { ok: false, reason: "not-member" };
	}
	const resuming = removalPending(served.state, authority, input.credentialId);
	if (!resuming && !authority.registry.has(input.credentialId))
		return { ok: false, reason: "not-enrolled" };
	if (
		!resuming &&
		authority.registry.size === 1 &&
		!input.confirmGivingUpRecovery
	)
		return { ok: false, reason: "confirm-last-key" };
	const deviceWrap = committedWrap(
		served.state,
		authority.epoch,
		`device:${self}`,
	);
	const retained =
		deviceWrap === null
			? null
			: await ownMaterial(
					input.keyring,
					input.account,
					deviceWrap,
					expectedHistory(authority, authority.epoch),
				);
	if (retained === null) return { ok: false, reason: "wrap-refused" };
	try {
		return await removeWithMaterial(
			input,
			head,
			authority.epoch,
			resuming,
			retained,
		);
	} finally {
		retained.current.fill(0);
		for (const row of retained.history) row.key.fill(0);
	}
};

const removeWithMaterial = async (
	input: RemoveInput,
	head: NonNullable<ChainState["head"]>,
	epoch: number,
	resuming: boolean,
	retained: EpochMaterial,
): Promise<RemoveOutcome> => {
	if (!resuming) {
		const body = {
			kind: "recovery-key-removed",
			account: input.account,
			epoch,
			credential_id: input.credentialId,
		};
		const removed = await input.transport.appendKeys(
			await signedAppend(input.keyring, head, body, []),
		);
		if (!removed.ok) return { ok: false, reason: removed.reason };
	}
	const platformSignal =
		input.bridge === null
			? "unsupported"
			: await input.bridge.signalRemoved(input.rpId, input.credentialId);
	const pending: RemoveOutcome = {
		ok: false,
		reason: "rotation-pending",
		platformSignal,
		deleteFromPasskeyManager: true,
	};
	const after = await loadServedChain(
		input.transport,
		input.account,
		input.rejections,
		input.anchor,
	);
	const afterAuthority = after.ok ? after.state.authority : null;
	const afterHead = after.ok ? after.state.head : null;
	if (
		afterAuthority === null ||
		afterHead === null ||
		afterAuthority.epoch !== epoch ||
		afterAuthority.registry.has(input.credentialId)
	) {
		return pending;
	}
	const rotated = await input.transport.appendKeys(
		await rotationAppend(
			input.keyring,
			afterHead,
			input.account,
			afterAuthority,
			retained,
			[...afterAuthority.members.values()],
			[...afterAuthority.registry.values()],
		),
	);
	if (!rotated.ok) return pending;
	const stored = await loadServedChain(
		input.transport,
		input.account,
		input.rejections,
		input.anchor,
	);
	const storedAuthority = stored.ok ? stored.state.authority : null;
	if (
		storedAuthority === null ||
		storedAuthority.epoch !== epoch + 1 ||
		storedAuthority.registry.has(input.credentialId)
	) {
		return pending;
	}
	input.onEvent?.("sync.recovery.removed");
	return {
		ok: true,
		epoch: epoch + 1,
		platformSignal,
		deleteFromPasskeyManager: true,
	};
};
