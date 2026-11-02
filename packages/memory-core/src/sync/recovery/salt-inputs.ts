import type { RecoverySaltInput, RecoveryTransport } from "./ports.ts";

/**
 * The most recovery keys one account may hold at once. Enrollment refuses a key past it, and
 * recovery refuses a served list naming more enrolled credentials, so a hostile server cannot turn one
 * assertion into an unbounded salt list (#10412 review H3).
 */
export const MAX_RECOVERY_KEYS = 16;

export type ServedSalts =
	| { readonly ok: true; readonly salts: ReadonlyArray<RecoverySaltInput> }
	| {
			readonly ok: false;
			readonly reason: "unavailable" | "too-many-recovery-keys";
	  };

const saltOf = (value: unknown): RecoverySaltInput | null => {
	const credentialId: unknown = Reflect.get(Object(value), "credential_id");
	const enrollmentNonce: unknown = Reflect.get(
		Object(value),
		"enrollment_nonce",
	);
	return typeof credentialId === "string" && typeof enrollmentNonce === "string"
		? { credentialId, enrollmentNonce }
		: null;
};

const saltFromRow = (row: unknown): RecoverySaltInput | null => {
	const body: unknown = Reflect.get(Object(row), "body");
	const kind: unknown = Reflect.get(Object(body), "kind");
	if (kind === "genesis")
		return saltOf(
			Reflect.get(
				Object(Reflect.get(Object(body), "bootstrap")),
				"recovery_key",
			),
		);
	return kind === "recovery-key" ? saltOf(body) : null;
};

const removedCredential = (row: unknown): string | null => {
	const body: unknown = Reflect.get(Object(row), "body");
	const credentialId: unknown = Reflect.get(Object(body), "credential_id");
	return Reflect.get(Object(body), "kind") === "recovery-key-removed" &&
		typeof credentialId === "string"
		? credentialId
		: null;
};

/**
 * The PRF salt inputs a recovery assertion needs, read from the served keyring rows BEFORE any
 * verification (review r3 option A): only credential ids and enrollment nonces, which are not
 * secrets. A wrong one yields keys that fail the anchored walk; nothing else from this parse is used.
 * A response that is not a list is unavailable, and more than MAX_RECOVERY_KEYS credentials
 * still enrolled (removal rows excluded) is refused before anything reaches the authenticator.
 */
export const servedSaltInputs = async (
	transport: RecoveryTransport,
): Promise<ServedSalts> => {
	const keys: unknown = await transport.listKeys();
	if (!Array.isArray(keys)) return { ok: false, reason: "unavailable" };
	const found = new Map<string, RecoverySaltInput>();
	const removed = new Set<string>();
	for (const row of keys) {
		const removal = removedCredential(row);
		if (removal !== null) removed.add(removal);
		const salt = saltFromRow(row);
		if (salt !== null && !found.has(salt.credentialId))
			found.set(salt.credentialId, salt);
	}
	for (const credentialId of removed) found.delete(credentialId);
	if (found.size > MAX_RECOVERY_KEYS)
		return { ok: false, reason: "too-many-recovery-keys" };
	return { ok: true, salts: [...found.values()] };
};
