import { afterAll, describe, expect, test } from "bun:test";
import { openBatch } from "../crypto/open.ts";
import { createRejectionCounter } from "../crypto/rejection.ts";
import { openWrap } from "../crypto/unwrap.ts";
import {
	createRecoveryBridge,
	type RecoverInput,
	recoverOnFreshDevice,
	removeRecoveryKey,
} from "./index.ts";
import { expectedHistory } from "./served-chain.ts";
import {
	type FakeAuthenticatorOptions,
	fakeAuthenticator,
} from "./testing/fake-passkey.test-support.ts";
import type { FakeSyncServer } from "./testing/fake-server.test-support.ts";
import {
	approve,
	createWorld,
	type Device,
	enrollAnother,
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

const recoverWith = async (
	world: World,
	device: Device,
	options: FakeAuthenticatorOptions = {},
	extra: Partial<RecoverInput> & { readonly server?: FakeSyncServer } = {},
) =>
	recoverOnFreshDevice({
		account: world.account,
		rpId: RP_ID,
		keyring: device.keyring,
		bridge: createRecoveryBridge(
			fakeAuthenticator(world.provider, options),
			device.keyring,
		),
		transport: transportFor(world, device, extra.server),
		rejections: createRejectionCounter(),
		stateDir: freshStateDir(),
		...extra,
	});

/** Every batch on the verified chain, opened with the keys this device can reach through its own wrap. */
const readAll = async (
	world: World,
	device: Device,
	server: FakeSyncServer = world.server,
): Promise<ReadonlyArray<string>> => {
	const state = await verified(world, device, server);
	const authority = state.authority;
	if (authority === null) throw new Error("no authority");
	const wrap = state.received
		.flatMap((entry) => entry.wraps)
		.find(
			(candidate) =>
				candidate.epoch === authority.epoch &&
				candidate.id === `device:${device.principal.id}`,
		);
	if (wrap === undefined) return [];
	const opened = await openWrap(
		device.keyring,
		wrap,
		world.account,
		new Map(expectedHistory(authority, authority.epoch)),
	);
	if (!opened.ok) return [];
	const keyFor = (epoch: number) =>
		epoch === authority.epoch
			? opened.keys.current
			: opened.keys.history.get(epoch);
	const texts: string[] = [];
	for (const entry of server.chain(world.account)) {
		if (entry.kind !== "batch" || entry.author.kind !== "device") continue;
		const key = keyFor(entry.epoch);
		const object = world.objects.get(entry.digest);
		if (key === undefined || object === undefined) continue;
		const binding = {
			account: world.account,
			epoch: entry.epoch,
			authorId: entry.author.id,
			signingPublicKey: entry.author.signing_public_key,
			digest: entry.digest,
			kind: "ops" as const,
		};
		const result = await openBatch(
			object.bytes,
			binding,
			key,
			createRejectionCounter(),
		);
		if (result.ok)
			texts.push(
				...result.records.map((item) => new TextDecoder().decode(item.body)),
			);
	}
	return texts;
};

afterAll(removeWorldStateDirs);

describe("recovery on a fresh device (sync-design section 7)", () => {
	test("after several rotations the recovered device reads every retained batch, under a fresh epoch wrapped only to it and the used key", async () => {
		const world = await createWorld();
		await writeBatch(world, "epoch one");
		await rotate(world);
		await writeBatch(world, "epoch two");
		await rotate(world);
		await writeBatch(world, "epoch three");
		await rotate(world);
		await writeBatch(world, "epoch four");
		const fresh = await newDevice();
		const outcome = await recoverWith(world, fresh);
		expect(outcome).toEqual({
			ok: true,
			state: "recovered",
			epoch: 5,
			credentialId: world.firstKey,
		});
		expect(await readAll(world, fresh)).toEqual([
			"epoch one",
			"epoch two",
			"epoch three",
			"epoch four",
		]);
		const state = await verified(world, fresh);
		const last = state.received.at(-1);
		expect(last?.body.kind).toBe("rotation");
		expect(last?.wraps.map((wrap) => wrap.id)).toEqual([
			`device:${fresh.principal.id}`,
			`recovery:${world.firstKey}`,
		]);
		expect([...(state.authority?.members.keys() ?? [])]).toEqual([
			fresh.principal.id,
		]);
	});

	test("a signed-in session without the passkey unwraps nothing and appends nothing", async () => {
		const world = await createWorld();
		await writeBatch(world, "secret");
		const before = world.server.chain(world.account).length;
		const fresh = await newDevice();
		expect(await recoverWith(world, fresh, { cancel: true })).toEqual({
			ok: false,
			reason: "cancelled",
		});
		expect(world.server.chain(world.account).length).toBe(before);
		expect(await readAll(world, fresh)).toEqual([]);
	});

	test("a removed recovery key is refused before any join, even when the user still holds it", async () => {
		const world = await createWorld();
		const second = await enrollAnother(world);
		if (!second.ok) throw new Error(`enrollment failed: ${second.reason}`);
		const removed = world.firstKey;
		const outcome = await removeRecoveryKey({
			account: world.account,
			rpId: RP_ID,
			credentialId: removed,
			confirmGivingUpRecovery: false,
			keyring: world.owner.keyring,
			bridge: null,
			transport: transportFor(world, world.owner),
			rejections: createRejectionCounter(),
			anchor: world.anchor,
		});
		expect(outcome.ok).toBe(true);
		const before = world.server.chain(world.account).length;
		const fresh = await newDevice();
		expect(await recoverWith(world, fresh, { choose: () => removed })).toEqual({
			ok: false,
			reason: "history-incomplete",
		});
		expect(world.server.chain(world.account).length).toBe(before);
	});

	test("a server serving an older keyring cannot make the next epoch reach a revoked device or a removed passkey", async () => {
		const world = await createWorld();
		const laptop = await newDevice();
		await approve(world, laptop);
		const second = await enrollAnother(world);
		if (!second.ok) throw new Error(`enrollment failed: ${second.reason}`);
		const stalePrefix = world.server.chain(world.account).length;
		await rotate(world, world.owner, [world.owner.principal]);
		await removeRecoveryKey({
			account: world.account,
			rpId: RP_ID,
			credentialId: second.credentialId,
			confirmGivingUpRecovery: false,
			keyring: world.owner.keyring,
			bridge: null,
			transport: transportFor(world, world.owner),
			rejections: createRejectionCounter(),
			anchor: world.anchor,
		});
		const stale = world.server.withPrefix(world.account, stalePrefix);
		const fresh = await newDevice();
		const outcome = await recoverWith(
			world,
			fresh,
			{ choose: () => world.firstKey },
			{ server: stale },
		);
		expect(outcome.ok).toBe(true);
		const state = await verified(world, fresh, stale);
		const rotation = state.received.at(-1);
		expect(rotation?.body.kind).toBe("rotation");
		expect(rotation?.wraps.map((wrap) => wrap.id)).toEqual([
			`device:${fresh.principal.id}`,
			`recovery:${world.firstKey}`,
		]);
		expect(state.authority?.registry.has(second.credentialId)).toBe(false);
		expect(state.authority?.members.has(laptop.principal.id)).toBe(false);
	});

	test("a withheld post-join rotation leaves the recovered device joined but read-only", async () => {
		const world = await createWorld();
		world.server.refuseRotations = true;
		const fresh = await newDevice();
		expect(await recoverWith(world, fresh)).toEqual({
			ok: true,
			state: "joined-read-only",
			credentialId: world.firstKey,
		});
	});
});
