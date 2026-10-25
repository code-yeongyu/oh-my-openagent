import { afterAll, describe, expect, test } from "bun:test";
import { appendEntries } from "../crypto/chain.ts";
import type { KeyringEntry } from "../crypto/entry.ts";
import { nextLink } from "../crypto/links.ts";
import { createRejectionCounter } from "../crypto/rejection.ts";
import { taggedHash } from "../crypto/signatures.ts";
import { b64urlDecode } from "../crypto/vendor/sync-format/jcs.ts";
import {
	deriveRecoveryKeys,
	recoveryPrfSalt,
	recoveryUserHandle,
} from "./derive.ts";
import {
	APPROVAL_PATH_MESSAGE,
	classifyRecoveryJoin,
	createRecoveryBridge,
	recoverOnFreshDevice,
	recoveryAvailability,
} from "./index.ts";
import { openWrapWithKey } from "./key-material.ts";
import { signedAppend } from "./keyring-append.ts";
import { expectedHistory } from "./served-chain.ts";
import {
	type FakeAuthenticatorOptions,
	fakeAuthenticator,
} from "./testing/fake-passkey.test-support.ts";
import { FakeSyncServer } from "./testing/fake-server.test-support.ts";
import {
	createWorld,
	type Device,
	freshStateDir,
	newDevice,
	RP_ID,
	removeWorldStateDirs,
	rotate,
	transportFor,
	verified,
	type World,
	writeBatch,
} from "./testing/world.test-support.ts";

const recover = (
	world: World,
	device: Device,
	options: FakeAuthenticatorOptions = {},
	server: FakeSyncServer = world.server,
	account = world.account,
) =>
	recoverOnFreshDevice({
		account,
		rpId: RP_ID,
		keyring: device.keyring,
		bridge: createRecoveryBridge(
			fakeAuthenticator(world.provider, options),
			device.keyring,
		),
		transport: server.transport(account, { ...device.principal }),
		rejections: createRejectionCounter(),
		stateDir: freshStateDir(),
	});

const lastKeyring = (world: World): KeyringEntry => {
	const entry = world.server
		.chain(world.account)
		.findLast(
			(candidate): candidate is KeyringEntry =>
				candidate.kind === "keyring" && candidate.body.kind === "recovery-join",
		);
	if (entry === undefined) throw new Error("no recovery-join on the chain");
	return entry;
};

afterAll(removeWorldStateDirs);

