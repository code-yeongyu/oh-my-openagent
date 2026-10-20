import { afterAll, describe, expect, test } from "bun:test";
import { createRejectionCounter } from "../crypto/rejection.ts";
import { loadTrustAnchor } from "../crypto/trust-pin.ts";
import type { RecoveryKeyPairs } from "./derive.ts";
import {
	createRecoveryBridge,
	type RecoverInput,
	recoverOnFreshDevice,
} from "./index.ts";
import type { RecoveryTransport } from "./ports.ts";
import { createRecoveryHandles } from "./recovery-handles.ts";
import { fakeAuthenticator } from "./testing/fake-passkey.test-support.ts";
import {
	createWorld,
	type Device,
	freshStateDir,
	newDevice,
	RP_ID,
	removeWorldStateDirs,
	transportFor,
	type World,
} from "./testing/world.test-support.ts";
import { loadWriteHold } from "./write-hold.ts";

afterAll(removeWorldStateDirs);

const zero = (keys: RecoveryKeyPairs): boolean =>
	keys.sealPrivate.every((byte) => byte === 0) &&
	keys.signSeed.every((byte) => byte === 0);

const recover = (
	world: World,
	device: Device,
	options: {
		readonly transport?: RecoveryTransport;
		readonly stateDir?: string;
		readonly derived?: RecoveryKeyPairs[];
	} & Partial<RecoverInput> = {},
) =>
	recoverOnFreshDevice({
		account: world.account,
		rpId: RP_ID,
		keyring: device.keyring,
		bridge: createRecoveryBridge(
			fakeAuthenticator(world.provider),
			device.keyring,
			{ onKeysDerived: (keys) => options.derived?.push(keys) },
		),
		transport: options.transport ?? transportFor(world, device),
		rejections: options.rejections ?? createRejectionCounter(),
		stateDir: options.stateDir ?? freshStateDir(),
	});

const failing = new Error("the server connection dropped");

describe("recovery after begin always disposes the held keys (#10412 review H1)", () => {
	const cases: ReadonlyArray<{
		readonly name: string;
		readonly tamper: (base: RecoveryTransport) => Partial<RecoveryTransport>;
	}> = [
		{
			name: "listEntries rejects",
			tamper: () => ({ listEntries: () => Promise.reject(failing) }),
		},
		{
			name: "listKeys rejects after begin",
			tamper: (base) => {
				let calls = 0;
				return {
					listKeys: () =>
						++calls === 1 ? base.listKeys() : Promise.reject(failing),
				};
			},
		},
		{
			name: "listRecoveryWraps rejects",
			tamper: () => ({ listRecoveryWraps: () => Promise.reject(failing) }),
		},
	];
	for (const { name, tamper } of cases) {
		test(`a thrown walk (${name}) leaves no live key`, async () => {
			const world = await createWorld();
			const fresh = await newDevice();
			const base = transportFor(world, fresh);
			const derived: RecoveryKeyPairs[] = [];
			await expect(
				recover(world, fresh, {
					transport: { ...base, ...tamper(base) },
					derived,
				}),
			).rejects.toThrow(failing.message);
			expect(derived.length).toBe(1);
			expect(derived.every(zero)).toBe(true);
		});
	}

	test("a thrown verification inside loadServedChain (the rejection counter throws) leaves no live key", async () => {
		const world = await createWorld();
		const fresh = await newDevice();
		const base = transportFor(world, fresh);
		let calls = 0;
		const forged: RecoveryTransport = {
			...base,
			listKeys: async () => {
				const rows = (await base.listKeys()) ?? [];
				return ++calls === 1
					? rows
					: rows.map((row) => ({ ...row, record_sig: "AAAA" }));
			},
		};
		const rejections = {
			...createRejectionCounter(),
			record: () => {
				throw failing;
			},
		};
		const derived: RecoveryKeyPairs[] = [];
		await expect(
			recover(world, fresh, { transport: forged, derived, rejections }),
		).rejects.toThrow(failing.message);
		expect(derived.length).toBe(1);
		expect(derived.every(zero)).toBe(true);
	});

	test("the handle store zeroes held keys when its TTL timer fires, with nothing else calling it", async () => {
		const timers: Array<() => void> = [];
		const store = createRecoveryHandles(Date.now, 1_000, (_ms, run) => {
			timers.push(run);
			return () => undefined;
		});
		const keys = {
			sealPrivate: new Uint8Array(32).fill(7),
			signSeed: new Uint8Array(32).fill(9),
		};
		const handle = store.hold({
			account: "a",
			credentialId: "c",
			sealing_public_key: "",
			signing_public_key: "",
			keys: keys as unknown as RecoveryKeyPairs,
		});
		expect(timers.length).toBe(1);
		timers[0]?.();
		expect(keys.sealPrivate.every((byte) => byte === 0)).toBe(true);
		expect(keys.signSeed.every((byte) => byte === 0)).toBe(true);
		expect(store.take(handle)).toBeNull();
	});
});

