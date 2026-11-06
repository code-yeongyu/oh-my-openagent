import type { WrapEntry } from "../crypto/entry.ts";
import { isObject, type JsonObject } from "../crypto/parse.ts";
import { decodeB64 } from "../crypto/signatures.ts";
import { openHistory } from "../crypto/unwrap.ts";
import {
	asciiBytes,
	b64urlEncode,
	concatBytes,
	type JsonValue,
	jcsBytes,
	jcsCanonical,
} from "../crypto/vendor/sync-format/jcs.ts";
import { openHpkeSealedBox } from "../hpke-sealed-box.ts";
import type { DeviceKeyring } from "../keyring-port.ts";
import { sealHpkeBox } from "./hpke-seal.ts";

/** One retained earlier epoch key, named by the digest of the genesis or rotation that created it. */
export type HistoryKey = {
	readonly epoch: number;
	readonly origin: string;
	readonly key: Uint8Array;
};

/** An epoch's key with every retained earlier key, as one wrap carries it. */
export type EpochMaterial = {
	readonly epoch: number;
	readonly current: Uint8Array;
	readonly history: ReadonlyArray<HistoryKey>;
};

export type WrapAddress = {
	readonly account: string;
	readonly epoch: number;
	readonly id: string;
};

const WRAP_INFO = concatBytes([
	asciiBytes("omo-sync/v1/wrap"),
	Uint8Array.from([0]),
]);

const wrapAad = (address: WrapAddress): Uint8Array<ArrayBuffer> =>
	jcsBytes({ account: address.account, epoch: address.epoch, id: address.id });

const historyOrder = (left: HistoryKey, right: HistoryKey): number =>
	left.epoch - right.epoch ||
	(left.origin < right.origin ? -1 : left.origin > right.origin ? 1 : 0);

const keyMaterial = async (
	address: WrapAddress,
	material: EpochMaterial,
): Promise<JsonValue> => {
	const rows: JsonValue = [...material.history]
		.sort(historyOrder)
		.map((row) => ({
			epoch: row.epoch,
			origin: row.origin,
			key: b64urlEncode(row.key),
		}));
	const nonce = crypto.getRandomValues(new Uint8Array(12));
	const key = await crypto.subtle.importKey(
		"raw",
		Uint8Array.from(material.current),
		"AES-GCM",
		false,
		["encrypt"],
	);
	const additionalData = jcsBytes({
		account: address.account,
		epoch: address.epoch,
		id: address.id,
		version: 1,
	});
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv: nonce, additionalData, tagLength: 128 },
			key,
			jcsBytes(rows),
		),
	);
	return {
		version: 1,
		current_key: b64urlEncode(material.current),
		history: {
			nonce: b64urlEncode(nonce),
			ciphertext: b64urlEncode(ciphertext),
		},
	};
};

/** The section 8.1 inner envelope `{version, account, epoch, id, key_material}` as canonical bytes. */
export const envelopeBytes = async (
	address: WrapAddress,
	material: EpochMaterial,
): Promise<Uint8Array<ArrayBuffer>> =>
	jcsBytes({
		version: 1,
		account: address.account,
		epoch: address.epoch,
		id: address.id,
		key_material: await keyMaterial(address, material),
	});

/** Seals one wrap to a recipient's X25519 public key, AEAD-bound to the account, epoch and recipient. */
export const sealWrap = async (
	address: WrapAddress,
	recipientSealingPublicKey: string,
	material: EpochMaterial,
): Promise<WrapEntry> => {
	const recipient = decodeB64(recipientSealingPublicKey, 32);
	if (recipient === null)
		throw new RangeError("a recipient sealing key is 32 bytes of base64url");
	const sealed = sealHpkeBox(
		recipient,
		await envelopeBytes(address, material),
		WRAP_INFO,
		wrapAad(address),
	);
	return { epoch: address.epoch, id: address.id, wrap: b64urlEncode(sealed) };
};

const parseEnvelope = (plaintext: Uint8Array): JsonObject | null => {
	const text = new TextDecoder().decode(plaintext);
	let parsed: JsonValue;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	if (!isObject(parsed) || jcsCanonical(parsed) !== text) return null;
	const keys = Object.keys(parsed).sort();
	return keys.join(",") === "account,epoch,id,key_material,version"
		? parsed
		: null;
};

