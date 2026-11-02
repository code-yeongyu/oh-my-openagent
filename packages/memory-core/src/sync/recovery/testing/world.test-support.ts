import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { creatorAnchor, type TrustAnchor } from "../../crypto/anchor.ts";
import { buildBatch, signRecord } from "../../crypto/build.ts";
import {
	appendEntries,
	type ChainState,
	emptyChain,
} from "../../crypto/chain.ts";
import type { BatchEntry, Head, SyncAuthor } from "../../crypto/entry.ts";
import { nextLink, wrapSetDigest } from "../../crypto/links.ts";
import type { Principal } from "../../crypto/parse.ts";
import { createRejectionCounter } from "../../crypto/rejection.ts";
import { deviceIdOf, taggedHash } from "../../crypto/signatures.ts";
import { pinTrustAnchor } from "../../crypto/trust-pin.ts";
import {
	b64urlEncode,
	sha256B64,
} from "../../crypto/vendor/sync-format/jcs.ts";
import { signFramed } from "../../crypto/vendor/sync-format/keys.ts";
import {
	createDeviceKeyring,
	type DeviceKeyring,
	generateDeviceKeyMaterial,
} from "../../keyring-port.ts";
import { createRecoveryBridge } from "../bridge.ts";
import {
	deriveRecoveryKeys,
	publicKeyText,
	recoveryPrfSalt,
	recoveryUserHandle,
} from "../derive.ts";
import { enrollRecoveryKey } from "../enroll.ts";
import { type EpochMaterial, sealWrap } from "../key-material.ts";
import {
	ownMaterial,
	rotationAppend,
	signedAppend,
} from "../keyring-append.ts";
import type { RecoveryTransport } from "../ports.ts";
import {
	committedWrap,
	expectedHistory,
	loadServedChain,
} from "../served-chain.ts";
import {
	type FakeAuthenticatorOptions,
	FakePasskeyProvider,
	fakeAuthenticator,
} from "./fake-passkey.test-support.ts";
import { FakeSyncServer } from "./fake-server.test-support.ts";

export const RP_ID = "recovery.sync.test";

export type Device = {
	readonly keyring: DeviceKeyring;
	readonly principal: Principal;
};

export const newDevice = async (): Promise<Device> => {
	const material = generateDeviceKeyMaterial();
	const id = (await deviceIdOf(material.publicKeys.signing)) ?? "";
	const keyring = createDeviceKeyring(id, material);
	return {
		keyring,
		principal: {
			kind: "device",
			id,
			sealing_public_key: material.publicKeys.sealing,
			signing_public_key: material.publicKeys.signing,
		},
	};
};

const authorOf = (device: Device): SyncAuthor => ({ ...device.principal });

export type World = {
	readonly account: string;
	readonly server: FakeSyncServer;
	readonly provider: FakePasskeyProvider;
	readonly owner: Device;
	readonly firstKey: string;
	readonly objects: Map<
		string,
		{ readonly bytes: Uint8Array<ArrayBuffer>; readonly text: string }
	>;
	/** The trust anchor every member of this account pinned when it joined (genesis digest). */
	anchor: TrustAnchor;
};

export const transportFor = (
	world: World,
	device: Device,
	server: FakeSyncServer = world.server,
): RecoveryTransport => server.transport(world.account, authorOf(device));

/** A fresh per-device state directory for a trust pin (under one temp root per test process). */
let stateRoot: string | null = null;
export const freshStateDir = (): string => {
	stateRoot ??= mkdtempSync(join(tmpdir(), "omo-recovery-world-"));
	return mkdtempSync(join(stateRoot, "device-"));
};
/** Removes every state dir `freshStateDir` made; each test file using this world calls it in afterAll. */
export const removeWorldStateDirs = (): void => {
	if (stateRoot !== null) rmSync(stateRoot, { recursive: true, force: true });
	stateRoot = null;
};

export const verified = async (
	world: World,
	device: Device,
	server: FakeSyncServer = world.server,
): Promise<ChainState> => {
	const served = await loadServedChain(
		transportFor(world, device, server),
		world.account,
		createRejectionCounter(),
		world.anchor,
	);
	if (!served.ok)
		throw new Error(`the world chain does not verify: ${served.reason}`);
	return served.state;
};

