import { describe, expect, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import { verifyTagged } from "../crypto/signatures.ts";
import { chain, keys } from "../crypto/testing/sync-v1.test-support.ts";
import {
	b64urlDecode,
	b64urlEncode,
} from "../crypto/vendor/sync-format/jcs.ts";
import {
	deriveRecoveryKeys,
	hmacSecretSaltForPrf,
	recoveryPrfSalt,
	recoveryUserHandle,
} from "./index.ts";

const sha256 = (...parts: ReadonlyArray<Uint8Array | string>): Buffer =>
	createHash("sha256")
		.update(Buffer.concat(parts.map((part) => Buffer.from(part))))
		.digest();

const hkdf = (ikm: Uint8Array, salt: Uint8Array, label: string): Buffer => {
	const prk = createHmac("sha256", Buffer.from(salt))
		.update(Buffer.from(ikm))
		.digest();
	return createHmac("sha256", prk)
		.update(Buffer.concat([Buffer.from(label), Buffer.from([1])]))
		.digest();
};

const record = (name: string) => {
	const found = chain.records[name];
	if (found === undefined) throw new Error(`fixture ${name} missing`);
	return found;
};

const enrolledKeys = {
	key1: Reflect.get(
		Object(Reflect.get(Object(record("genesis").body), "bootstrap")),
		"recovery_key",
	),
	key2: record("recovery_key").body,
};

describe("passkey-PRF recovery key derivation (sync-design section 7, fixed PRF vectors)", () => {
	for (const name of ["key1", "key2"] as const) {
		test(`${name}: the fixed PRF output derives exactly the enrolled public keys`, async () => {
			const fixture = keys.recovery[name];
			const derived = await deriveRecoveryKeys(
				b64urlDecode(fixture.prf_output),
				b64urlDecode(fixture.enrollment_nonce),
			);
			expect(b64urlEncode(derived.signPublic)).toBe(
				String(Reflect.get(Object(enrolledKeys[name]), "signing_public_key")),
			);
			expect(b64urlEncode(derived.sealPublic)).toBe(
				String(Reflect.get(Object(enrolledKeys[name]), "sealing_public_key")),
			);
			expect(
				Buffer.from(derived.signSeed).equals(
					hkdf(
						b64urlDecode(fixture.prf_output),
						b64urlDecode(fixture.enrollment_nonce),
						"omo-sync/v1/recovery-sign",
					),
				),
			).toBe(true);
			expect(
				Buffer.from(derived.sealPrivate).equals(
					hkdf(
						b64urlDecode(fixture.prf_output),
						b64urlDecode(fixture.enrollment_nonce),
						"omo-sync/v1/recovery-seal",
					),
				),
			).toBe(true);
		});
	}

	test("the derived key1 signing key verifies the genesis countersignature (the anchor a recovering device checks)", async () => {
		const fixture = keys.recovery.key1;
		const derived = await deriveRecoveryKeys(
			b64urlDecode(fixture.prf_output),
			b64urlDecode(fixture.enrollment_nonce),
		);
		const genesis = record("genesis").body;
		const payload = {
			t: "omo-sync/v1/recovery-countersign",
			account: chain.account,
			custody_root: genesis["custody_root"] ?? "",
			predecessor: "",
			wraps_digest: genesis["wraps_digest"] ?? "",
		};
		expect(
			await verifyTagged(
				"omo-sync/v1/recovery-countersign",
				payload,
				b64urlEncode(derived.signPublic),
				genesis["countersign"],
			),
		).toBe(true);
	});

	test("the PRF salt, the hmac-secret transform and the user handle are the exact framed SHA-256 values", async () => {
		const account = "encoding-account";
		const nonce = b64urlDecode(keys.recovery.key1.enrollment_nonce);
		const salt = await recoveryPrfSalt(account, nonce);
		expect(
			Buffer.from(salt).equals(
				sha256(
					"omo-sync/v1/recovery-prf",
					Uint8Array.from([0]),
					account,
					nonce,
				),
			),
		).toBe(true);
		expect(
			Buffer.from(await hmacSecretSaltForPrf(salt)).equals(
				sha256("WebAuthn PRF", Uint8Array.from([0]), salt),
			),
		).toBe(true);
		expect(
			Buffer.from(await recoveryUserHandle(account)).equals(
				sha256("omo-sync/v1/recovery-user", Uint8Array.from([0]), account),
			),
		).toBe(true);
		expect(
			Buffer.from(await recoveryUserHandle("another-account")).equals(
				Buffer.from(await recoveryUserHandle(account)),
			),
		).toBe(false);
	});

	test("a nonce or PRF output of the wrong length is refused before any derivation", async () => {
		await expect(
			deriveRecoveryKeys(new Uint8Array(31), new Uint8Array(32)),
		).rejects.toThrow(RangeError);
		await expect(
			deriveRecoveryKeys(new Uint8Array(32), new Uint8Array(16)),
		).rejects.toThrow(RangeError);
		await expect(recoveryPrfSalt("a", new Uint8Array(31))).rejects.toThrow(
			RangeError,
		);
	});
});
