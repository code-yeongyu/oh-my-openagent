import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { createRejectionCounter } from "../crypto/rejection.ts";
import {
	createRecoveryBridge,
	recoverOnFreshDevice,
	removeRecoveryKey,
} from "./index.ts";
import type { EpochMaterial } from "./key-material.ts";
import * as KeyMaterial from "./key-material.ts";
import * as KeyringAppend from "./keyring-append.ts";
import type { RecoveryEvent, RecoveryTransport } from "./ports.ts";
import { fakeAuthenticator } from "./testing/fake-passkey.test-support.ts";
import {
	createWorld,
	enrollAnother,
	freshStateDir,
	newDevice,
	RP_ID,
	removeWorldStateDirs,
	transportFor,
	type World,
} from "./testing/world.test-support.ts";

afterAll(removeWorldStateDirs);

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
	for (const spy of spies.splice(0)) spy.mockRestore();
});

const zeroed = (material: EpochMaterial): boolean =>
	material.current.every((byte) => byte === 0) &&
	material.history.every((row) => row.key.every((byte) => byte === 0));

const captureOwnMaterial = (): EpochMaterial[] => {
	const opened: EpochMaterial[] = [];
	const original = KeyringAppend.ownMaterial;
	const spy = spyOn(KeyringAppend, "ownMaterial").mockImplementation(
		async (...args) => {
			const material = await original(...args);
			if (material !== null) opened.push(material);
			return material;
		},
	);
	spies.push(spy);
	return opened;
};

const remove = (
	world: World,
	credentialId: string,
	transport: RecoveryTransport = transportFor(world, world.owner),
	events: RecoveryEvent[] = [],
) =>
	removeRecoveryKey({
		account: world.account,
		rpId: RP_ID,
		credentialId,
		confirmGivingUpRecovery: false,
		keyring: world.owner.keyring,
		bridge: null,
		transport,
		rejections: createRejectionCounter(),
		anchor: world.anchor,
		onEvent: (event) => events.push(event),
	});

const twoKeys = async () => {
	const world = await createWorld();
	const second = await enrollAnother(world);
	if (!second.ok) throw new Error(`enrollment failed: ${second.reason}`);
	return { world, second: second.credentialId };
};

describe("removal zeroes the epoch key it opens on every exit (#10412 review H2)", () => {
	test("after a completed removal", async () => {
		const { world, second } = await twoKeys();
		const opened = captureOwnMaterial();
		expect((await remove(world, second)).ok).toBe(true);
		expect(opened.length).toBe(1);
		expect(opened.every(zeroed)).toBe(true);
	});

	test("after the removal append is refused", async () => {
		const { world, second } = await twoKeys();
		const opened = captureOwnMaterial();
		const base = transportFor(world, world.owner);
		const refusing: RecoveryTransport = {
			...base,
			appendKeys: async () => ({ ok: false, reason: "refused" }),
		};
		expect(await remove(world, second, refusing)).toEqual({
			ok: false,
			reason: "refused",
		});
		expect(opened.every(zeroed)).toBe(true);
		expect(opened.length).toBe(1);
	});

	test("after the rotation append throws", async () => {
		const { world, second } = await twoKeys();
		const opened = captureOwnMaterial();
		const base = transportFor(world, world.owner);
		const throwing: RecoveryTransport = {
			...base,
			appendKeys: async (request) => {
				if (request.record.kind === "rotation") throw new Error("dropped");
				return base.appendKeys(request);
			},
		};
		await expect(remove(world, second, throwing)).rejects.toThrow("dropped");
		expect(opened.length).toBe(1);
		expect(opened.every(zeroed)).toBe(true);
	});
});

describe("recovery zeroes the recovered epoch key when the rotation throws (#10412 review H2)", () => {
	test("the material opened from the bridge's wrap is zero after a thrown rotation append", async () => {
		const world = await createWorld();
		const fresh = await newDevice();
		const opened: EpochMaterial[] = [];
		const original = KeyMaterial.openBridgeSealedWrap;
		spies.push(
			spyOn(KeyMaterial, "openBridgeSealedWrap").mockImplementation(
				async (...args) => {
					const result = await original(...args);
					if (result.ok) opened.push(result.material);
					return result;
				},
			),
		);
		const base = transportFor(world, fresh);
		const transport: RecoveryTransport = {
			...base,
			appendKeys: async (request) => {
				if (request.record.kind === "rotation") throw new Error("dropped");
				return base.appendKeys(request);
			},
		};
		await expect(
			recoverOnFreshDevice({
				account: world.account,
				rpId: RP_ID,
				keyring: fresh.keyring,
				bridge: createRecoveryBridge(
					fakeAuthenticator(world.provider),
					fresh.keyring,
				),
				transport,
				rejections: createRejectionCounter(),
				stateDir: freshStateDir(),
			}),
		).rejects.toThrow("dropped");
		expect(opened.length).toBe(1);
		expect(opened.every(zeroed)).toBe(true);
	});
});

describe("removal succeeds only once its rotation is stored (#10412 review M2)", () => {
	test("an acknowledged but unstored rotation is rotation-pending with no removed event, and a retry completes it", async () => {
		const { world, second } = await twoKeys();
		const base = transportFor(world, world.owner);
		const lying: RecoveryTransport = {
			...base,
			appendKeys: async (request) =>
				request.record.kind === "rotation"
					? { ok: true, seq: 999 }
					: base.appendKeys(request),
		};
		const events: RecoveryEvent[] = [];
		expect(await remove(world, second, lying, events)).toEqual({
			ok: false,
			reason: "rotation-pending",
			platformSignal: "unsupported",
			deleteFromPasskeyManager: true,
		});
		expect(events).not.toContain("sync.recovery.removed");
		const retried = await remove(world, second, base, events);
		expect(retried).toMatchObject({ ok: true });
		expect(events.filter((event) => event === "sync.recovery.removed")).toEqual(
			["sync.recovery.removed"],
		);
	});

	test("a refused rotation is rotation-pending, not success", async () => {
		const { world, second } = await twoKeys();
		world.server.refuseRotations = true;
		const events: RecoveryEvent[] = [];
		expect(
			await remove(world, second, transportFor(world, world.owner), events),
		).toMatchObject({ ok: false, reason: "rotation-pending" });
		expect(events).toEqual([]);
	});
});