/** Turns sync on (the genesis bootstrap of section 7) with the owner device and one recovery passkey. */
export const createWorld = async (
	account = "acct-recovery",
): Promise<World> => {
	const server = new FakeSyncServer();
	const provider = new FakePasskeyProvider();
	const owner = await newDevice();
	const nonce = crypto.getRandomValues(new Uint8Array(32));
	const credential = provider.add(RP_ID, await recoveryUserHandle(account));
	const keys = await deriveRecoveryKeys(
		provider.prf(credential, await recoveryPrfSalt(account, nonce)),
		nonce,
	);
	const recoveryKey = {
		credential_id: credential.id,
		rp_id: RP_ID,
		enrollment_nonce: b64urlEncode(nonce),
		...publicKeyText(keys),
		survivable: "synced",
	};
	const bootstrap = {
		account,
		custody_nonce: b64urlEncode(crypto.getRandomValues(new Uint8Array(16))),
		first_device: { ...owner.principal },
		recovery_key: recoveryKey,
	};
	const custodyRoot = await taggedHash("omo-sync/v1/custody-root", bootstrap);
	const material: EpochMaterial = {
		epoch: 1,
		current: crypto.getRandomValues(new Uint8Array(32)),
		history: [],
	};
	const wraps = [
		await sealWrap(
			{ account, epoch: 1, id: `device:${owner.principal.id}` },
			owner.principal.sealing_public_key,
			material,
		),
		await sealWrap(
			{ account, epoch: 1, id: `recovery:${credential.id}` },
			recoveryKey.sealing_public_key,
			material,
		),
	];
	const digest = await wrapSetDigest(wraps);
	if (!digest.ok) throw new Error("genesis wraps");
	const countersign = await signFramed(
		"omo-sync/v1/recovery-countersign",
		{
			t: "omo-sync/v1/recovery-countersign",
			account,
			custody_root: custodyRoot,
			predecessor: "",
			wraps_digest: digest.digest,
		},
		keys.signSeed,
	);
	const body = {
		kind: "genesis",
		account,
		epoch: 1,
		bootstrap,
		custody_root: custodyRoot,
		countersign,
		wraps_digest: digest.digest,
	};
	const pending = {
		account,
		server,
		provider,
		owner,
		firstKey: credential.id,
		objects: new Map(),
	};
	const appended = await server
		.transport(account, authorOf(owner))
		.appendKeys(
			await signedAppend(
				owner.keyring,
				{ seq: 0, link: "", keyring_link: "" },
				body,
				wraps,
			),
		);
	if (!appended.ok) throw new Error("genesis was not admitted");
	const genesis = server.chain(account);
	const walked = await appendEntries(
		emptyChain(account, creatorAnchor(account, owner.keyring)),
		genesis,
		createRejectionCounter(),
	);
	if (!walked.ok || walked.state.pin === null)
		throw new Error("the creator could not anchor its own genesis");
	return {
		...pending,
		anchor: await pinTrustAnchor(freshStateDir(), account, walked.state.pin),
	};
};

const headOrThrow = (state: ChainState): Head => {
	if (state.head === null || state.authority === null)
		throw new Error("no verified head");
	return state.head;
};

/** The owner (or any member) rotates to the next epoch over the folded membership and registry. */
export const rotate = async (
	world: World,
	by: Device = world.owner,
	members?: ReadonlyArray<Principal>,
): Promise<void> => {
	const state = await verified(world, by);
	const authority = state.authority;
	if (authority === null) throw new Error("no authority");
	const wrap = committedWrap(
		state,
		authority.epoch,
		`device:${by.principal.id}`,
	);
	const retained =
		wrap === null
			? null
			: await ownMaterial(
					by.keyring,
					world.account,
					wrap,
					expectedHistory(authority, authority.epoch),
				);
	if (retained === null)
		throw new Error("the rotator cannot open its own wrap");
	const request = await rotationAppend(
		by.keyring,
		headOrThrow(state),
		world.account,
		authority,
		retained,
		members ?? [...authority.members.values()],
		[...authority.registry.values()],
	);
	const appended = await transportFor(world, by).appendKeys(request);
	if (!appended.ok) throw new Error(`rotation refused: ${appended.reason}`);
};

