import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRejectionCounter } from "../crypto/rejection.ts";
import { loadTrustAnchor } from "../crypto/trust-pin.ts";
import {
	createRecoveryBridge,
	type RecoverInput,
	recoverOnFreshDevice,
} from "./index.ts";
import type { RecoveryBridge } from "./ports.ts";
import { recoveryCandidates } from "./served-chain.ts";
import { fakeAuthenticator } from "./testing/fake-passkey.test-support.ts";
import {
	createWorld,
	type Device,
	newDevice,
	RP_ID,
	removeWorldStateDirs,
	transportFor,
	verified,
	type World,
} from "./testing/world.test-support.ts";

const withStateDir = async <T>(
	run: (stateDir: string) => Promise<T>,
): Promise<T> => {
	const stateDir = await mkdtemp(join(tmpdir(), "omo-recovery-anchor-"));
	try {
		return await run(stateDir);
	} finally {
		await rm(stateDir, { recursive: true, force: true });
	}
};

const counting = (
	bridge: RecoveryBridge,
): { readonly bridge: RecoveryBridge; readonly finishes: () => number } => {
	let finishes = 0;
	return {
		bridge: {
			...bridge,
			recoverFinish: (request) => (finishes++, bridge.recoverFinish(request)),
		},
		finishes: () => finishes,
	};
};

const input = (
	world: World,
	device: Device,
	bridge: RecoveryBridge,
	stateDir: string,
	transport = transportFor(world, device),
): RecoverInput => ({
	account: world.account,
	rpId: RP_ID,
	keyring: device.keyring,
	bridge,
	transport,
	rejections: createRejectionCounter(),
	stateDir,
});

afterAll(removeWorldStateDirs);

describe("anchored recovery (todo 17, review r3 option A)", () => {
	test("recovery anchors its walk at the enrolling record with the derived keys, then pins the trust anchor", async () => {
		const world = await createWorld();
		const fresh = await newDevice();
		await withStateDir(async (stateDir) => {
			const outcome = await recoverOnFreshDevice(
				input(
					world,
					fresh,
					createRecoveryBridge(
						fakeAuthenticator(world.provider),
						fresh.keyring,
					),
					stateDir,
				),
			);
			expect(outcome.ok && outcome.state).toBe("recovered");
			const pin = await loadTrustAnchor(stateDir, world.account);
			expect(pin.ok && pin.anchor.genesisDigest).toBe(
				world.server.chain(world.account)[0]?.digest,
			);
		});
	});

	test("a served recovery record with a wrong salt fails the anchor: finish never runs, nothing is appended, nothing is pinned", async () => {
		const world = await createWorld();
		const fresh = await newDevice();
		const genuine = transportFor(world, fresh);
		const transport = {
			...genuine,
			listKeys: async () =>
				(await genuine.listKeys())?.map((row) => {
					const bootstrap = Object(row.body["bootstrap"]);
					if (bootstrap.recovery_key === undefined) return row;
					const nonce = new Uint8Array(32).fill(7);
					const recoveryKey = {
						...bootstrap.recovery_key,
						enrollment_nonce: Buffer.from(nonce).toString("base64url"),
					};
					return {
						...row,
						body: {
							...row.body,
							bootstrap: { ...bootstrap, recovery_key: recoveryKey },
						},
					};
				}) ?? null,
		};
		const spy = counting(
			createRecoveryBridge(fakeAuthenticator(world.provider), fresh.keyring),
		);
		const before = world.server.chain(world.account).length;
		await withStateDir(async (stateDir) => {
			const outcome = await recoverOnFreshDevice(
				input(world, fresh, spy.bridge, stateDir, transport),
			);
			expect(outcome.ok).toBe(false);
			expect(spy.finishes()).toBe(0);
			expect(world.server.chain(world.account).length).toBe(before);
			expect((await loadTrustAnchor(stateDir, world.account)).ok).toBe(false);
		});
	});

	test("served recovery records fabricated by the server never reach finish", async () => {
		const world = await createWorld();
		const forged = await createWorld(world.account);
		const fresh = await newDevice();
		const forgedKey = Object(
			forged.server.chain(world.account)[0]?.kind === "keyring"
				? forged.server.chain(world.account)[0]
				: {},
		).body?.bootstrap?.recovery_key;
		const credential = world.provider.credentials[0];
		if (credential === undefined || forgedKey === undefined)
			throw new Error("fixture");
		world.provider.credentials.push({
			...credential,
			id: String(forgedKey.credential_id),
		});
		const spy = counting(
			createRecoveryBridge(
				fakeAuthenticator(world.provider, {
					choose: () => String(forgedKey.credential_id),
					canEnumerate: false,
				}),
				fresh.keyring,
			),
		);
		await withStateDir(async (stateDir) => {
			const outcome = await recoverOnFreshDevice(
				input(
					world,
					fresh,
					spy.bridge,
					stateDir,
					transportFor(world, fresh, forged.server),
				),
			);
			expect(outcome).toEqual({ ok: false, reason: "key-mismatch" });
			expect(spy.finishes()).toBe(0);
			expect(forged.server.chain(world.account).length).toBe(1);
		});
	});
});

