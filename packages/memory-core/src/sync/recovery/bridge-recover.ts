import { nextLink } from "../crypto/links.ts";
import { recordPayload, verifyTagged } from "../crypto/signatures.ts";
import {
	b64urlDecode,
	b64urlEncode,
	jcsBytes,
	sha256B64,
} from "../crypto/vendor/sync-format/jcs.ts";
import { signFramed } from "../crypto/vendor/sync-format/keys.ts";
import { provenRecoveryMaterial } from "./bridge-provenance.ts";
import {
	deriveRecoveryKeys,
	disposeRecoveryKeys,
	publicKeyText,
	type RecoveryKeyPairs,
	recoveryPrfSalt,
	recoveryUserHandle,
} from "./derive.ts";
import { disposeMaterial, sealWrap } from "./key-material.ts";
import type {
	PasskeyAuthenticator,
	RecoverBeginRequest,
	RecoverBeginResult,
	RecoverBridgeResult,
	RecoverFinishRequest,
	RecoveryCandidate,
	SignedJoin,
} from "./ports.ts";
import type { RecoveryHandles } from "./recovery-handles.ts";

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
	left.length === right.length &&
	left.every((byte, index) => byte === right[index]);

/**
 * The stale-prefix check: an account-matched credential the chain never enrolled most likely
 * means the served history hides a newer enrollment. Skipped where the platform cannot enumerate.
 */
const hasUnknownCredential = async (
	authenticator: PasskeyAuthenticator,
	request: RecoverBeginRequest,
): Promise<boolean> => {
	const discovered = await authenticator.discover(request.rpId);
	if (discovered === null) return false;
	const handle = await recoveryUserHandle(request.account);
	const known = new Set(request.knownCredentialIds);
	return discovered.some(
		(credential) =>
			sameBytes(credential.userHandle, handle) &&
			!known.has(credential.credentialId),
	);
};

const anchorHolds = async (
	account: string,
	candidate: RecoveryCandidate,
	keys: RecoveryKeyPairs,
): Promise<"key-mismatch" | "countersign-mismatch" | null> => {
	const derived = publicKeyText(keys);
	if (
		derived.sealing_public_key !== candidate.key.sealing_public_key ||
		derived.signing_public_key !== candidate.key.signing_public_key
	) {
		return "key-mismatch";
	}
	const countersign = candidate.countersign;
	const payload = {
		t: "omo-sync/v1/recovery-countersign",
		account,
		custody_root: countersign.custodyRoot,
		predecessor: countersign.predecessor,
		wraps_digest: countersign.wrapsDigest,
	};
	const ok = await verifyTagged(
		"omo-sync/v1/recovery-countersign",
		payload,
		b64urlEncode(keys.signPublic),
		countersign.signature,
	);
	return ok ? null : "countersign-mismatch";
};

const signJoin = async (
	request: RecoverFinishRequest,
	credentialId: string,
	keys: RecoveryKeyPairs,
): Promise<SignedJoin | null> => {
	const body = {
		kind: "recovery-join",
		account: request.account,
		epoch: request.join.epoch,
		keyring_head: request.join.keyringHead,
		principal: { ...request.device },
		credential_id: credentialId,
	};
	const digest = await sha256B64(jcsBytes(body));
	const link = await nextLink(request.join.priorLink, digest);
	const keyringLink = await nextLink(request.join.keyringHead, digest);
	if (link === null || keyringLink === null) return null;
	const fields = {
		account: request.account,
		base_seq: request.join.baseSeq,
		digest,
		epoch: request.join.epoch,
		link,
		keyring_link: keyringLink,
	};
	return {
		body,
		digest,
		link,
		keyringLink,
		recordSig: await signFramed(
			"omo-sync/v1/record",
			recordPayload(fields),
			keys.signSeed,
		),
	};
};

/**
 * Recovery begin (review r3 option A, sync-design section 7 step 2): one PRF assertion with user
 * verification over the served salts, then the recovery keys derived and held behind a one-shot
 * handle. Only the credential id and the derived PUBLIC keys come back, for the anchored walk.
 * The PRF output is overwritten before this returns; a second begin disposes any live handle.
 */
