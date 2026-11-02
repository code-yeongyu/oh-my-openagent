import { createHash, createHmac } from "node:crypto";
import { b64urlEncode } from "../../crypto/vendor/sync-format/jcs.ts";
import type {
	DiscoveredCredential,
	PasskeyAuthenticator,
	PasskeyFlags,
} from "../ports.ts";

type StoredCredential = {
	readonly id: string;
	readonly rpId: string;
	readonly userHandle: Uint8Array;
	readonly secret: Uint8Array;
	readonly fixedPrf: Uint8Array | null;
};

/**
 * A passkey provider account shared by every device that signs in to it (a synced keychain).
 * PRF follows CTAP hmac-secret behind the WebAuthn PRF extension: HMAC(secret,
 * SHA-256("WebAuthn PRF" || 0x00 || salt)). A fixed-PRF credential answers one constant output.
 */
export class FakePasskeyProvider {
	readonly credentials: StoredCredential[] = [];
	readonly signals: string[] = [];
	readonly prfOutputs: Uint8Array[] = [];

	prf(credential: StoredCredential, salt: Uint8Array): Uint8Array {
		if (credential.fixedPrf !== null)
			return Uint8Array.from(credential.fixedPrf);
		const input = createHash("sha256")
			.update(
				Buffer.concat([
					Buffer.from("WebAuthn PRF"),
					Buffer.from([0]),
					Buffer.from(salt),
				]),
			)
			.digest();
		const output = new Uint8Array(
			createHmac("sha256", credential.secret).update(input).digest(),
		);
		this.prfOutputs.push(Uint8Array.from(output));
		return output;
	}

	add(
		rpId: string,
		userHandle: Uint8Array,
		fixed: { readonly id: string; readonly prf: Uint8Array } | null = null,
	): StoredCredential {
		const credential = {
			id: fixed?.id ?? b64urlEncode(crypto.getRandomValues(new Uint8Array(16))),
			rpId,
			userHandle: Uint8Array.from(userHandle),
			secret: crypto.getRandomValues(new Uint8Array(32)),
			fixedPrf: fixed === null ? null : Uint8Array.from(fixed.prf),
		};
		this.credentials.push(credential);
		return credential;
	}

	forget(id: string): void {
		const index = this.credentials.findIndex(
			(credential) => credential.id === id,
		);
		if (index >= 0) this.credentials.splice(index, 1);
	}
}

export type FakeAuthenticatorOptions = {
	readonly prfSupported?: boolean;
	readonly prfAtCreate?: boolean;
	readonly createFlags?: PasskeyFlags;
	readonly assertFlags?: PasskeyFlags;
	readonly attachment?: "platform" | "cross-platform";
	readonly canEnumerate?: boolean;
	readonly choose?: () => string | null;
	readonly cancel?: boolean;
};

const SYNCED: PasskeyFlags = {
	userVerified: true,
	backupEligible: true,
	backupState: true,
};

/** One device's view of the provider: the platform authenticator the bridge drives. */
export const fakeAuthenticator = (
	provider: FakePasskeyProvider,
	options: FakeAuthenticatorOptions = {},
): PasskeyAuthenticator => ({
	prfSupported: options.prfSupported ?? true,
	create: async (request) => {
		if (options.cancel === true) return null;
		const credential = provider.add(request.rpId, request.userHandle);
		return {
			credentialId: credential.id,
			attachment: options.attachment ?? "platform",
			flags: options.createFlags ?? SYNCED,
			prfOutput:
				options.prfAtCreate === false
					? null
					: provider.prf(credential, request.prfSalt),
		};
	},
	assert: async (request) => {
		if (options.cancel === true) return null;
		const chosen =
			options.choose?.() ??
			[...request.prfSalts.keys()].find((id) =>
				provider.credentials.some((credential) => credential.id === id),
			);
		const credential = provider.credentials.find(
			(candidate) => candidate.id === chosen && candidate.rpId === request.rpId,
		);
		if (credential === undefined) return null;
		const salt =
			request.prfSalts.get(credential.id) ??
			crypto.getRandomValues(new Uint8Array(32));
		return {
			credentialId: credential.id,
			userHandle: credential.userHandle,
			flags: options.assertFlags ?? SYNCED,
			prfOutput: provider.prf(credential, salt),
		};
	},
	discover: async (
		rpId,
	): Promise<ReadonlyArray<DiscoveredCredential> | null> =>
		options.canEnumerate === false
			? null
			: provider.credentials
					.filter((credential) => credential.rpId === rpId)
					.map((credential) => ({
						credentialId: credential.id,
						userHandle: credential.userHandle,
					})),
	signalRemoved: async (_rpId, credentialId) => {
		provider.signals.push(credentialId);
		return "signalled";
	},
});
