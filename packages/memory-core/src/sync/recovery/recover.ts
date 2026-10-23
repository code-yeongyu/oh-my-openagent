import { ANCHOR_NEXT_STEP, recoveryAnchor } from "../crypto/anchor.ts";
import type { RejectionCounter } from "../crypto/rejection.ts";
import { deviceIdOf } from "../crypto/signatures.ts";
import {
	loadTrustAnchor,
	pinTrustAnchor,
	TrustPinError,
} from "../crypto/trust-pin.ts";
import type { DeviceKeyring } from "../keyring-port.ts";
import { openBridgeSealedWrap } from "./key-material.ts";
import { rotationAppend } from "./keyring-append.ts";
import type {
	KeyringAppendRequest,
	RecoverBeginResult,
	RecoverRefusal,
	RecoveryBridge,
	RecoveryEvent,
	RecoveryTransport,
	TransportRefusal,
} from "./ports.ts";
import { appendAndConfirmJoin, rotationStored } from "./recover-join.ts";
import { servedSaltInputs } from "./salt-inputs.ts";
import { loadServedChain, recoveryCandidates } from "./served-chain.ts";
import { holdWrites, releaseWriteHold } from "./write-hold.ts";

export type RecoverRefusalReason =
	| RecoverRefusal
	| "approval-required"
	| "unavailable"
	| "unverified"
	| "no-recovery-key"
	| "too-many-recovery-keys"
	| "bad-device"
	| "join-refused"
	| "join-unconfirmed"
	| TransportRefusal;

export type RecoverOutcome =
	| {
			readonly ok: true;
			readonly state: "recovered";
			readonly epoch: number;
			readonly credentialId: string;
	  }
	| {
			readonly ok: true;
			readonly state: "joined-read-only";
			readonly credentialId: string;
	  }
	| { readonly ok: false; readonly reason: RecoverRefusalReason }
	| {
			readonly ok: false;
			readonly reason: "pin-conflict" | "pin-corrupt";
			readonly next: typeof ANCHOR_NEXT_STEP;
	  };

export type RecoverInput = {
	readonly account: string;
	readonly rpId: string;
	readonly keyring: DeviceKeyring;
	readonly bridge: RecoveryBridge | null;
	readonly transport: RecoveryTransport;
	readonly rejections: RejectionCounter;
	/** Where this device keeps its trust pin and write hold; recovery sets the pin from the anchored walk. */
	readonly stateDir: string;
	readonly acknowledgeUnknownCredential?: boolean;
	readonly onEvent?: (event: RecoveryEvent) => void;
};

type Device = {
	readonly kind: "device";
	readonly id: string;
	readonly sealing_public_key: string;
	readonly signing_public_key: string;
};
type Begun = Extract<RecoverBeginResult, { ok: true }>;
type Refuse = (reason: RecoverRefusalReason) => RecoverOutcome;

/**
 * Recovery on a fresh device (sync-design section 7, review r3 option A): the bridge asserts with
 * salts read from the served records and holds the derived keys; the served chain is then walked
 * anchored at the record that enrolled the touched credential with exactly those keys; only a
 * candidate from that anchored state reaches finish; after the join the device pins the anchor and
 * rotates at once to a fresh epoch wrapped only to this device and the key it used. The recovered
 * epoch's key is never used to write; a withheld rotation leaves the device read-only, persisted.
 * Once begin succeeds the handle is aborted on every exit, thrown ones included (#10412 review H1).
 */
export const recoverOnFreshDevice = async (
	input: RecoverInput,
): Promise<RecoverOutcome> => {
	const refuse: Refuse = (reason) => {
		input.onEvent?.("sync.recovery.recover_refused");
		return { ok: false, reason };
	};
	const refusePin = (
		reason: "pin-conflict" | "pin-corrupt",
	): RecoverOutcome => {
		input.onEvent?.("sync.recovery.recover_refused");
		return { ok: false, reason, next: ANCHOR_NEXT_STEP };
	};
	if (input.bridge === null || !input.bridge.prfSupported)
		return refuse("approval-required");
	const keys = input.keyring.publicKeys();
	const id = input.keyring.principal().id;
	if ((await deviceIdOf(keys.signing)) !== id) return refuse("bad-device");
	const existing = await loadTrustAnchor(input.stateDir, input.account);
	if (!existing.ok && existing.reason === "corrupt_pin")
		return refusePin("pin-corrupt");
	const pinned = existing.ok ? existing.anchor.genesisDigest : null;
	const served = await servedSaltInputs(input.transport);
	if (!served.ok) return refuse(served.reason);
	if (served.salts.length === 0) return refuse("no-recovery-key");
	const bridge = input.bridge;
	const begun = await bridge.recoverBegin({
		account: input.account,
		rpId: input.rpId,
		salts: served.salts,
		knownCredentialIds: served.salts.map((salt) => salt.credentialId),
		acknowledgeUnknown: input.acknowledgeUnknownCredential === true,
	});
	if (!begun.ok) return refuse(begun.reason);
	try {
		return await recoverWithHandle(
			input,
			bridge,
			begun,
			pinned,
			{
				kind: "device",
				id,
				sealing_public_key: keys.sealing,
				signing_public_key: keys.signing,
			},
			refuse,
			refusePin,
		);
	} finally {
		await bridge.recoverAbort(begun.handle);
	}
};

