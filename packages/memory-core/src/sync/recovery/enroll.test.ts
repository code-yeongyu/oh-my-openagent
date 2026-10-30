import { afterAll, describe, expect, test } from "bun:test";
import { createRejectionCounter } from "../crypto/rejection.ts";
import { removeRecoveryKey } from "./index.ts";
import { MAX_RECOVERY_KEYS } from "./salt-inputs.ts";
import {
	createWorld,
	enrollAnother,
	newDevice,
	RP_ID,
	removeWorldStateDirs,
	transportFor,
	verified,
} from "./testing/world.test-support.ts";

const NOT_BACKED_UP = {
	userVerified: true,
	backupEligible: true,
	backupState: false,
};

afterAll(removeWorldStateDirs);

describe("enrolling and removing recovery passkeys (sync-design section 7)", () => {
	test("a synced passkey enrolls with one countersigned wrap that every member verifies", async () => {
		const world = await createWorld();
		const enrolled = await enrollAnother(world);
		expect(enrolled.ok).toBe(true);
		const state = await verified(world, world.owner);
		const record = state.received.at(-1);
		expect(record?.body.kind).toBe("recovery-key");
		expect(record?.body["survivable"]).toBe("synced");
		expect(record?.wraps.map((wrap) => wrap.id)).toEqual([
			`recovery:${enrolled.ok ? enrolled.credentialId : ""}`,
		]);
	});

	test("a platform that returns no PRF at creation enrolls through the follow-up assertion", async () => {
		const world = await createWorld();
		expect(
			(await enrollAnother(world, world.owner, { prfAtCreate: false })).ok,
		).toBe(true);
	});

	test("a credential whose backup never completes is not labeled recovery, is signalled removed, and appends nothing", async () => {
		const world = await createWorld();
		const before = world.server.chain(world.account).length;
		const outcome = await enrollAnother(world, world.owner, {
			createFlags: NOT_BACKED_UP,
			assertFlags: NOT_BACKED_UP,
		});
		expect(outcome).toEqual({ ok: false, reason: "not-survivable" });
		expect(world.server.chain(world.account).length).toBe(before);
		expect(world.provider.signals).toHaveLength(1);
	});

	test("BS is re-checked at the follow-up assertion before the label is refused", async () => {
		const world = await createWorld();
		expect(
			(await enrollAnother(world, world.owner, { createFlags: NOT_BACKED_UP }))
				.ok,
		).toBe(true);
	});

	test("a platform with no PRF output in either place fails before any record exists", async () => {
		const world = await createWorld();
		const before = world.server.chain(world.account).length;
		expect(
			await enrollAnother(world, world.owner, { prfSupported: false }),
		).toEqual({ ok: false, reason: "no-prf" });
		expect(world.server.chain(world.account).length).toBe(before);
	});

	test("a device that is not a keyring member cannot enroll", async () => {
		const world = await createWorld();
		expect(await enrollAnother(world, await newDevice())).toEqual({
			ok: false,
			reason: "not-member",
		});
	});

	test("removal is member-signed, rotates the key out, signals the platform and tells the user to delete it", async () => {
		const world = await createWorld();
		const second = await enrollAnother(world);
		if (!second.ok) throw new Error(second.reason);
		const outcome = await removeRecoveryKey({
			account: world.account,
			rpId: RP_ID,
			credentialId: second.credentialId,
			confirmGivingUpRecovery: false,
			keyring: world.owner.keyring,
			bridge: {
				prfSupported: true,
				enroll: async () => ({ ok: false, reason: "cancelled" }),
				recoverBegin: async () => ({ ok: false, reason: "cancelled" }),
				recoverFinish: async () => ({ ok: false, reason: "cancelled" }),
				recoverAbort: async () => {},
				signalRemoved: async () => "signalled",
			},
			transport: transportFor(world, world.owner),
			rejections: createRejectionCounter(),
			anchor: world.anchor,
		});
		expect(outcome).toEqual({
			ok: true,
			epoch: 2,
			platformSignal: "signalled",
			deleteFromPasskeyManager: true,
		});
		const state = await verified(world, world.owner);
		expect(state.received.at(-1)?.wraps.map((wrap) => wrap.id)).toEqual([
			`device:${world.owner.principal.id}`,
			`recovery:${world.firstKey}`,
		]);
	});

	test("removing the last recovery key needs explicit confirmation", async () => {
		const world = await createWorld();
		const remove = (confirm: boolean) =>
			removeRecoveryKey({
				account: world.account,
				rpId: RP_ID,
				credentialId: world.firstKey,
				confirmGivingUpRecovery: confirm,
				keyring: world.owner.keyring,
				bridge: null,
				transport: transportFor(world, world.owner),
				rejections: createRejectionCounter(),
				anchor: world.anchor,
			});
		expect(await remove(false)).toEqual({
			ok: false,
			reason: "confirm-last-key",
		});
		expect((await remove(true)).ok).toBe(true);
	});

	test(`an account holding ${MAX_RECOVERY_KEYS} recovery keys refuses another (#10412 review H3)`, async () => {
		const world = await createWorld();
		for (let held = 1; held < MAX_RECOVERY_KEYS; held += 1) {
			const enrolled = await enrollAnother(world);
			if (!enrolled.ok)
				throw new Error(`enrollment failed: ${enrolled.reason}`);
		}
		expect(await enrollAnother(world)).toEqual({
			ok: false,
			reason: "too-many-recovery-keys",
		});
	});
});