describe("the trust pin is checked before any join (#10412 review M1)", () => {
	test("a device pinned to one root refuses a second, different identity under the same account name, before begin's keys are used", async () => {
		const first = await createWorld();
		const second = await createWorld();
		expect(first.account).toBe(second.account);
		const device = await newDevice();
		const stateDir = freshStateDir();
		const recovered = await recover(first, device, { stateDir });
		expect(recovered.ok).toBe(true);
		const pinnedBefore = await loadTrustAnchor(stateDir, first.account);
		const before = second.server.chain(second.account).length;
		const derived: RecoveryKeyPairs[] = [];
		expect(await recover(second, device, { stateDir, derived })).toEqual({
			ok: false,
			reason: "pin-conflict",
			next: "re-pair or recover",
		});
		expect(second.server.chain(second.account).length).toBe(before);
		expect(derived.length).toBe(1);
		expect(derived.every(zero)).toBe(true);
		expect(await loadTrustAnchor(stateDir, first.account)).toEqual(
			pinnedBefore,
		);
	});
});

describe("read-only after a withheld rotation is persisted (#10412 review M3)", () => {
	test("the write hold survives the process and is released by a recovery whose rotation lands", async () => {
		const world = await createWorld();
		const device = await newDevice();
		const stateDir = freshStateDir();
		world.server.refuseRotations = true;
		expect(await recover(world, device, { stateDir })).toMatchObject({
			ok: true,
			state: "joined-read-only",
		});
		expect(await loadWriteHold(stateDir, world.account)).toEqual({
			held: true,
			credentialId: world.firstKey,
		});
		world.server.refuseRotations = false;
		const again = await newDevice();
		expect(await recover(world, again, { stateDir })).toMatchObject({
			ok: true,
			state: "recovered",
		});
		expect(await loadWriteHold(stateDir, world.account)).toEqual({
			held: false,
		});
	});
});

describe("the write hold never fails open (#10412 review r2)", () => {
	test("a crash right after the join lands leaves the device held", async () => {
		const world = await createWorld();
		const device = await newDevice();
		const stateDir = freshStateDir();
		const base = transportFor(world, device);
		const transport: RecoveryTransport = {
			...base,
			recoveryJoin: async (request) => {
				await base.recoveryJoin(request);
				throw new Error("the process died after the join landed");
			},
		};
		await expect(
			recover(world, device, { transport, stateDir }),
		).rejects.toThrow("the process died");
		expect(await loadWriteHold(stateDir, world.account)).toMatchObject({
			held: true,
		});
	});

	test("a rotation the server acknowledges but does not store keeps the hold", async () => {
		const world = await createWorld();
		const device = await newDevice();
		const stateDir = freshStateDir();
		const base = transportFor(world, device);
		const transport: RecoveryTransport = {
			...base,
			appendKeys: async (request) =>
				request.record.kind === "rotation"
					? { ok: true, seq: 999 }
					: base.appendKeys(request),
		};
		expect(await recover(world, device, { transport, stateDir })).toMatchObject(
			{
				ok: true,
				state: "joined-read-only",
			},
		);
		expect(await loadWriteHold(stateDir, world.account)).toMatchObject({
			held: true,
		});
	});
});

describe("a join the reload does not show is reported as unconfirmed (#10412 review L1)", () => {
	test("join-unconfirmed, distinct from a refused join, and no pin is written", async () => {
		const world = await createWorld();
		const fresh = await newDevice();
		const stateDir = freshStateDir();
		const base = transportFor(world, fresh);
		const hidden = world.server.chain(world.account).length;
		const transport: RecoveryTransport = {
			...base,
			recoveryJoin: async (request) => {
				const joined = await base.recoveryJoin(request);
				world.server.servedPrefix = hidden;
				return joined;
			},
		};
		expect(await recover(world, fresh, { transport, stateDir })).toEqual({
			ok: false,
			reason: "join-unconfirmed",
		});
		expect(await loadTrustAnchor(stateDir, world.account)).toMatchObject({
			ok: false,
			reason: "no_pin",
		});
	});

	test("a reload that fails after the join is unconfirmed too", async () => {
		const world = await createWorld();
		const fresh = await newDevice();
		const base = transportFor(world, fresh);
		let joined = false;
		const transport: RecoveryTransport = {
			...base,
			recoveryJoin: async (request) => {
				const result = await base.recoveryJoin(request);
				joined = true;
				return result;
			},
			listEntries: async () => (joined ? null : base.listEntries()),
		};
		expect(await recover(world, fresh, { transport })).toEqual({
			ok: false,
			reason: "join-unconfirmed",
		});
	});
});