export const recoverBeginInBridge = async (
	authenticator: PasskeyAuthenticator,
	handles: RecoveryHandles,
	request: RecoverBeginRequest,
): Promise<RecoverBeginResult> => {
	handles.disposeAll();
	if (!authenticator.prfSupported) return { ok: false, reason: "no-prf" };
	if (
		!request.acknowledgeUnknown &&
		(await hasUnknownCredential(authenticator, request))
	) {
		return { ok: false, reason: "history-incomplete" };
	}
	const nonces = new Map(
		request.salts.map((salt) => [salt.credentialId, salt.enrollmentNonce]),
	);
	if (nonces.size === 0) return { ok: false, reason: "not-enrolled" };
	const salts = new Map<string, Uint8Array>();
	for (const [credentialId, nonce] of nonces)
		salts.set(
			credentialId,
			await recoveryPrfSalt(request.account, b64urlDecode(nonce)),
		);
	const assertion = await authenticator.assert({
		rpId: request.rpId,
		challenge: crypto.getRandomValues(new Uint8Array(32)),
		prfSalts: salts,
	});
	if (assertion === null) return { ok: false, reason: "cancelled" };
	const prfOutput = assertion.prfOutput;
	const nonce = nonces.get(assertion.credentialId);
	if (
		!assertion.flags.userVerified ||
		nonce === undefined ||
		prfOutput === null ||
		prfOutput.length !== 32
	) {
		prfOutput?.fill(0);
		return {
			ok: false,
			reason: !assertion.flags.userVerified
				? "no-user-verification"
				: nonce === undefined
					? "not-enrolled"
					: "no-prf",
		};
	}
	const keys = await deriveRecoveryKeys(prfOutput, b64urlDecode(nonce));
	prfOutput.fill(0);
	const publicKeys = publicKeyText(keys);
	const handle = handles.hold({
		account: request.account,
		credentialId: assertion.credentialId,
		...publicKeys,
		keys,
	});
	return {
		ok: true,
		handle,
		credentialId: assertion.credentialId,
		...publicKeys,
	};
};

/**
 * Recovery finish (steps 3 to 5) on a candidate taken from the ANCHORED state: the candidate must
 * name the handle's credential and carry the handle's public keys, its countersignature must hold,
 * and only then is its committed recovery wrap opened, re-sealed to this device and the join signed.
 * The handle is consumed first, so it dies on every path, and the keys are overwritten.
 */
export const recoverFinishInBridge = async (
	handles: RecoveryHandles,
	request: RecoverFinishRequest,
): Promise<RecoverBridgeResult> => {
	const held = handles.take(request.handle);
	if (held === null) return { ok: false, reason: "recovery-expired" };
	const { keys } = held;
	try {
		const candidate = request.candidate;
		if (
			held.account !== request.account ||
			candidate.key.credential_id !== held.credentialId
		)
			return { ok: false, reason: "key-mismatch" };
		const anchor = await anchorHolds(request.account, candidate, keys);
		if (anchor !== null) return { ok: false, reason: anchor };
		const material = await provenRecoveryMaterial(
			request.account,
			candidate,
			keys,
		);
		if (typeof material === "string") return { ok: false, reason: material };
		try {
			const deviceAddress = {
				account: request.account,
				epoch: candidate.wrap.epoch,
				id: `device:${request.device.id}`,
			};
			const deviceWrap = await sealWrap(
				deviceAddress,
				request.device.sealing_public_key,
				material,
			);
			const join = await signJoin(request, candidate.key.credential_id, keys);
			if (join === null) return { ok: false, reason: "wrap-refused" };
			return {
				ok: true,
				credentialId: candidate.key.credential_id,
				deviceWrap,
				join,
			};
		} finally {
			disposeMaterial(material);
		}
	} finally {
		disposeRecoveryKeys(keys);
	}
};
