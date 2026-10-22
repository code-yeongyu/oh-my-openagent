import type {
	KeyringBody,
	KeyringEntry,
	SyncAuthor,
	VerifiedWrap,
	WrapEntry,
} from "../crypto/entry.ts";
import type { Principal, RecoveryKey } from "../crypto/parse.ts";

/**
 * The platform passkey API the native bridge drives (macOS AuthenticationServices, the Windows
 * WebAuthn API). It lives only inside the bridge process: `prfOutput` never crosses IPC.
 */
export type PasskeyFlags = {
	readonly userVerified: boolean;
	readonly backupEligible: boolean;
	readonly backupState: boolean;
};

export type PasskeyCreation = {
	readonly credentialId: string;
	readonly attachment: "platform" | "cross-platform";
	readonly flags: PasskeyFlags;
	readonly prfOutput: Uint8Array | null;
};

export type PasskeyAssertion = {
	readonly credentialId: string;
	readonly userHandle: Uint8Array;
	readonly flags: PasskeyFlags;
	readonly prfOutput: Uint8Array | null;
};

export type DiscoveredCredential = {
	readonly credentialId: string;
	readonly userHandle: Uint8Array;
};

export interface PasskeyAuthenticator {
	readonly prfSupported: boolean;
	create(request: {
		readonly rpId: string;
		readonly userHandle: Uint8Array;
		readonly userName: string;
		readonly challenge: Uint8Array;
		readonly prfSalt: Uint8Array;
		readonly excludeCredentialIds: ReadonlyArray<string>;
		readonly roaming: boolean;
	}): Promise<PasskeyCreation | null>;
	assert(request: {
		readonly rpId: string;
		readonly challenge: Uint8Array;
		readonly prfSalts: ReadonlyMap<string, Uint8Array>;
	}): Promise<PasskeyAssertion | null>;
	/** Discoverable credentials for the RP id, or null where the platform cannot enumerate them. */
	discover(rpId: string): Promise<ReadonlyArray<DiscoveredCredential> | null>;
	signalRemoved(
		rpId: string,
		credentialId: string,
	): Promise<"signalled" | "unsupported">;
}

/** What the enrolling member hands the bridge: public chain facts plus its own current-epoch wrap. */
export type EnrollBridgeRequest = {
	readonly account: string;
	readonly rpId: string;
	readonly userName: string;
	readonly roaming: boolean;
	readonly usedCredentialIds: ReadonlyArray<string>;
	readonly custodyRoot: string;
	readonly predecessor: string;
	readonly epoch: number;
	readonly deviceWrap: VerifiedWrap;
	readonly expectedHistory: ReadonlyArray<readonly [number, string]>;
};

export type EnrollRefusal =
	| "cancelled"
	| "no-prf"
	| "no-user-verification"
	| "not-survivable"
	| "credential-reused"
	| "device-wrap-refused";

export type EnrollBridgeResult =
	| {
			readonly ok: true;
			readonly key: RecoveryKey;
			readonly countersign: string;
			readonly wrap: WrapEntry;
			readonly wrapsDigest: string;
	  }
	| { readonly ok: false; readonly reason: EnrollRefusal };

/** One enrolled-and-not-removed key as the verified chain states it, with its committed proofs. */
export type RecoveryCandidate = {
	readonly key: RecoveryKey;
	readonly countersign: {
		readonly custodyRoot: string;
		readonly predecessor: string;
		readonly wrapsDigest: string;
		readonly signature: string;
	};
	readonly wrap: WrapEntry;
	readonly expectedHistory: ReadonlyArray<readonly [number, string]>;
	/**
	 * The enrolling record's full wrap list (in served order) and the expected history at its epoch.
	 * The record's countersignature covers that list's digest; its one recovery wrap is the
	 * enrollment wrap the bridge binds `wrap` to (desktop #2897 review r4 H2).
	 */
	readonly enrollment: {
		readonly wraps: ReadonlyArray<WrapEntry>;
		readonly expectedHistory: ReadonlyArray<readonly [number, string]>;
	};
};

/** A PRF salt input, read from served records BEFORE verification: a salt is not a secret. */
export type RecoverySaltInput = {
	readonly credentialId: string;
	readonly enrollmentNonce: string;
};

export type RecoverBeginRequest = {
	readonly account: string;
	readonly rpId: string;
	readonly salts: ReadonlyArray<RecoverySaltInput>;
	readonly knownCredentialIds: ReadonlyArray<string>;
	readonly acknowledgeUnknown: boolean;
};

