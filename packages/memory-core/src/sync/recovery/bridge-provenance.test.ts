import { describe, expect, test } from "bun:test";
import type { WrapEntry } from "../crypto/entry.ts";
import { wrapSetDigest } from "../crypto/links.ts";
import { provenRecoveryMaterial } from "./bridge-provenance.ts";
import { deriveRecoveryKeys, publicKeyText } from "./derive.ts";
import { type HistoryKey, sealWrap } from "./key-material.ts";
import type { RecoveryCandidate } from "./ports.ts";

// Security contract (desktop #2897 review r4 H2): the reference bridge opens a recovery wrap only
// when the countersigned enrolling record's wrap list binds it, by digest and by the enrollment key.

const ACCOUNT = "acct_provenance";
const CREDENTIAL = "cred-1";
const ID = `recovery:${CREDENTIAL}`;
const ORIGIN = "device:owner";
const random32 = () => crypto.getRandomValues(new Uint8Array(32));

const setup = async () => {
	const keys = await deriveRecoveryKeys(random32(), random32());
	const recoveryPublic = publicKeyText(keys).sealing_public_key;
	const deviceKeys = await deriveRecoveryKeys(random32(), random32());
	const devicePublic = publicKeyText(deviceKeys).sealing_public_key;
	const epochKey = random32();
	const seal = (
		epoch: number,
		id: string,
		recipient: string,
		current: Uint8Array,
		history: ReadonlyArray<HistoryKey> = [],
	): Promise<WrapEntry> =>
		sealWrap({ account: ACCOUNT, epoch, id }, recipient, {
			epoch,
			current,
			history,
		});
	const recoveryWrap = await seal(1, ID, recoveryPublic, epochKey);
	const deviceWrap = await seal(1, ORIGIN, devicePublic, epochKey);
	const later = (epoch: number, history: ReadonlyArray<HistoryKey>) =>
		seal(epoch, ID, recoveryPublic, random32(), history);
	const digestOf = async (wraps: ReadonlyArray<WrapEntry>) => {
		const check = await wrapSetDigest(wraps);
		return check.ok ? check.digest : "duplicate";
	};
	const candidate = async (
		wrap: WrapEntry,
		listed: ReadonlyArray<WrapEntry>,
		countersigned: ReadonlyArray<WrapEntry> = listed,
		expectedHistory: ReadonlyArray<readonly [number, string]> = [],
	): Promise<RecoveryCandidate> => ({
		key: {
			credential_id: CREDENTIAL,
			rp_id: "recovery.sync.test",
			enrollment_nonce: "",
			...publicKeyText(keys),
			survivable: "synced",
		},
		countersign: {
			custodyRoot: "",
			predecessor: "",
			wrapsDigest: await digestOf(countersigned),
			signature: "",
		},
		wrap,
		expectedHistory,
		enrollment: { wraps: listed, expectedHistory: [] },
	});
	const outcome = async (subject: RecoveryCandidate) => {
		const result = await provenRecoveryMaterial(ACCOUNT, subject, keys);
		return typeof result === "string" ? result : "opened";
	};
	return {
		keys,
		epochKey,
		recoveryWrap,
		deviceWrap,
		later,
		seal,
		candidate,
		outcome,
	};
};