describe("the reference bridge's recovery handle (todo 17, review r3 option A)", () => {
	const begun = async (now: () => number) => {
		const world = await createWorld();
		const fresh = await newDevice();
		const disposed: Uint8Array[][] = [];
		const bridge = createRecoveryBridge(
			fakeAuthenticator(world.provider),
			fresh.keyring,
			{
				now,
				onKeysDerived: (keys) =>
					disposed.push([keys.sealPrivate, keys.signSeed]),
			},
		);
		const state = await verified(world, world.owner);
		const enrolled = [...(state.authority?.registry.values() ?? [])];
		const begin = await bridge.recoverBegin({
			account: world.account,
			rpId: RP_ID,
			salts: enrolled.map((key) => ({
				credentialId: key.credential_id,
				enrollmentNonce: key.enrollment_nonce,
			})),
			knownCredentialIds: enrolled.map((key) => key.credential_id),
			acknowledgeUnknown: false,
		});
		if (!begin.ok) throw new Error(`begin refused: ${begin.reason}`);
		const candidate = recoveryCandidates(
			state,
			(await transportFor(world, fresh).listRecoveryWraps()) ?? [],
		)[0];
		if (candidate === undefined) throw new Error("no candidate");
		const head = state.head;
		if (head === null || state.authority === null) throw new Error("no head");
		const finish = (handle = begin.handle, chosen = candidate) =>
			bridge.recoverFinish({
				handle,
				account: world.account,
				candidate: chosen,
				device: fresh.principal,
				join: {
					epoch: state.authority?.epoch ?? 0,
					keyringHead: head.keyring_link,
					baseSeq: head.seq,
					priorLink: head.link,
				},
			});
		return { bridge, begin, candidate, finish, disposed, world };
	};

	const zeroed = (keys: ReadonlyArray<Uint8Array>) =>
		keys.every((bytes) => bytes.every((byte) => byte === 0));

	test("begin returns only the credential id and the derived public keys", async () => {
		const { begin, candidate } = await begun(() => 0);
		expect(Object.keys(begin).sort()).toEqual([
			"credentialId",
			"handle",
			"ok",
			"sealing_public_key",
			"signing_public_key",
		]);
		expect(begin.sealing_public_key).toBe(candidate.key.sealing_public_key);
		expect(begin.handle).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	test("a finish after the two-minute TTL is refused with its next step, and the keys are already zeroed", async () => {
		let clock = 0;
		const { finish, disposed } = await begun(() => clock);
		clock = 120_001;
		expect(await finish()).toEqual({ ok: false, reason: "recovery-expired" });
		expect(disposed.length).toBe(1);
		expect(zeroed(disposed[0] ?? [])).toBe(true);
	});

	test("a handle is one-shot: a second finish is refused", async () => {
		const { finish, disposed } = await begun(() => 0);
		expect((await finish()).ok).toBe(true);
		expect(zeroed(disposed[0] ?? [])).toBe(true);
		expect(await finish()).toEqual({ ok: false, reason: "recovery-expired" });
	});

	test("a candidate whose enrolling record's keys differ from the handle's is refused, and the handle dies", async () => {
		const { finish, candidate, disposed } = await begun(() => 0);
		const other = {
			...candidate,
			key: {
				...candidate.key,
				signing_public_key: candidate.key.sealing_public_key,
			},
		};
		expect(await finish(undefined, other)).toEqual({
			ok: false,
			reason: "key-mismatch",
		});
		expect(zeroed(disposed[0] ?? [])).toBe(true);
		expect(await finish()).toEqual({ ok: false, reason: "recovery-expired" });
	});

	test("an unknown handle is refused like an expired one", async () => {
		const { finish } = await begun(() => 0);
		expect(await finish("A".repeat(43))).toEqual({
			ok: false,
			reason: "recovery-expired",
		});
	});

	test("a second begin disposes the first handle: one live handle at a time", async () => {
		const { bridge, begin, finish, disposed, world } = await begun(() => 0);
		const again = await bridge.recoverBegin({
			account: world.account,
			rpId: RP_ID,
			salts: [],
			knownCredentialIds: [],
			acknowledgeUnknown: true,
		});
		expect(zeroed(disposed[0] ?? [])).toBe(true);
		expect(again.ok).toBe(false);
		expect(await finish(begin.handle)).toEqual({
			ok: false,
			reason: "recovery-expired",
		});
	});

	test("abort zeroes the keys and kills the handle", async () => {
		const { bridge, begin, finish, disposed } = await begun(() => 0);
		await bridge.recoverAbort(begin.handle);
		expect(zeroed(disposed[0] ?? [])).toBe(true);
		expect(await finish()).toEqual({ ok: false, reason: "recovery-expired" });
	});
});
