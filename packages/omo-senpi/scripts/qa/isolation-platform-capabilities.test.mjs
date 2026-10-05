import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	directoryIdentityAvailable,
	isolationVerdict,
	protectedSnapshotsUntouched,
	scopedIsolationVerdict,
	snapshotDirectory,
	snapshotProtectedState,
} from "./isolation-state.mjs";

const LIMITS = { maxFiles: 10, maxBytes: 1024, maxEntries: 10 };
const linuxIt = test.skipIf(process.platform !== "linux");
const unsupportedNativeIt = test.skipIf(process.platform === "linux");

function codedError(code) {
	return Object.assign(new Error(code), { code });
}

linuxIt(
	"#given a native Linux runtime #when directory identity is checked #then secure traversal support is active",
	() => {
		expect(directoryIdentityAvailable()).toBe(true);
	},
);

unsupportedNativeIt(
	"#given an unsupported native runtime claims Linux #when a missing root is created #then the claim cannot elevate traversal support",
	() => {
		const parent = mkdtempSync(join(tmpdir(), "omo-senpi-native-capability-"));
		try {
			const root = join(parent, "missing");
			const before = snapshotDirectory(root, LIMITS, { platform: "linux" });
			mkdirSync(root);
			writeFileSync(join(root, "created.json"), "mutated");
			const after = snapshotDirectory(root, LIMITS, { platform: "linux" });
			const protectedState = {
				snapshot: new Map(),
				complete: true,
				errors: [],
			};

			expect(before.complete).toBe(false);
			expect(before.errors).toEqual([
				{ path: ".", code: "DIRECTORY_IDENTITY_UNAVAILABLE" },
			]);
			expect(after.complete).toBe(false);
			expect(after.errors).toEqual(before.errors);
			expect(
				scopedIsolationVerdict([{ name: "HOME", before, after }]).certified,
			).toBe(false);
			expect(
				isolationVerdict({
					beforeProtected: protectedState,
					afterProtected: protectedState,
					beforeObserved: before,
					afterObserved: after,
					observedChangedPaths: [],
				}).untouched,
			).toBe(false);
		} finally {
			rmSync(parent, { recursive: true, force: true });
		}
	},
);

test("#given Darwin lacks incremental descriptor enumeration #when isolation is observed #then capability failure is explicit and cannot certify", () => {
	const root = mkdtempSync(join(tmpdir(), "omo-senpi-darwin-descriptor-"));
	try {
		for (let index = 0; index < 50; index += 1)
			writeFileSync(join(root, `state-${index}.json`), "stable");
		let opened = false;
		const result = snapshotDirectory(
			root,
			{ ...LIMITS, maxEntries: 8 },
			{
				platform: "darwin",
				opendirSync() {
					opened = true;
					throw codedError("ENOTDIR");
				},
			},
		);

		expect(directoryIdentityAvailable("darwin")).toBe(false);
		expect(opened).toBe(false);
		expect(result.complete).toBe(false);
		expect(result.errors).toEqual([
			{ path: ".", code: "DIRECTORY_IDENTITY_UNAVAILABLE" },
		]);
		expect(
			scopedIsolationVerdict([
				{ name: "XDG_DATA_HOME", before: result, after: result },
			]).certified,
		).toBe(false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("#given protected-file no-follow is unavailable #when protected state is observed #then capability failure is explicit and cannot certify", () => {
	const root = mkdtempSync(join(tmpdir(), "omo-senpi-no-follow-capability-"));
	try {
		writeFileSync(join(root, "auth.json"), "secret");
		const before = snapshotProtectedState(root, {
			noFollowReadFlags: undefined,
		});
		const after = snapshotProtectedState(root, {
			noFollowReadFlags: undefined,
		});

		expect(before.complete).toBe(false);
		expect(before.errors.map(({ code }) => code)).toEqual([
			"NO_FOLLOW_UNAVAILABLE",
			"NO_FOLLOW_UNAVAILABLE",
			"NO_FOLLOW_UNAVAILABLE",
			"NO_FOLLOW_UNAVAILABLE",
			"NO_FOLLOW_UNAVAILABLE",
			"NO_FOLLOW_UNAVAILABLE",
		]);
		expect(protectedSnapshotsUntouched(before, after)).toBe(false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("#given Windows lacks descriptor-bound directory traversal #when isolation is observed #then capability failure is explicit and cannot certify", () => {
	const root = mkdtempSync(join(tmpdir(), "omo-senpi-windows-descriptor-"));
	try {
		const before = snapshotDirectory(root, LIMITS, { platform: "win32" });
		const after = snapshotDirectory(root, LIMITS, { platform: "win32" });

		expect(directoryIdentityAvailable("win32")).toBe(false);
		expect(before.complete).toBe(false);
		expect(before.errors).toEqual([
			{ path: ".", code: "DIRECTORY_IDENTITY_UNAVAILABLE" },
		]);
		expect(
			scopedIsolationVerdict([{ name: "HOME", before, after }]).certified,
		).toBe(false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("#given a missing Windows root is created #when isolation is observed #then unavailable identity takes precedence over absence", () => {
	const parent = mkdtempSync(join(tmpdir(), "omo-senpi-windows-missing-"));
	try {
		const missing = join(parent, "missing");
		const before = snapshotDirectory(missing, LIMITS, { platform: "win32" });
		mkdirSync(missing);
		writeFileSync(join(missing, "created.json"), "mutated");
		const after = snapshotDirectory(missing, LIMITS, { platform: "win32" });
		const protectedState = { snapshot: new Map(), complete: true, errors: [] };

		expect(before.complete).toBe(false);
		expect(before.errors).toEqual([
			{ path: ".", code: "DIRECTORY_IDENTITY_UNAVAILABLE" },
		]);
		expect(after.complete).toBe(false);
		expect(after.errors).toEqual(before.errors);
		expect(
			scopedIsolationVerdict([{ name: "HOME", before, after }]).certified,
		).toBe(false);
		expect(
			isolationVerdict({
				beforeProtected: protectedState,
				afterProtected: protectedState,
				beforeObserved: before,
				afterObserved: after,
				observedChangedPaths: [],
			}).untouched,
		).toBe(false);
	} finally {
		rmSync(parent, { recursive: true, force: true });
	}
});