describe("reference bridge wrap provenance (todo 17, desktop #2897 review r4 H2)", () => {
	test("a genesis-enrolled key (device and recovery wraps countersigned together) opens its wrap", async () => {
		const w = await setup();
		const genesis = [w.deviceWrap, w.recoveryWrap];
		expect(await w.outcome(await w.candidate(w.recoveryWrap, genesis))).toBe(
			"opened",
		);
	});

	test("a key enrolled by its own recovery-key record (one countersigned wrap) opens its wrap", async () => {
		const w = await setup();
		expect(
			await w.outcome(await w.candidate(w.recoveryWrap, [w.recoveryWrap])),
		).toBe("opened");
	});

	test("a later wrap carrying the enrollment key at the enrollment epoch opens", async () => {
		const w = await setup();
		const later = await w.later(2, [
			{ epoch: 1, origin: ORIGIN, key: w.epochKey },
		]);
		const genesis = [w.deviceWrap, w.recoveryWrap];
		expect(
			await w.outcome(
				await w.candidate(later, genesis, genesis, [[1, ORIGIN]]),
			),
		).toBe("opened");
	});

	test("a countersigned list with one wrap swapped, added, removed or reordered binds nothing (the digest is order-sensitive)", async () => {
		const w = await setup();
		const genesis = [w.deviceWrap, w.recoveryWrap];
		const stranger = await w.seal(
			1,
			"device:other",
			publicKeyText(w.keys).sealing_public_key,
			random32(),
		);
		for (const served of [
			[stranger, w.recoveryWrap],
			[w.deviceWrap, w.recoveryWrap, stranger],
			[w.recoveryWrap],
			[w.recoveryWrap, w.deviceWrap],
		]) {
			expect(
				await w.outcome(await w.candidate(w.recoveryWrap, served, genesis)),
			).toBe("wrap-unbound");
		}
	});

	test("two recovery entries for the credential bind nothing, even under a matching digest", async () => {
		const w = await setup();
		const twin = await w.seal(
			1,
			ID,
			publicKeyText(w.keys).sealing_public_key,
			random32(),
		);
		const doubled = [
			w.recoveryWrap,
			{ ...twin, epoch: 1, id: ID, wrap: twin.wrap },
		];
		expect(await w.outcome(await w.candidate(w.recoveryWrap, doubled))).toBe(
			"wrap-unbound",
		);
	});

	test("a countersigned list with no recovery entry for the credential binds nothing", async () => {
		const w = await setup();
		expect(
			await w.outcome(await w.candidate(w.recoveryWrap, [w.deviceWrap])),
		).toBe("wrap-unbound");
	});

	test("a list whose entries span two epochs binds nothing, even under a matching digest", async () => {
		const w = await setup();
		const otherEpoch = await w.seal(
			2,
			ORIGIN,
			publicKeyText(w.keys).sealing_public_key,
			random32(),
		);
		const mixed = [otherEpoch, w.recoveryWrap];
		expect(await w.outcome(await w.candidate(w.recoveryWrap, mixed))).toBe(
			"wrap-unbound",
		);
	});

	test("the reviewer's PoC: an attacker wrap at epoch 9 beside a replayed countersignature is refused", async () => {
		const w = await setup();
		const attacker = await w.later(9, []);
		expect(
			await w.outcome(
				await w.candidate(attacker, [w.deviceWrap, w.recoveryWrap]),
			),
		).toBe("wrap-unbound");
	});

	test("a wrap at or before the enrollment epoch is not a later wrap, even carrying the enrollment key", async () => {
		const w = await setup();
		const genesis = [w.deviceWrap, w.recoveryWrap];
		for (const epoch of [1, 0]) {
			const notLater = await w.later(epoch, [
				{ epoch: 1, origin: ORIGIN, key: w.epochKey },
			]);
			expect(
				await w.outcome(
					await w.candidate(notLater, genesis, genesis, [[1, ORIGIN]]),
				),
			).toBe("wrap-unbound");
		}
	});

	test("a later wrap with a wrong key, or the enrollment key at another epoch, is refused", async () => {
		const w = await setup();
		const genesis = [w.deviceWrap, w.recoveryWrap];
		const wrongKey = await w.later(2, [
			{ epoch: 1, origin: ORIGIN, key: random32() },
		]);
		const shifted = await w.later(3, [
			{ epoch: 1, origin: ORIGIN, key: random32() },
			{ epoch: 2, origin: ORIGIN, key: w.epochKey },
		]);
		expect(
			await w.outcome(
				await w.candidate(wrongKey, genesis, genesis, [[1, ORIGIN]]),
			),
		).toBe("wrap-unbound");
		expect(
			await w.outcome(
				await w.candidate(shifted, genesis, genesis, [
					[1, ORIGIN],
					[2, ORIGIN],
				]),
			),
		).toBe("wrap-unbound");
	});
});
