import { describe, expect, test } from "bun:test";
import { newDeviceKeyring } from "../crypto/testing/genesis.ts";
import {
	type EpochMaterial,
	openBridgeSealedWrap,
	sealWrap,
} from "./key-material.ts";

const ACCOUNT = "acct_bridge_sealed";

const material = (): EpochMaterial => ({
	epoch: 3,
	current: crypto.getRandomValues(new Uint8Array(32)),
	history: [],
});

describe("the bridge-sealed device wrap opener (todo 17)", () => {
	test("opens only the wrap sealed to this device at its own address", async () => {
		const keyring = await newDeviceKeyring();
		const address = {
			account: ACCOUNT,
			epoch: 3,
			id: `device:${keyring.principal().id}`,
		};
		const sealing = keyring.publicKeys().sealing;
		const sent = material();
		const wrap = await sealWrap(address, sealing, sent);
		const opened = await openBridgeSealedWrap(
			keyring,
			wrap,
			address,
			new Map(),
		);
		expect(opened.ok && [...opened.material.current]).toEqual([
			...sent.current,
		]);
	});

	test("refuses a wrap addressed to another device, epoch or account", async () => {
		const keyring = await newDeviceKeyring();
		const other = await newDeviceKeyring();
		const own = {
			account: ACCOUNT,
			epoch: 3,
			id: `device:${keyring.principal().id}`,
		};
		const sealing = keyring.publicKeys().sealing;
		const otherAddress = { ...own, id: `device:${other.principal().id}` };
		const toOther = await sealWrap(
			otherAddress,
			other.publicKeys().sealing,
			material(),
		);
		expect(
			await openBridgeSealedWrap(keyring, toOther, otherAddress, new Map()),
		).toEqual({ ok: false, reason: "envelope_mismatch" });
		const wrap = await sealWrap(own, sealing, material());
		expect(
			await openBridgeSealedWrap(
				keyring,
				wrap,
				{ ...own, epoch: 4 },
				new Map(),
			),
		).toEqual({ ok: false, reason: "envelope_mismatch" });
		expect(
			await openBridgeSealedWrap(
				keyring,
				wrap,
				{ ...own, account: "acct_other" },
				new Map(),
			),
		).toEqual({ ok: false, reason: "wrap_refused" });
	});
});
