import { wrapSetDigest } from "../crypto/links.ts";
import { openWrap } from "../crypto/unwrap.ts";
import { b64urlEncode } from "../crypto/vendor/sync-format/jcs.ts";
import { signFramed } from "../crypto/vendor/sync-format/keys.ts";
import type { DeviceKeyring } from "../keyring-port.ts";
import {
	deriveRecoveryKeys,
	disposeRecoveryKeys,
	publicKeyText,
	recoveryPrfSalt,
	recoveryUserHandle,
} from "./derive.ts";
import {
	disposeMaterial,
	type EpochMaterial,
	sealWrap,
} from "./key-material.ts";
import type {
	EnrollBridgeRequest,
	EnrollBridgeResult,
	PasskeyAuthenticator,
	PasskeyFlags,
} from "./ports.ts";

const survivability = (
	flags: PasskeyFlags,
	attachment: "platform" | "cross-platform",
	roaming: boolean,
): "synced" | "roaming" | null => {
	if (flags.backupEligible && flags.backupState) return "synced";
	return roaming && attachment === "cross-platform" ? "roaming" : null;
};

/**
 * Bridge-side enrollment (sync-design section 7): create the dedicated passkey, run the follow-up
 * PRF assertion with user verification when creation yields none (and re-check BS there), derive
 * the recovery keys, open this member's own current-epoch wrap through its device keyring, seal
 * that material to the new recovery key, and countersign the custody root, the predecessor and
 * the one-entry wrap set. A credential that ends unusable is signalled as removed.
 */
export const enrollInBridge = async (
	authenticator: PasskeyAuthenticator,
	keyring: DeviceKeyring,
	request: EnrollBridgeRequest,
): Promise<EnrollBridgeResult> => {
	if (!authenticator.prfSupported) return { ok: false, reason: "no-prf" };
	const nonce = crypto.getRandomValues(new Uint8Array(32));
	const prfSalt = await recoveryPrfSalt(request.account, nonce);
	const created = await authenticator.create({
		rpId: request.rpId,
		userHandle: await recoveryUserHandle(request.account),
		userName: request.userName,
		challenge: crypto.getRandomValues(new Uint8Array(32)),
		prfSalt,
		excludeCredentialIds: request.usedCredentialIds,
		roaming: request.roaming,
	});
	if (created === null) return { ok: false, reason: "cancelled" };
	const abandon = async (
		reason:
			| "no-prf"
			| "no-user-verification"
			| "not-survivable"
			| "credential-reused"
			| "device-wrap-refused"
			| "cancelled",
	): Promise<EnrollBridgeResult> => {
		await authenticator.signalRemoved(request.rpId, created.credentialId);
		return { ok: false, reason };
	};
	if (request.usedCredentialIds.includes(created.credentialId))
		return abandon("credential-reused");
	let flags = created.flags;
	let prfOutput = created.flags.userVerified ? created.prfOutput : null;
	if (
		prfOutput === null ||
		survivability(flags, created.attachment, request.roaming) === null
	) {
		const followUp = await authenticator.assert({
			rpId: request.rpId,
			challenge: crypto.getRandomValues(new Uint8Array(32)),
			prfSalts: new Map([[created.credentialId, prfSalt]]),
		});
		if (followUp === null) return abandon("cancelled");
		if (followUp.credentialId !== created.credentialId)
			return abandon("cancelled");
		if (!followUp.flags.userVerified) return abandon("no-user-verification");
		flags = followUp.flags;
		prfOutput = followUp.prfOutput;
	}
	if (prfOutput === null || prfOutput.length !== 32) return abandon("no-prf");
	const survivable = survivability(flags, created.attachment, request.roaming);
	if (survivable === null) {
		prfOutput.fill(0);
		return abandon("not-survivable");
	}
	const expected = new Map(request.expectedHistory);
	const opened = await openWrap(
		keyring,
		request.deviceWrap,
		request.account,
		expected,
	);
	if (!opened.ok) {
		prfOutput.fill(0);
		return abandon("device-wrap-refused");
	}
	const material: EpochMaterial = {
		epoch: request.epoch,
		current: opened.keys.current,
		history: [...opened.keys.history].map(([epoch, key]) => ({
			epoch,
			origin: expected.get(epoch) ?? "",
			key,
		})),
	};
	const keys = await deriveRecoveryKeys(prfOutput, nonce);
	prfOutput.fill(0);
	try {
		const publicKeys = publicKeyText(keys);
		const wrap = await sealWrap(
			{
				account: request.account,
				epoch: request.epoch,
				id: `recovery:${created.credentialId}`,
			},
			publicKeys.sealing_public_key,
			material,
		);
		const digest = await wrapSetDigest([wrap]);
		if (!digest.ok) return abandon("device-wrap-refused");
		const countersign = await signFramed(
			"omo-sync/v1/recovery-countersign",
			{
				t: "omo-sync/v1/recovery-countersign",
				account: request.account,
				custody_root: request.custodyRoot,
				predecessor: request.predecessor,
				wraps_digest: digest.digest,
			},
			keys.signSeed,
		);
		const key = {
			credential_id: created.credentialId,
			rp_id: request.rpId,
			enrollment_nonce: b64urlEncode(nonce),
			...publicKeys,
			survivable,
		};
		return { ok: true, key, countersign, wrap, wrapsDigest: digest.digest };
	} finally {
		disposeRecoveryKeys(keys);
		disposeMaterial(material);
	}
};
