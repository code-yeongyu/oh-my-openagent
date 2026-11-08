import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	spyOn,
	test,
} from "bun:test";
import { isObject } from "../crypto/parse.ts";
import { createRejectionCounter } from "../crypto/rejection.ts";
import { b64urlDecode } from "../crypto/vendor/sync-format/jcs.ts";
import { deriveRecoveryKeys } from "./derive.ts";
import {
	createRecoveryBridge,
	enrollRecoveryKey,
	type RecoveryBridge,
	type RecoveryEvent,
	recoverOnFreshDevice,
} from "./index.ts";
import { fakeAuthenticator } from "./testing/fake-passkey.test-support.ts";
import {
	createWorld,
	freshStateDir,
	newDevice,
	RP_ID,
	removeWorldStateDirs,
	transportFor,
	verified,
} from "./testing/world.test-support.ts";

const encodings = (bytes: Uint8Array): ReadonlyArray<string> => {
	const buffer = Buffer.from(bytes);
	return [
		buffer.toString("base64url"),
		buffer.toString("base64"),
		buffer.toString("hex"),
	];
};

const recording = (bridge: RecoveryBridge, sink: string[]): RecoveryBridge => ({
	prfSupported: bridge.prfSupported,
	enroll: async (request) => {
		const result = await bridge.enroll(request);
		sink.push(JSON.stringify(result));
		return result;
	},
	recoverBegin: async (request) => {
		const result = await bridge.recoverBegin(request);
		sink.push(JSON.stringify(result));
		return result;
	},
	recoverFinish: async (request) => {
		const result = await bridge.recoverFinish(request);
		sink.push(JSON.stringify(result));
		return result;
	},
	recoverAbort: bridge.recoverAbort,
	signalRemoved: bridge.signalRemoved,
});

afterAll(removeWorldStateDirs);

describe("PRF output and derived recovery keys never reach logs, telemetry or any boundary", () => {
	const logged: string[] = [];
	const spies: Array<ReturnType<typeof spyOn>> = [];
	beforeEach(() => {
		logged.length = 0;
		for (const method of ["log", "info", "warn", "error", "debug"] as const) {
			spies.push(
				spyOn(console, method).mockImplementation(
					(...args: unknown[]) => void logged.push(args.map(String).join(" ")),
				),
			);
		}
	});
	afterEach(() => {
		for (const spy of spies.splice(0)) spy.mockRestore();
	});

	test("enroll and recover end to end: zero canary hits", async () => {
		const world = await createWorld();
		const crossings: string[] = [];
		const events: RecoveryEvent[] = [];
		const rejections = createRejectionCounter((line) => logged.push(line));
		const enrolled = await enrollRecoveryKey({
			account: world.account,
			rpId: RP_ID,
			userName: "person@example.test",
			roaming: false,
			keyring: world.owner.keyring,
			bridge: recording(
				createRecoveryBridge(
					fakeAuthenticator(world.provider),
					world.owner.keyring,
				),
				crossings,
			),
			transport: transportFor(world, world.owner),
			rejections,
			anchor: world.anchor,
			onEvent: (event) => void events.push(event),
		});
		expect(enrolled.ok).toBe(true);
		const fresh = await newDevice();
		const recovered = await recoverOnFreshDevice({
			account: world.account,
			rpId: RP_ID,
			keyring: fresh.keyring,
			bridge: recording(
				createRecoveryBridge(
					fakeAuthenticator(world.provider, {
						choose: () => (enrolled.ok ? enrolled.credentialId : null),
					}),
					fresh.keyring,
				),
				crossings,
			),
			transport: transportFor(world, fresh),
			rejections,
			stateDir: freshStateDir(),
			onEvent: (event) => void events.push(event),
		});
		expect(recovered.ok).toBe(true);
		const nonces = (await verified(world, fresh)).received.flatMap((entry) => {
			const nested = entry.body["bootstrap"];
			const source =
				entry.body.kind === "genesis"
					? isObject(nested)
						? nested["recovery_key"]
						: undefined
					: entry.body["enrollment_nonce"];
			const nonce = isObject(source) ? source["enrollment_nonce"] : source;
			return typeof nonce === "string" ? [b64urlDecode(nonce)] : [];
		});
		const canaries: string[] = [];
		for (const prf of world.provider.prfOutputs) {
			canaries.push(...encodings(prf));
			for (const nonce of nonces) {
				const derived = await deriveRecoveryKeys(prf, nonce);
				canaries.push(
					...encodings(derived.sealPrivate),
					...encodings(derived.signSeed),
				);
			}
		}
		expect(world.provider.prfOutputs.length).toBeGreaterThanOrEqual(2);
		const surfaces = [
			...logged,
			...events,
			...crossings,
			...world.server.requests,
		].join("\n");
		expect(canaries.filter((canary) => surfaces.includes(canary))).toEqual([]);
		expect(events).toEqual([
			"sync.recovery.enrolled",
			"sync.recovery.recovered",
		]);
	});
});
