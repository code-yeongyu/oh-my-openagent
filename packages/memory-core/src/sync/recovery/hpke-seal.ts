import { Buffer } from "node:buffer";
import {
	createCipheriv,
	createHmac,
	createPublicKey,
	diffieHellman,
	generateKeyPairSync,
} from "node:crypto";

const KEM_SUITE = Buffer.concat([
	Buffer.from("KEM"),
	Buffer.from([0x00, 0x20]),
]);
const HPKE_SUITE = Buffer.concat([
	Buffer.from("HPKE"),
	Buffer.from([0x00, 0x20, 0x00, 0x01, 0x00, 0x02]),
]);

const labeledExtract = (
	suite: Buffer,
	label: string,
	ikm: Uint8Array,
	salt: Uint8Array = Buffer.alloc(0),
): Buffer =>
	createHmac("sha256", salt.length === 0 ? Buffer.alloc(32) : Buffer.from(salt))
		.update(
			Buffer.concat([
				Buffer.from("HPKE-v1"),
				suite,
				Buffer.from(label),
				Buffer.from(ikm),
			]),
		)
		.digest();

const labeledExpand = (
	suite: Buffer,
	label: string,
	prk: Buffer,
	info: Uint8Array,
	length: number,
): Buffer => {
	const lengthBytes = Buffer.alloc(2);
	lengthBytes.writeUInt16BE(length);
	return createHmac("sha256", prk)
		.update(
			Buffer.concat([
				lengthBytes,
				Buffer.from("HPKE-v1"),
				suite,
				Buffer.from(label),
				Buffer.from(info),
				Buffer.from([1]),
			]),
		)
		.digest()
		.subarray(0, length);
};

/**
 * The sender half of the section 8.1 wrap profile, mirroring `openHpkeSealedBox`: RFC 9180
 * base mode, DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, AES-256-GCM, one Seal at sequence zero
 * under a fresh ephemeral key. Output is `enc (32) || ciphertext || tag (16)`.
 */
export const sealHpkeBox = (
	recipientPublicRaw: Uint8Array,
	plaintext: Uint8Array,
	info: Uint8Array,
	aad: Uint8Array,
): Uint8Array<ArrayBuffer> => {
	if (recipientPublicRaw.length !== 32)
		throw new RangeError("an X25519 public key is exactly 32 bytes");
	const ephemeral = generateKeyPairSync("x25519");
	const enc = Buffer.from(
		ephemeral.publicKey.export({ format: "jwk" }).x ?? "",
		"base64url",
	);
	const recipient = createPublicKey({
		key: {
			kty: "OKP",
			crv: "X25519",
			x: Buffer.from(recipientPublicRaw).toString("base64url"),
		},
		format: "jwk",
	});
	const dh = diffieHellman({
		privateKey: ephemeral.privateKey,
		publicKey: recipient,
	});
	if (dh.every((byte) => byte === 0))
		throw new Error("refusing an all-zero X25519 shared secret");
	const sharedSecret = labeledExpand(
		KEM_SUITE,
		"shared_secret",
		labeledExtract(KEM_SUITE, "eae_prk", dh),
		Buffer.concat([enc, Buffer.from(recipientPublicRaw)]),
		32,
	);
	const context = Buffer.concat([
		Buffer.from([0]),
		labeledExtract(HPKE_SUITE, "psk_id_hash", Buffer.alloc(0)),
		labeledExtract(HPKE_SUITE, "info_hash", info),
	]);
	const secret = labeledExtract(
		HPKE_SUITE,
		"secret",
		Buffer.alloc(0),
		sharedSecret,
	);
	const cipher = createCipheriv(
		"aes-256-gcm",
		labeledExpand(HPKE_SUITE, "key", secret, context, 32),
		labeledExpand(HPKE_SUITE, "base_nonce", secret, context, 12),
	);
	cipher.setAAD(Buffer.from(aad));
	const sealed = Buffer.concat([
		enc,
		cipher.update(plaintext),
		cipher.final(),
		cipher.getAuthTag(),
	]);
	const bytes = new Uint8Array(sealed.length);
	bytes.set(sealed);
	return bytes;
};