const recoverWithHandle = async (
	input: RecoverInput,
	bridge: RecoveryBridge,
	begun: Begun,
	pinned: string | null,
	device: Device,
	refuse: Refuse,
	refusePin: (reason: "pin-conflict") => RecoverOutcome,
): Promise<RecoverOutcome> => {
	const anchor = recoveryAnchor({
		account: input.account,
		credentialId: begun.credentialId,
		sealing_public_key: begun.sealing_public_key,
		signing_public_key: begun.signing_public_key,
	});
	const [served, wrapRows] = await Promise.all([
		loadServedChain(input.transport, input.account, input.rejections, anchor),
		input.transport.listRecoveryWraps(),
	]);
	if (!served.ok)
		return refuse(
			served.reason === "anchor-mismatch" ? "key-mismatch" : served.reason,
		);
	if (!Array.isArray(wrapRows)) return refuse("unavailable");
	const { authority, head, pin } = served.state;
	if (authority === null || head === null || pin === null)
		return refuse("unverified");
	if (pinned !== null && pin.genesisDigest !== pinned)
		return refusePin("pin-conflict");
	const candidate = recoveryCandidates(served.state, wrapRows).find(
		(entry) => entry.key.credential_id === begun.credentialId,
	);
	if (candidate === undefined) return refuse("not-enrolled");
	const recovered = await bridge.recoverFinish({
		handle: begun.handle,
		account: input.account,
		candidate,
		device,
		join: {
			epoch: authority.epoch,
			keyringHead: head.keyring_link,
			baseSeq: head.seq,
			priorLink: head.link,
		},
	});
	if (!recovered.ok) return refuse(recovered.reason);
	// The hold goes on disk BEFORE the join can land (#10412 review r2 M1): a crash or a throw after
	// the join or the pin then leaves the device read-only. Only a verified rotation releases it.
	await holdWrites(input.stateDir, input.account, recovered.credentialId);
	const confirmed = await appendAndConfirmJoin(
		input.transport,
		input.account,
		input.rejections,
		anchor,
		head,
		recovered,
	);
	if (!confirmed.ok) return refuse(confirmed.reason);
	try {
		await pinTrustAnchor(input.stateDir, input.account, confirmed.pin);
	} catch (error) {
		if (error instanceof TrustPinError && error.problem === "pin_conflict")
			return refusePin("pin-conflict");
		throw error;
	}
	const expected = [...confirmed.authority.epochOrigins].filter(
		([epoch, origin]) =>
			epoch < authority.epoch && !confirmed.authority.cancelled.has(origin),
	);
	const opened = await openBridgeSealedWrap(
		input.keyring,
		recovered.deviceWrap,
		{
			account: input.account,
			epoch: authority.epoch,
			id: `device:${device.id}`,
		},
		new Map(expected),
	);
	if (!opened.ok) return refuse("wrap-refused");
	const retained = opened.material;
	let rotation: KeyringAppendRequest;
	let rotated: Awaited<ReturnType<RecoveryTransport["appendKeys"]>>;
	try {
		rotation = await rotationAppend(
			input.keyring,
			confirmed.head,
			input.account,
			confirmed.authority,
			retained,
			[device],
			[confirmed.usedKey],
		);
		rotated = await input.transport.appendKeys(rotation);
	} finally {
		retained.current.fill(0);
		for (const row of retained.history) row.key.fill(0);
	}
	const readOnly = (): RecoverOutcome => {
		input.onEvent?.("sync.recovery.joined_read_only");
		return {
			ok: true,
			state: "joined-read-only",
			credentialId: recovered.credentialId,
		};
	};
	if (!rotated.ok) return readOnly();
	if (
		!(await rotationStored(
			input,
			anchor,
			rotation,
			confirmed.authority.epoch + 1,
			device,
		))
	)
		return readOnly();
	await releaseWriteHold(input.stateDir, input.account);
	input.onEvent?.("sync.recovery.recovered");
	return {
		ok: true,
		state: "recovered",
		epoch: confirmed.authority.epoch + 1,
		credentialId: recovered.credentialId,
	};
};