/** Only the credential the user touched and its derived public keys; the private keys stay behind the handle. */
export type RecoverBeginResult =
	| {
			readonly ok: true;
			readonly handle: string;
			readonly credentialId: string;
			readonly sealing_public_key: string;
			readonly signing_public_key: string;
	  }
	| { readonly ok: false; readonly reason: RecoverRefusal };

export type RecoverFinishRequest = {
	readonly handle: string;
	readonly account: string;
	readonly candidate: RecoveryCandidate;
	readonly device: Principal;
	readonly join: {
		readonly epoch: number;
		readonly keyringHead: string;
		readonly baseSeq: number;
		readonly priorLink: string;
	};
};

/** The next step a person sees for an expired, used or unknown recovery handle. */
export const RECOVER_AGAIN = "start recovery again" as const;

export type RecoverRefusal =
	| "cancelled"
	| "no-prf"
	| "no-user-verification"
	| "not-enrolled"
	| "history-incomplete"
	| "key-mismatch"
	| "countersign-mismatch"
	| "wrap-refused"
	| "wrap-unbound"
	| "recovery-expired";

export type SignedJoin = {
	readonly body: KeyringBody;
	readonly digest: string;
	readonly link: string;
	readonly keyringLink: string;
	readonly recordSig: string;
};

export type RecoverBridgeResult =
	| {
			readonly ok: true;
			readonly credentialId: string;
			readonly deviceWrap: WrapEntry;
			readonly join: SignedJoin;
	  }
	| { readonly ok: false; readonly reason: RecoverRefusal };

/**
 * The native bridge seen from the engine host. Every request and result is public: PRF output
 * and the derived private keys stay behind it. Recovery runs in two steps around the anchored
 * walk: begin derives and holds the keys under a one-shot handle, finish uses them on a candidate
 * from the anchored state, and the handle dies on finish, abort, failure, its TTL or a second begin.
 */
export interface RecoveryBridge {
	readonly prfSupported: boolean;
	enroll(request: EnrollBridgeRequest): Promise<EnrollBridgeResult>;
	recoverBegin(request: RecoverBeginRequest): Promise<RecoverBeginResult>;
	recoverFinish(request: RecoverFinishRequest): Promise<RecoverBridgeResult>;
	recoverAbort(handle: string): Promise<void>;
	signalRemoved(
		rpId: string,
		credentialId: string,
	): Promise<"signalled" | "unsupported">;
}

/** A row of `GET /v1/sync/entries`: ciphertext-free chain metadata. */
export type ChainRow = {
	readonly seq: number;
	readonly base_seq: number;
	readonly kind: "batch" | "keyring";
	readonly account: string;
	readonly epoch: number;
	readonly author: SyncAuthor;
	readonly digest: string;
	readonly link: string;
	readonly keyring_link: string | null;
	readonly record_sig: string;
};

export type RecoveryWrapRow = {
	readonly record: {
		readonly seq: number;
		readonly digest: string;
		readonly keyring_link: string;
	};
	readonly entry: WrapEntry;
};

export type KeyringAppendRequest = {
	readonly record: KeyringBody;
	readonly base_seq: number;
	readonly link: string;
	readonly keyring_link: string;
	readonly record_sig: string;
	readonly wraps: ReadonlyArray<WrapEntry>;
};

export type TransportRefusal =
	| "stale_base"
	| "rate_limited"
	| "not_found"
	| "refused";

export type AppendResult =
	| { readonly ok: true; readonly seq: number }
	| { readonly ok: false; readonly reason: TransportRefusal };

/** The signed-in account's sync routes this module uses (contract 1.17.0 bootstrap reads and appends). */
export interface RecoveryTransport {
	listKeys(): Promise<ReadonlyArray<KeyringEntry> | null>;
	listEntries(): Promise<ReadonlyArray<ChainRow> | null>;
	listRecoveryWraps(): Promise<ReadonlyArray<RecoveryWrapRow> | null>;
	appendKeys(request: KeyringAppendRequest): Promise<AppendResult>;
	recoveryJoin(request: KeyringAppendRequest): Promise<AppendResult>;
}

export type RecoveryEvent =
	| "sync.recovery.enrolled"
	| "sync.recovery.enroll_refused"
	| "sync.recovery.recovered"
	| "sync.recovery.joined_read_only"
	| "sync.recovery.recover_refused"
	| "sync.recovery.removed";
