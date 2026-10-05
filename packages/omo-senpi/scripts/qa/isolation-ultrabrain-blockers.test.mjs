import { expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	opendirSync,
	openSync,
	readlinkSync,
	renameSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	changedSnapshotPaths,
	classifyObservedChanges,
	isolationVerdict,
	protectedSnapshotsUntouched,
	snapshotDirectory,
	snapshotProtectedState,
} from "./isolation-state.mjs";

const LIMITS = { maxFiles: 10, maxBytes: 1024, maxEntries: 10 };
const fdIt = test.skipIf(process.platform !== "linux");

function completeProtected() {
	return { snapshot: new Map(), complete: true, errors: [] };
}

function completeObserved() {
	return {
		snapshot: new Map(),
		complete: true,
		truncated: false,
		errors: [],
		bytesRead: 0,
		domain: "nonvolatile-home",
	};
}

test("#given an observation I/O error #when the canonical verdict is built #then untouched fails closed", () => {
	// Given
	const protectedState = completeProtected();
	const beforeObserved = completeObserved();
	const afterObserved = {
		...completeObserved(),
		complete: false,
		errors: [{ path: ".", code: "EIO" }],
	};

	// When
	const verdict = isolationVerdict({
		beforeProtected: protectedState,
		afterProtected: protectedState,
		beforeObserved,
		afterObserved,
		observedChangedPaths: [],
	});

	// Then
	expect(verdict.untouched).toBe(false);
});

test("#given a truncated bounded observation #when the canonical verdict is built #then untouched fails closed", () => {
	// Given
	const protectedState = completeProtected();
	const beforeObserved = completeObserved();
	const afterObserved = {
		...completeObserved(),
		complete: false,
		truncated: true,
	};

	// When
	const verdict = isolationVerdict({
		beforeProtected: protectedState,
		afterProtected: protectedState,
		beforeObserved,
		afterObserved,
		observedChangedPaths: [],
	});

	// Then
	expect(verdict.untouched).toBe(false);
});

fdIt(
	"#given a persistent symlink is created and retargeted #when snapshots are compared #then both changes are observed without following targets",
	() => {
		// Given
		const root = mkdtempSync(join(tmpdir(), "omo-senpi-symlink-change-"));
		const outside = mkdtempSync(join(tmpdir(), "omo-senpi-symlink-target-"));
		const firstTarget = join(outside, "first.txt");
		const secondTarget = join(outside, "second.txt");
		const link = join(root, "persistent-link");
		try {
			writeFileSync(firstTarget, "first-private-content");
			writeFileSync(secondTarget, "second-private-content");
			const before = snapshotDirectory(root, LIMITS);
			symlinkSync(firstTarget, link);
			const created = snapshotDirectory(root, LIMITS);
			unlinkSync(link);
			symlinkSync(secondTarget, link);
			const retargeted = snapshotDirectory(root, LIMITS);

			// When
			const createdPaths = isolationVerdict({
				beforeProtected: completeProtected(),
				afterProtected: completeProtected(),
				beforeObserved: before,
				afterObserved: created,
				observedChangedPaths: changedSnapshotPaths(
					before.snapshot,
					created.snapshot,
				),
			});
			const retargetedDigestChanged =
				created.snapshot.get("persistent-link") !==
				retargeted.snapshot.get("persistent-link");

			// Then
			expect(created.complete).toBe(true);
			expect(createdPaths.changedPaths).toEqual(["persistent-link"]);
			expect(createdPaths.untouched).toBe(false);
			expect(retargetedDigestChanged).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
			rmSync(outside, { recursive: true, force: true });
		}
	},
);

