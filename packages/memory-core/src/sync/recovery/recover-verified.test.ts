import { afterAll, describe, expect, test } from "bun:test";
import { createRejectionCounter } from "../crypto/rejection.ts";
import {
	createRecoveryBridge,
	type RecoverInput,
	recoverOnFreshDevice,
} from "./index.ts";
import type { RecoveryTransport } from "./ports.ts";
import { fakeAuthenticator } from "./testing/fake-passkey.test-support.ts";
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
} from "./testing/world.test-support.ts";
import { loadWriteHold } from "./write-hold.ts";

afterAll(removeWorldStateDirs);

const recover = (
	world: World,
	device: Device,
	options: Partial<RecoverInput> = {},
) =>
	recoverOnFreshDevice({
		account: world.account,
		rpId: RP_ID,
		keyring: device.keyring,
		bridge: createRecoveryBridge(
			fakeAuthenticator(world.provider),
			device.keyring,
		),
		transport: options.transport ?? transportFor(world, device),
		rejections: createRejectionCounter(),
		stateDir: options.stateDir ?? freshStateDir(),
		onEvent: options.onEvent,
	});

type Members = (world: World, device: Device) => ReadonlyArray<Device["principal"]>;

/**
 * The server acknowledges our rotation, then serves a fork where the lost owner was never removed:
 * it approved this device and rotated to epoch + 1 itself. Every record on the fork verifies.
 */
const servingOwnerFork = (world: World, device: Device, members: Members) => {
	const base = transportFor(world, device);
	const before = world.server.chain(world.account).length;
	let fork: World | null = null;
	const served = (): RecoveryTransport =>
		fork === null ? base : transportFor(fork, device);
	const transport: RecoveryTransport = {
		...base,
		listKeys: () => served().listKeys(),
		listEntries: () => served().listEntries(),
		listRecoveryWraps: () => served().listRecoveryWraps(),
		appendKeys: async (request) => {
			if (request.record.kind !== "rotation") return base.appendKeys(request);
			const forked: World = {
				...world,
				server: world.server.withPrefix(world.account, before),
			};
			await approve(forked, device);
			await rotate(forked, world.owner, members(world, device));
			fork = forked;
			return { ok: true, seq: forked.server.chain(world.account).length };
		},
	};
	return { transport, fork: () => fork };
};

describe("the post-rotation reload must show this device's own rotation (#10450)", () => {
	const cases: ReadonlyArray<{ readonly name: string; readonly members: Members }> = [
		{
			name: "an epoch + 1 authority without this device",
			members: (world) => [world.owner.principal],
		},
		{
			name: "an epoch + 1 authority that keeps this device and the lost one",
			members: (world, device) => [world.owner.principal, device.principal],
		},
		{
			name: "an epoch + 1 rotation by the lost device to this device alone",
			members: (_world, device) => [device.principal],
		},
	];
	for (const { name, members } of cases) {
		test(`a reload showing ${name} keeps the hold`, async () => {
			const world = await createWorld();
			const device = await newDevice();
			const stateDir = freshStateDir();
			const served = servingOwnerFork(world, device, members);
			expect(
				await recover(world, device, { transport: served.transport, stateDir }),
			).toMatchObject({ ok: true, state: "joined-read-only" });
			const fork = served.fork();
			if (fork === null) throw new Error("the rotation never reached the server");
			const authority = (await verified(fork, device)).authority;
			expect(authority?.epoch).toBe(2);
			expect([...(authority?.members.keys() ?? [])].sort()).toEqual(
				members(world, device)
					.map((member) => member.id)
					.sort(),
			);
			expect(await loadWriteHold(stateDir, world.account)).toMatchObject({
				held: true,
			});
		});
	}
});

describe("a keyring record appended after our rotation still recovers (#10611)", () => {
	const followers: ReadonlyArray<{
		readonly name: string;
		readonly append: (world: World, device: Device) => Promise<unknown>;
	}> = [
		{
			name: "an approval",
			append: async (world, device) =>
				approve(world, await newDevice(), device),
		},
		{
			name: "a recovery key enrollment",
			append: (world, device) => enrollAnother(world, device),
		},
	];
	for (const { name, append } of followers) {
		test(`${name} landing before the reload ends recovered and releases the hold`, async () => {
			const world = await createWorld();
			const device = await newDevice();
			const stateDir = freshStateDir();
			const base = transportFor(world, device);
			let followed = false;
			const transport: RecoveryTransport = {
				...base,
				appendKeys: async (request) => {
					const stored = await base.appendKeys(request);
					if (stored.ok && request.record.kind === "rotation") {
						await append(world, device);
						followed = true;
					}
					return stored;
				},
			};
			const events: string[] = [];
			expect(
				await recover(world, device, {
					transport,
					stateDir,
					onEvent: (event) => events.push(event),
				}),
			).toMatchObject({ ok: true, state: "recovered", epoch: 2 });
			expect(followed).toBe(true);
			expect(events).toEqual(["sync.recovery.recovered"]);
			expect(await loadWriteHold(stateDir, world.account)).toEqual({
				held: false,
			});
		});
	}
});

describe("recovery events report the verified outcome (#10450)", () => {
	const outcome = async (
		world: World,
		device: Device,
		transport?: RecoveryTransport,
	): Promise<{ readonly state: unknown; readonly events: string[] }> => {
		const events: string[] = [];
		const result = await recover(world, device, {
			transport,
			onEvent: (event) => events.push(event),
		});
		return { state: Reflect.get(result, "state"), events };
	};

	test("a withheld rotation emits joined_read_only, never recovered", async () => {
		const world = await createWorld();
		world.server.refuseRotations = true;
		expect(await outcome(world, await newDevice())).toEqual({
			state: "joined-read-only",
			events: ["sync.recovery.joined_read_only"],
		});
	});

	test("an acknowledged rotation the reload does not show emits joined_read_only", async () => {
		const world = await createWorld();
		const device = await newDevice();
		const base = transportFor(world, device);
		const transport: RecoveryTransport = {
			...base,
			appendKeys: async (request) =>
				request.record.kind === "rotation"
					? { ok: true, seq: 999 }
					: base.appendKeys(request),
		};
		expect(await outcome(world, device, transport)).toEqual({
			state: "joined-read-only",
			events: ["sync.recovery.joined_read_only"],
		});
	});

	test("a verified rotation emits recovered once", async () => {
		const world = await createWorld();
		expect(await outcome(world, await newDevice())).toEqual({
			state: "recovered",
			events: ["sync.recovery.recovered"],
		});
	});
});