/** A member approves a new device (the pairing transcript is synthetic; the receiver recomputes it). */
export const approve = async (
	world: World,
	joining: Device,
	by: Device = world.owner,
): Promise<void> => {
	const state = await verified(world, by);
	const authority = state.authority;
	if (authority === null) throw new Error("no authority");
	const wrap = committedWrap(
		state,
		authority.epoch,
		`device:${by.principal.id}`,
	);
	const retained =
		wrap === null
			? null
			: await ownMaterial(
					by.keyring,
					world.account,
					wrap,
					expectedHistory(authority, authority.epoch),
				);
	if (retained === null)
		throw new Error("the approver cannot open its own wrap");
	const joiningNonce = b64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
	const commitment = await taggedHash("omo-sync/v1/approval-commitment", {
		account: world.account,
		sealing_public_key: joining.principal.sealing_public_key,
		signing_public_key: joining.principal.signing_public_key,
		nonce: joiningNonce,
	});
	const wraps = [
		await sealWrap(
			{
				account: world.account,
				epoch: authority.epoch,
				id: `device:${joining.principal.id}`,
			},
			joining.principal.sealing_public_key,
			retained,
		),
	];
	const digest = await wrapSetDigest(wraps);
	if (!digest.ok) throw new Error("approval wraps");
	const pairing = {
		commitment,
		joining_nonce: joiningNonce,
		approver_nonce: b64urlEncode(crypto.getRandomValues(new Uint8Array(16))),
	};
	const body = {
		kind: "approval",
		account: world.account,
		epoch: authority.epoch,
		principal: { ...joining.principal },
		wraps_digest: digest.digest,
		pairing,
	};
	const appended = await transportFor(world, by).appendKeys(
		await signedAppend(by.keyring, headOrThrow(state), body, wraps),
	);
	if (!appended.ok) throw new Error(`approval refused: ${appended.reason}`);
};

/** Writes one encrypted batch at the current epoch and keeps its bytes as the object store would. */
export const writeBatch = async (
	world: World,
	text: string,
	by: Device = world.owner,
): Promise<void> => {
	const state = await verified(world, by);
	const authority = state.authority;
	const head = headOrThrow(state);
	if (authority === null) throw new Error("no authority");
	const wrap = committedWrap(
		state,
		authority.epoch,
		`device:${by.principal.id}`,
	);
	const material =
		wrap === null
			? null
			: await ownMaterial(
					by.keyring,
					world.account,
					wrap,
					expectedHistory(authority, authority.epoch),
				);
	if (material === null) throw new Error("the writer cannot open its own wrap");
	const bytes = await buildBatch({
		account: world.account,
		kind: "ops",
		epoch: authority.epoch,
		epochKey: material.current,
		keyring: by.keyring,
		peers: ["1"],
		batchId: crypto.getRandomValues(new Uint8Array(16)),
		salt: crypto.getRandomValues(new Uint8Array(32)),
		createdAt: 1_700_000_000_000,
		records: [
			{
				type: 1,
				spaceId: new Uint8Array(16),
				itemKey: "notes/a.md",
				body: new TextEncoder().encode(text),
			},
		],
	});
	const digest = await sha256B64(bytes);
	const link = await nextLink(head.link, digest);
	if (link === null) throw new Error("link");
	const fields = {
		account: world.account,
		base_seq: head.seq,
		digest,
		epoch: authority.epoch,
		link,
		keyring_link: null,
	};
	const entry: BatchEntry = {
		...fields,
		seq: head.seq + 1,
		kind: "batch",
		author: authorOf(by),
		record_sig: await signRecord(by.keyring, fields),
	};
	world.server.chain(world.account).push(entry);
	world.objects.set(digest, { bytes, text });
};

/** Enrolls one more recovery passkey from `by` through the production client and reference bridge. */
export const enrollAnother = async (
	world: World,
	by: Device = world.owner,
	options: FakeAuthenticatorOptions = {},
) =>
	enrollRecoveryKey({
		account: world.account,
		rpId: RP_ID,
		userName: "person@example.test",
		roaming: false,
		keyring: by.keyring,
		bridge: createRecoveryBridge(
			fakeAuthenticator(world.provider, options),
			by.keyring,
		),
		transport: transportFor(world, by),
		rejections: createRejectionCounter(),
		anchor: world.anchor,
	});
