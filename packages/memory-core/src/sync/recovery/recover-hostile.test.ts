import { afterAll, describe, expect, test } from "bun:test";
import { createRejectionCounter } from "../crypto/rejection.ts";
import type { RecoveryKeyPairs } from "./derive.ts";
import { createRecoveryBridge, recoverOnFreshDevice } from "./index.ts";
import type { RecoveryTransport } from "./ports.ts";
import { MAX_RECOVERY_KEYS } from "./salt-inputs.ts";
import { fakeAuthenticator } from "./testing/fake-passkey.test-support.ts";
import {
	createWorld,
	freshStateDir,
	newDevice,
	RP_ID,
	removeWorldStateDirs,
	transportFor,
} from "./testing/world.test-support.ts";

afterAll(removeWorldStateDirs);

const zero = (keys: RecoveryKeyPairs): boolean =>
	keys.sealPrivate.every((byte) => byte === 0) &&
	keys.signSeed.every((byte) => byte === 0);

/** A server response the transport passed through without parsing: anything at all. */
const raw = <T>(value: unknown): Promise<T> => Promise.resolve(value as T);

type Hostile = {
	readonly name: string;
	readonly reason: string;
	readonly tamper: (base: RecoveryTransport) => Partial<RecoveryTransport>;
};

const hostile: ReadonlyArray<Hostile> = [
	{
		name: "a non-JSON keys body before begin",
		reason: "unavailable",
		tamper: () => ({ listKeys: () => raw("<html>502 Bad Gateway</html>") }),
	},
	{
		name: "a non-JSON entries body",
		reason: "unavailable",
		tamper: () => ({ listEntries: () => raw("<html>502 Bad Gateway</html>") }),
	},
	{
		name: "a non-JSON recovery-wraps body",
		reason: "unavailable",
		tamper: () => ({ listRecoveryWraps: () => raw("not json") }),
	},
	{
		name: "a null row inside the entries list",
		reason: "unverified",
		tamper: (base) => ({
			listEntries: async () =>
				raw([...((await base.listEntries()) ?? []), null]),
		}),
	},
	{
		name: "truncated entry rows (fields missing)",
		reason: "unverified",
		tamper: (base) => ({
			listEntries: async () =>
				raw(
					((await base.listEntries()) ?? []).map(({ seq, kind }) => ({
						seq,
						kind,
					})),
				),
		}),
	},
	{
		name: "wrong types (seq as a string)",
		reason: "unverified",
		tamper: (base) => ({
			listEntries: async () =>
				raw(
					((await base.listEntries()) ?? []).map((row) => ({
						...row,
						seq: String(row.seq),
					})),
				),
		}),
	},
	{
		name: "an oversized list of junk recovery-wrap rows",
		reason: "not-enrolled",
		tamper: () => ({
			listRecoveryWraps: () =>
				raw(
					Array.from({ length: 50_000 }, (_, index) =>
						index % 2 === 0 ? index : { entry: null },
					),
				),
		}),
	},
];

describe("hostile server responses fail closed with a typed refusal (#10412 review H3)", () => {
	for (const { name, reason, tamper } of hostile) {
		test(name, async () => {
			const world = await createWorld();
			const fresh = await newDevice();
			const base = transportFor(world, fresh);
			const before = world.server.chain(world.account).length;
			const derived: RecoveryKeyPairs[] = [];
			const outcome = await recoverOnFreshDevice({
				account: world.account,
				rpId: RP_ID,
				keyring: fresh.keyring,
				bridge: createRecoveryBridge(
					fakeAuthenticator(world.provider),
					fresh.keyring,
					{ onKeysDerived: (keys) => derived.push(keys) },
				),
				transport: { ...base, ...tamper(base) },
				rejections: createRejectionCounter(),
				stateDir: freshStateDir(),
			});
			expect(outcome).toEqual({ ok: false, reason } as typeof outcome);
			expect(world.server.chain(world.account).length).toBe(before);
			expect(derived.every(zero)).toBe(true);
		});
	}

	test("junk rows beside the real recovery-wrap row are ignored, and recovery still completes", async () => {
		const world = await createWorld();
		const fresh = await newDevice();
		const base = transportFor(world, fresh);
		const outcome = await recoverOnFreshDevice({
			account: world.account,
			rpId: RP_ID,
			keyring: fresh.keyring,
			bridge: createRecoveryBridge(
				fakeAuthenticator(world.provider),
				fresh.keyring,
			),
			transport: {
				...base,
				listRecoveryWraps: async () =>
					raw([
						null,
						7,
						{ entry: "x" },
						...((await base.listRecoveryWraps()) ?? []),
					]),
			},
			rejections: createRejectionCounter(),
			stateDir: freshStateDir(),
		});
		expect(outcome).toMatchObject({ ok: true, state: "recovered" });
	});

	test(`more than ${MAX_RECOVERY_KEYS} enrolled credentials are refused before the authenticator is asked`, async () => {
		const world = await createWorld();
		const fresh = await newDevice();
		const base = transportFor(world, fresh);
		let asserted = false;
		const authenticator = fakeAuthenticator(world.provider);
		const flood = Array.from({ length: MAX_RECOVERY_KEYS + 1 }, (_, index) => ({
			seq: 1_000 + index,
			body: {
				kind: "recovery-key",
				credential_id: `flood-${index}`,
				enrollment_nonce: "n",
			},
		}));
		const outcome = await recoverOnFreshDevice({
			account: world.account,
			rpId: RP_ID,
			keyring: fresh.keyring,
			bridge: createRecoveryBridge(
				{
					...authenticator,
					assert: async (request) => {
						asserted = true;
						return authenticator.assert(request);
					},
				},
				fresh.keyring,
			),
			transport: { ...base, listKeys: async () => raw(flood) },
			rejections: createRejectionCounter(),
			stateDir: freshStateDir(),
		});
		expect(outcome).toEqual({ ok: false, reason: "too-many-recovery-keys" });
		expect(asserted).toBe(false);
	});
});
