import { createPrivateKey, createPublicKey } from "node:crypto";
import {
	asciiBytes,
	b64urlEncode,
	concatBytes,
	sha256,
} from "../crypto/vendor/sync-format/jcs.ts";
import {
	ed25519PublicKey,
	hkdfSha256,
} from "../crypto/vendor/sync-format/keys.ts";

/**
 * Recovery key derivation, exactly as sync-design section 7 states it. Every value here is
 * either public (the user handle, the PRF salt, the public keys) or lives only inside the native
 * bridge for one operation (the PRF output and the two private keys).
 */

const framed = (
	context: string,
	payload: Uint8Array,
): Uint8Array<ArrayBuffer> =>
	concatBytes([asciiBytes(context), Uint8Array.from([0]), payload]);

const utf8 = (text: string): Uint8Array<ArrayBuffer> => {
	const encoded = new TextEncoder().encode(text.normalize("NFC"));
	const bytes = new Uint8Array(encoded.length);
	bytes.set(encoded);
	return bytes;
};

/** The recovery credential's WebAuthn `user.id`: SHA-256("omo-sync/v1/recovery-user" || 0x00 || account id). */
export const recoveryUserHandle = (
	account: string,
): Promise<Uint8Array<ArrayBuffer>> =>
	sha256(framed("omo-sync/v1/recovery-user", utf8(account)));

/** `prf_salt` = SHA-256("omo-sync/v1/recovery-prf" || 0x00 || account || enrollment_nonce): the PRF `eval.first` input. */
export const recoveryPrfSalt = async (
	account: string,
	enrollmentNonce: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> => {
	if (enrollmentNonce.length !== 32)
		throw new RangeError("an enrollment nonce is exactly 32 bytes");
	return sha256(
		framed(
			"omo-sync/v1/recovery-prf",
			concatBytes([utf8(account), enrollmentNonce]),
		),
	);
};

/**
 * The hmac-secret salt a raw CTAP path must use for the same enrollment: the WebAuthn PRF
 * extension evaluates hmac-secret on SHA-256("WebAuthn PRF" || 0x00 || input), never on the
 * input itself, so a platform that bypasses the extension applies this transform first.
 */
export const hmacSecretSaltForPrf = (
	prfSalt: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> => sha256(framed("WebAuthn PRF", prfSalt));

/** The derived recovery key pairs. The private halves never leave the bridge process. */
export type RecoveryKeyPairs = {
	readonly sealPrivate: Uint8Array<ArrayBuffer>;
	readonly sealPublic: Uint8Array<ArrayBuffer>;
	readonly signSeed: Uint8Array<ArrayBuffer>;
	readonly signPublic: Uint8Array<ArrayBuffer>;
};

const X25519_PKCS8_PREFIX = Uint8Array.from([
	0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04,
	0x22, 0x04, 0x20,
]);

/** The raw X25519 public key of a raw private scalar (RFC 7748 clamping is the runtime's). */
export const x25519PublicKey = (
	privateRaw: Uint8Array,
): Uint8Array<ArrayBuffer> => {
	const privateKey = createPrivateKey({
		key: Buffer.from(concatBytes([X25519_PKCS8_PREFIX, privateRaw])),
		format: "der",
		type: "pkcs8",
	});
	const x = createPublicKey(privateKey).export({ format: "jwk" }).x;
	if (typeof x !== "string")
		throw new Error("x25519 public key derivation failed");
	const raw = Buffer.from(x, "base64url");
	const bytes = new Uint8Array(raw.length);
	bytes.set(raw);
	return bytes;
};

/**
 * From the 32-byte PRF output, HKDF-SHA-256 with salt = enrollment_nonce derives
 * `recovery_seal_private` (label "omo-sync/v1/recovery-seal") and `recovery_sign_seed`
 * (label "omo-sync/v1/recovery-sign").
 */
export const deriveRecoveryKeys = async (
	prfOutput: Uint8Array,
	enrollmentNonce: Uint8Array,
): Promise<RecoveryKeyPairs> => {
	if (prfOutput.length !== 32)
		throw new RangeError("a PRF output is exactly 32 bytes");
	if (enrollmentNonce.length !== 32)
		throw new RangeError("an enrollment nonce is exactly 32 bytes");
	const ikm = Uint8Array.from(prfOutput);
	const salt = Uint8Array.from(enrollmentNonce);
	const sealPrivate = await hkdfSha256(
		ikm,
		salt,
		asciiBytes("omo-sync/v1/recovery-seal"),
	);
	const signSeed = await hkdfSha256(
		ikm,
		salt,
		asciiBytes("omo-sync/v1/recovery-sign"),
	);
	ikm.fill(0);
	return {
		sealPrivate,
		sealPublic: x25519PublicKey(sealPrivate),
		signSeed,
		signPublic: await ed25519PublicKey(signSeed),
	};
};

/** Overwrites the private halves; the bridge calls it when its one operation ends, on every path. */
export const disposeRecoveryKeys = (keys: RecoveryKeyPairs): void => {
	keys.sealPrivate.fill(0);
	keys.signSeed.fill(0);
};

export const publicKeyText = (
	keys: RecoveryKeyPairs,
): {
	readonly sealing_public_key: string;
	readonly signing_public_key: string;
} => ({
	sealing_public_key: b64urlEncode(keys.sealPublic),
	signing_public_key: b64urlEncode(keys.signPublic),
});
