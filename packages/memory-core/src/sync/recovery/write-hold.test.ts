import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir as mkdirOnce } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as Resilient from "../../fs/resilient";
import * as Fsync from "../../journal/fsync";
import { createRejectionCounter } from "../crypto/rejection.ts";
import { createRecoveryBridge, recoverOnFreshDevice } from "./index.ts";
import { fakeAuthenticator } from "./testing/fake-passkey.test-support.ts";
import {
	createWorld,
	freshStateDir,
	newDevice,
	RP_ID,
	removeWorldStateDirs,
	transportFor,
} from "./testing/world.test-support.ts";
import { holdWrites, loadWriteHold } from "./write-hold.ts";

afterAll(removeWorldStateDirs);

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
	for (const spy of spies.splice(0)) spy.mockRestore();
});

describe("the write hold survives a power loss (#10450)", () => {
	test("the staged hold is fsynced before the rename, and the directories after it", async () => {
		const stateDir = freshStateDir();
		const calls: string[] = [];
		const syncFile = Fsync.syncJournalFile;
		const syncDir = Fsync.syncJournalDirectory;
		const rename = Resilient.rename;
		spies.push(
			spyOn(Fsync, "syncJournalFile").mockImplementation(async (path) => {
				calls.push(`sync-file ${path.endsWith(".tmp") ? "staging" : path}`);
				return syncFile(path);
			}),
			spyOn(Fsync, "syncJournalDirectory").mockImplementation(async (path) => {
				calls.push(`sync-dir ${path === stateDir ? "state" : "hold"}`);
				return syncDir(path);
			}),
			spyOn(Resilient, "rename").mockImplementation(async (from, to) => {
				calls.push("rename");
				expect(dirname(String(to))).toBe(dirname(String(from)));
				return rename(from, to);
			}),
		);
		await holdWrites(stateDir, "acct", "cred");
		expect(calls).toEqual([
			"sync-dir state",
			"sync-file staging",
			"rename",
			"sync-dir hold",
		]);
		expect(await loadWriteHold(stateDir, "acct")).toEqual({
			held: true,
			credentialId: "cred",
		});
	});

	test("a state directory the hold creates is fsynced into its parent before the hold is staged (#10611)", async () => {
		const parent = freshStateDir();
		const stateDir = join(parent, "state", "sync");
		const names = new Map([
			[parent, "parent"],
			[dirname(stateDir), "middle"],
			[stateDir, "state"],
			[join(stateDir, "recovery-hold"), "hold"],
		]);
		const calls: string[] = [];
		const syncFile = Fsync.syncJournalFile;
		const syncDir = Fsync.syncJournalDirectory;
		spies.push(
			spyOn(Fsync, "syncJournalFile").mockImplementation(async (path) => {
				calls.push("sync-file staging");
				return syncFile(path);
			}),
			spyOn(Fsync, "syncJournalDirectory").mockImplementation(async (path) => {
				calls.push(`sync-dir ${names.get(path) ?? path}`);
				return syncDir(path);
			}),
		);
		await holdWrites(stateDir, "acct", "cred");
		expect(calls).toEqual([
			"sync-dir parent",
			"sync-dir middle",
			"sync-dir state",
			"sync-file staging",
			"sync-dir hold",
		]);
		expect(await loadWriteHold(stateDir, "acct")).toEqual({
			held: true,
			credentialId: "cred",
		});
	});

	test("an EINTR retry of the mkdir that created the state directory still fsyncs it into its parent (#10611 review)", async () => {
		const parent = freshStateDir();
		const stateDir = join(parent, "state");
		const synced: string[] = [];
		let interrupted = 0;
		const syncDir = Fsync.syncJournalDirectory;
		spies.push(
			spyOn(Resilient, "mkdir").mockImplementation((path, options) =>
				Resilient.retryOnEintr(async (): Promise<undefined> => {
					await mkdirOnce(path, options);
					if (interrupted === 0) {
						interrupted += 1;
						throw Object.assign(new Error("interrupted system call"), { code: "EINTR" });
					}
					return undefined;
				}),
			),
			spyOn(Fsync, "syncJournalDirectory").mockImplementation(async (path) => {
				synced.push(path);
				return syncDir(path);
			}),
		);
		await holdWrites(stateDir, "acct", "cred");
		expect(interrupted).toBe(1);
		expect(synced.slice(0, 2)).toEqual([parent, stateDir]);
		expect(await loadWriteHold(stateDir, "acct")).toEqual({
			held: true,
			credentialId: "cred",
		});
	});

	test("a crash while the hold is made durable stops recovery before its join is sent", async () => {
		const world = await createWorld();
		const device = await newDevice();
		const stateDir = freshStateDir();
		const before = world.server.chain(world.account).length;
		spies.push(
			spyOn(Fsync, "syncJournalFile").mockImplementation(async () => {
				throw new Error("the device lost power");
			}),
		);
		await expect(
			recoverOnFreshDevice({
				account: world.account,
				rpId: RP_ID,
				keyring: device.keyring,
				bridge: createRecoveryBridge(
					fakeAuthenticator(world.provider),
					device.keyring,
				),
				transport: transportFor(world, device),
				rejections: createRejectionCounter(),
				stateDir,
			}),
		).rejects.toThrow("the device lost power");
		expect(world.server.chain(world.account).length).toBe(before);
		expect(await loadWriteHold(stateDir, world.account)).toEqual({
			held: false,
		});
	});
});