export type OpenedMaterial =
	| { readonly ok: true; readonly material: EpochMaterial }
	| {
			readonly ok: false;
			readonly reason:
				| "wrap_refused"
				| "malformed_envelope"
				| "envelope_mismatch"
				| "bad_history";
	  };

/**
 * Opens a wrap with a raw X25519 private key (the recovery key inside the bridge): the AEAD
 * binds the account, epoch and recipient from verified chain state, the inner envelope must
 * repeat them, and the history must hold exactly the expected non-cancelled earlier epochs.
 */
export const openWrapWithKey = async (
	sealPrivate: Uint8Array,
	sealPublic: Uint8Array,
	wrap: WrapEntry,
	address: WrapAddress,
	expectedHistory: ReadonlyMap<number, string>,
): Promise<OpenedMaterial> => {
	if (wrap.epoch !== address.epoch || wrap.id !== address.id)
		return { ok: false, reason: "envelope_mismatch" };
	const sealed = decodeB64(wrap.wrap);
	if (sealed === null) return { ok: false, reason: "malformed_envelope" };
	let plaintext: Uint8Array;
	try {
		plaintext = openHpkeSealedBox(
			sealPrivate,
			sealPublic,
			sealed,
			WRAP_INFO,
			wrapAad(address),
		);
	} catch {
		return { ok: false, reason: "wrap_refused" };
	}
	const envelope = parseEnvelope(plaintext);
	if (envelope === null || envelope["version"] !== 1)
		return { ok: false, reason: "malformed_envelope" };
	if (
		envelope["account"] !== address.account ||
		envelope["epoch"] !== address.epoch ||
		envelope["id"] !== address.id
	) {
		return { ok: false, reason: "envelope_mismatch" };
	}
	const opened = await openHistory(
		envelope["key_material"],
		address,
		expectedHistory,
	);
	if (opened === null) return { ok: false, reason: "bad_history" };
	const history = [...opened.history].map(([epoch, key]) => ({
		epoch,
		origin: expectedHistory.get(epoch) ?? "",
		key,
	}));
	return {
		ok: true,
		material: { epoch: address.epoch, current: opened.current, history },
	};
};

/**
 * Opens the device wrap the recovery bridge sealed for THIS device (bridge-recover) - the one wrap
 * recovery opens without a verified chain entry. openWrap refuses it by design: no entry has
 * committed it yet, and the rotation that will commit it needs this material first. It is safe
 * because recover.ts passes only the bridge's own return value (never a served wrap), the material
 * inside came from the recovery wrap the verified chain committed (recoveryCandidates), and the
 * address is this device's own, sealed to its key, so the AEAD still binds account, epoch and
 * recipient and the envelope and history checks match openWrap's.
 */
export const openBridgeSealedWrap = async (
	keyring: DeviceKeyring,
	wrap: WrapEntry,
	address: WrapAddress,
	expectedHistory: ReadonlyMap<number, string>,
): Promise<OpenedMaterial> => {
	if (
		wrap.epoch !== address.epoch ||
		wrap.id !== address.id ||
		address.id !== `device:${keyring.principal().id}`
	) {
		return { ok: false, reason: "envelope_mismatch" };
	}
	const sealed = decodeB64(wrap.wrap);
	if (sealed === null) return { ok: false, reason: "malformed_envelope" };
	let plaintext: Uint8Array;
	try {
		plaintext = await keyring.unseal(sealed, address);
	} catch {
		return { ok: false, reason: "wrap_refused" };
	}
	const envelope = parseEnvelope(plaintext);
	if (envelope === null || envelope["version"] !== 1)
		return { ok: false, reason: "malformed_envelope" };
	if (
		envelope["account"] !== address.account ||
		envelope["epoch"] !== address.epoch ||
		envelope["id"] !== address.id
	) {
		return { ok: false, reason: "envelope_mismatch" };
	}
	const opened = await openHistory(
		envelope["key_material"],
		address,
		expectedHistory,
	);
	if (opened === null) return { ok: false, reason: "bad_history" };
	const history = [...opened.history].map(([epoch, key]) => ({
		epoch,
		origin: expectedHistory.get(epoch) ?? "",
		key,
	}));
	return {
		ok: true,
		material: { epoch: address.epoch, current: opened.current, history },
	};
};

/** Overwrites every key in an opened material once its one operation is over. */
export const disposeMaterial = (material: EpochMaterial): void => {
	material.current.fill(0);
	for (const row of material.history) row.key.fill(0);
};