describe("recovery refusals and the surviving devices' view", () => {
	test("a recovery-join replayed against a later head is refused by every receiver", async () => {
		const world = await createWorld();
		const fresh = await newDevice();
		expect((await recover(world, fresh)).ok).toBe(true);
		const join = lastKeyring(world);
		const later = await verified(world, fresh);
		const head = later.head;
		if (head === null) throw new Error("no head");
		const link = await nextLink(head.link, join.digest);
		const keyringLink = await nextLink(head.keyring_link, join.digest);
		if (link === null || keyringLink === null) throw new Error("links");
		const replay: KeyringEntry = {
			...join,
			seq: head.seq + 1,
			base_seq: head.seq,
			link,
			keyring_link: keyringLink,
		};
		const outcome = await appendEntries(
			later,
			[replay],
			createRejectionCounter(),
		);
		expect(outcome.ok).toBe(false);
		if (!outcome.ok)
			expect(["bad_signature", "bad_keyring_head"]).toContain(outcome.reason);
	});

	test("a join on a head the surviving device never verified raises the fork prompt; on its own head it is the excluded-member notice", async () => {
		const world = await createWorld();
		await writeBatch(world, "kept");
		const survivor = await verified(world, world.owner);
		const fresh = await newDevice();
		const forked = world.server.withPrefix(world.account, 1);
		expect((await recover(world, fresh, {}, forked)).ok).toBe(true);
		const foreignJoin = forked
			.chain(world.account)
			.find(
				(entry): entry is KeyringEntry =>
					entry.kind === "keyring" && entry.body.kind === "recovery-join",
			);
		if (foreignJoin === undefined)
			throw new Error("no join on the forked branch");
		expect(
			classifyRecoveryJoin(survivor, foreignJoin, world.owner.principal.id),
		).toMatchObject({
			kind: "foreign",
			prompt: "a-device-joined-using-your-passkey",
			actions: ["veto", "confirm"],
		});
		const linear = await newDevice();
		expect((await recover(world, linear)).ok).toBe(true);
		expect(
			classifyRecoveryJoin(
				survivor,
				lastKeyring(world),
				world.owner.principal.id,
			),
		).toMatchObject({ kind: "excluded" });
	});

	test("the sixth recovery-join in an hour is refused and appends nothing", async () => {
		const world = await createWorld();
		for (let attempt = 1; attempt <= 5; attempt += 1)
			expect((await recover(world, await newDevice())).ok).toBe(true);
		const before = world.server.chain(world.account).length;
		expect(await recover(world, await newDevice())).toEqual({
			ok: false,
			reason: "rate_limited",
		});
		expect(world.server.chain(world.account).length).toBe(before);
	});

	test("another account's session cannot read A's recovery wraps or append A's join: the same not-found", async () => {
		const world = await createWorld("account-a");
		const intruder = await newDevice();
		const asB = world.server.transport("account-b", { ...intruder.principal });
		expect(await asB.listRecoveryWraps()).toEqual([]);
		expect(
			await recover(world, intruder, {}, world.server, "account-b"),
		).toEqual({ ok: false, reason: "no-recovery-key" });
		const join = {
			record: { kind: "recovery-join", account: "account-a", epoch: 1 },
			base_seq: 1,
			link: "",
			keyring_link: "",
			record_sig: "",
			wraps: [],
		};
		expect(await asB.recoveryJoin(join)).toEqual({
			ok: false,
			reason: "not_found",
		});
		expect(await asB.appendKeys(join)).toEqual({
			ok: false,
			reason: "not_found",
		});
	});

	test("a server-forged genesis carrying the genuine recovery public keys fails before any join", async () => {
		const world = await createWorld();
		const forger = await newDevice();
		const genesis = world.server.chain(world.account)[0];
		if (genesis?.kind !== "keyring") throw new Error("no genesis");
		const bootstrap = {
			...Object(genesis.body["bootstrap"]),
			first_device: { ...forger.principal },
		};
		const forgedServer = new FakeSyncServer();
		const body = {
			...genesis.body,
			bootstrap,
			custody_root: await taggedHash("omo-sync/v1/custody-root", bootstrap),
		};
		await forgedServer
			.transport(world.account, { ...forger.principal })
			.appendKeys(
				await signedAppend(
					forger.keyring,
					{ seq: 0, link: "", keyring_link: "" },
					body,
					genesis.wraps,
				),
			);
		const fresh = await newDevice();
		expect(await recover(world, fresh, {}, forgedServer)).toEqual({
			ok: false,
			reason: "unverified",
		});
		expect(forgedServer.chain(world.account).length).toBe(1);
	});

	test("a self-consistent forged history that enrolls operator-made keys under the user's credential id fails the anchor check", async () => {
		const world = await createWorld();
		const genuine = world.server.chain(world.account)[0];
		if (genuine?.kind !== "keyring") throw new Error("no genesis");
		const forged = await createWorld(world.account);
		const forgedGenesis = forged.server.chain(world.account)[0];
		if (forgedGenesis?.kind !== "keyring") throw new Error("no forged genesis");
		const genuineKey = Object(genuine.body["bootstrap"]).recovery_key;
		const forgedKey = Object(forgedGenesis.body["bootstrap"]).recovery_key;
		expect(forgedKey.signing_public_key).not.toBe(
			genuineKey.signing_public_key,
		);
		const credential = world.provider.credentials[0];
		if (credential === undefined) throw new Error("no credential");
		world.provider.credentials.push({
			...credential,
			id: String(forgedKey.credential_id),
		});
		const fresh = await newDevice();
		expect(
			await recover(
				world,
				fresh,
				{ choose: () => String(forgedKey.credential_id), canEnumerate: false },
				forged.server,
			),
		).toEqual({ ok: false, reason: "key-mismatch" });
		expect(forged.server.chain(world.account).length).toBe(1);
	});

	test("recovery wraps swapped between epochs or accounts fail the AEAD", async () => {
		const world = await createWorld();
		await rotate(world);
		const state = await verified(world, world.owner);
		const credential = world.provider.credentials[0];
		const genesis = state.received[0];
		const rotation = state.received[1];
		if (
			credential === undefined ||
			genesis === undefined ||
			rotation === undefined ||
			state.authority === null
		)
			throw new Error("fixture");
		const nonce = b64urlDecode(
			String(Object(genesis.body["bootstrap"]).recovery_key.enrollment_nonce),
		);
		const keys = await deriveRecoveryKeys(
			world.provider.prf(
				credential,
				await recoveryPrfSalt(world.account, nonce),
			),
			nonce,
		);
		const id = `recovery:${credential.id}`;
		const epoch1 = genesis.wraps.find((wrap) => wrap.id === id);
		const epoch2 = rotation.wraps.find((wrap) => wrap.id === id);
		if (epoch1 === undefined || epoch2 === undefined) throw new Error("wraps");
		const history = new Map(expectedHistory(state.authority, 2));
		expect(
			(
				await openWrapWithKey(
					keys.sealPrivate,
					keys.sealPublic,
					epoch2,
					{ account: world.account, epoch: 2, id },
					history,
				)
			).ok,
		).toBe(true);
		expect(
			await openWrapWithKey(
				keys.sealPrivate,
				keys.sealPublic,
				{ ...epoch1, epoch: 2 },
				{ account: world.account, epoch: 2, id },
				history,
			),
		).toEqual({ ok: false, reason: "wrap_refused" });
		expect(
			await openWrapWithKey(
				keys.sealPrivate,
				keys.sealPublic,
				epoch2,
				{ account: "another-account", epoch: 2, id },
				history,
			),
		).toEqual({ ok: false, reason: "wrap_refused" });
	});

	test("an account-matched passkey the served chain never enrolled refuses recovery unless the user acknowledges it", async () => {
		const world = await createWorld();
		world.provider.add(RP_ID, await recoveryUserHandle(world.account));
		world.provider.add(RP_ID, await recoveryUserHandle("someone-else"));
		const fresh = await newDevice();
		expect(
			await recover(world, fresh, { choose: () => world.firstKey }),
		).toEqual({ ok: false, reason: "history-incomplete" });
		const acknowledged = await recoverOnFreshDevice({
			account: world.account,
			rpId: RP_ID,
			keyring: fresh.keyring,
			bridge: createRecoveryBridge(
				fakeAuthenticator(world.provider, { choose: () => world.firstKey }),
				fresh.keyring,
			),
			transport: transportFor(world, fresh),
			rejections: createRejectionCounter(),
			stateDir: freshStateDir(),
			acknowledgeUnknownCredential: true,
		});
		expect(acknowledged.ok).toBe(true);
	});

	test("without a PRF-capable native bridge (the CLI, older macOS) only the approval path is offered", async () => {
		const world = await createWorld();
		const fresh = await newDevice();
		expect(recoveryAvailability(null)).toEqual({
			kind: "approval-only",
			reason: "no-native-bridge",
			message: APPROVAL_PATH_MESSAGE,
		});
		const noPrf = createRecoveryBridge(
			fakeAuthenticator(world.provider, { prfSupported: false }),
			fresh.keyring,
		);
		expect(recoveryAvailability(noPrf)).toMatchObject({
			kind: "approval-only",
			reason: "no-prf",
		});
		expect(await recover(world, fresh, { prfSupported: false })).toEqual({
			ok: false,
			reason: "approval-required",
		});
	});

	test("an assertion without user verification is never accepted", async () => {
		const world = await createWorld();
		const before = world.server.chain(world.account).length;
		expect(
			await recover(world, await newDevice(), {
				assertFlags: {
					userVerified: false,
					backupEligible: true,
					backupState: true,
				},
			}),
		).toEqual({ ok: false, reason: "no-user-verification" });
		expect(world.server.chain(world.account).length).toBe(before);
	});
});