fdIt(
	"#given a symlink escapes the observation root #when its target contents change #then the link digest stays stable",
	() => {
		// Given
		const root = mkdtempSync(join(tmpdir(), "omo-senpi-symlink-root-"));
		const outside = mkdtempSync(join(tmpdir(), "omo-senpi-symlink-outside-"));
		const target = join(outside, "private.txt");
		const link = join(root, "outside-link");
		try {
			writeFileSync(target, "before-private-content");
			symlinkSync(target, link);
			const before = snapshotDirectory(root, LIMITS, {
				readlinkSync,
				readFileSync(path) {
					throw new Error(`unexpected target read: ${path}`);
				},
			});

			// When
			writeFileSync(target, "after-private-content");
			const after = snapshotDirectory(root, LIMITS, {
				readlinkSync,
				readFileSync(path) {
					throw new Error(`unexpected target read: ${path}`);
				},
			});

			// Then
			expect(before.complete).toBe(true);
			expect(after.complete).toBe(true);
			expect([...before.snapshot.keys()]).toEqual([".", "outside-link"]);
			expect(before.snapshot.get("outside-link")).toBe(
				after.snapshot.get("outside-link"),
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
			rmSync(outside, { recursive: true, force: true });
		}
	},
);

fdIt(
	"#given an enumerated directory is replaced by an external symlink before recursive open #when observed #then traversal fails closed without dereferencing",
	() => {
		// Given
		const root = mkdtempSync(join(tmpdir(), "omo-senpi-directory-race-"));
		const outside = mkdtempSync(join(tmpdir(), "omo-senpi-directory-outside-"));
		const state = join(root, "state");
		const moved = join(root, "state-old");
		try {
			mkdirSync(state);
			writeFileSync(join(state, "stable"), "same");
			writeFileSync(join(outside, "stable"), "same");
			let replaced = false;
			let directoryOpens = 0;

			// When
			const scan = snapshotDirectory(root, LIMITS, {
				opendirSync(path) {
					directoryOpens += 1;
					if (!replaced && directoryOpens === 2) {
						replaced = true;
						renameSync(state, moved);
						symlinkSync(outside, state);
					}
					return opendirSync(path);
				},
			});

			// Then
			expect(scan.complete).toBe(false);
			expect(scan.errors).toEqual([{ path: "state", code: "FILE_REPLACED" }]);
			expect(scan.snapshot.has("state/stable")).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
			rmSync(outside, { recursive: true, force: true });
		}
	},
);

test("#given protected state is an external symlink #when its target changes #then protected reads never follow it and fail closed", () => {
	// Given
	const root = mkdtempSync(join(tmpdir(), "omo-senpi-protected-link-"));
	const outside = mkdtempSync(join(tmpdir(), "omo-senpi-protected-target-"));
	const target = join(outside, "private.json");
	try {
		writeFileSync(target, "before-private-content");
		const authPath = join(root, "auth.json");
		symlinkSync(target, authPath);
		let protectedOpens = 0;
		const io = {
			openSync(path, flags) {
				if (path === authPath) protectedOpens += 1;
				return openSync(path, flags);
			},
		};
		const before = snapshotProtectedState(root, io);

		// When
		writeFileSync(target, "after-private-content");
		const after = snapshotProtectedState(root, io);

		// Then
		expect(before.complete).toBe(false);
		expect(after.complete).toBe(false);
		expect(before.errors).toContainEqual({
			path: "auth.json",
			code: "UNSUPPORTED_ENTRY",
		});
		expect(after.errors).toContainEqual({
			path: "auth.json",
			code: "UNSUPPORTED_ENTRY",
		});
		expect(before.snapshot.has("auth.json")).toBe(false);
		expect(after.snapshot.has("auth.json")).toBe(false);
		expect(protectedOpens).toBe(0);
		expect(protectedSnapshotsUntouched(before, after)).toBe(false);
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});

test("#given POSIX and Windows path styles #when observed paths are classified #then only the producing style treats backslash as a separator", () => {
	// Given
	const path = "sessions\\persistent.json";

	// When
	const posix = classifyObservedChanges([path], "posix");
	const windows = classifyObservedChanges([path], "windows");

	// Then
	expect(posix.other).toEqual([path]);
	expect(posix.volatile).toEqual([]);
	expect(windows.other).toEqual([]);
	expect(windows.volatile).toEqual(["sessions/persistent.json"]);
});
