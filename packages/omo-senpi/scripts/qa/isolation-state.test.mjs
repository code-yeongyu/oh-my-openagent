// allow: SIZE_OK - this scenario table exhausts bounded traversal and byte-limit behavior.
import { expect, test } from "bun:test";
import {
	appendFileSync,
	closeSync,
	fstatSync,
	ftruncateSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as isolationState from "./isolation-state.mjs";

const { changedSnapshotPaths, snapshotDirectory, snapshotProtectedState } =
	isolationState;

test("#given protected and volatile files #when snapshots are compared #then only protected path changes affect isolation", () => {
	const root = mkdtempSync(join(tmpdir(), "omo-senpi-protected-state-"));
	try {
		writeFileSync(join(root, "auth.json"), "first-secret\n");
		writeFileSync(join(root, "senpi-debug.log"), "before\n");
		const before = snapshotProtectedState(root);

		writeFileSync(join(root, "auth.json"), "second-secret\n");
		writeFileSync(join(root, "senpi-debug.log"), "after\n");

		expect(
			changedSnapshotPaths(
				before.snapshot,
				snapshotProtectedState(root).snapshot,
			),
		).toEqual(["auth.json"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("#given nested nonvolatile files within bounds #when scanned #then the relevant observation domain is complete", () => {
	const root = mkdtempSync(join(tmpdir(), "omo-senpi-tree-scan-"));
	try {
		mkdirSync(join(root, "sessions"), { recursive: true });
		writeFileSync(join(root, "settings.json"), "{}\n");
		writeFileSync(
			join(root, "sessions", "active.jsonl"),
			"volatile-content-beyond-byte-budget\n",
		);

		const scan = snapshotDirectory(root, {
			maxFiles: 1,
			maxBytes: 3,
			maxEntries: 2,
		});

		expect(scan.complete).toBe(true);
		expect(scan.truncated).toBe(false);
		expect(scan.errors).toEqual([]);
		expect(scan.bytesRead).toBe(3);
		expect(scan.domain).toBe("nonvolatile-home");
		expect([...scan.snapshot.keys()]).toEqual([".", "settings.json"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("#given volatile root entries precede one persistent file #when scanned at exact budgets #then volatility consumes no budget", () => {
	const root = mkdtempSync(join(tmpdir(), "omo-senpi-volatile-budget-"));
	try {
		mkdirSync(join(root, "sessions"));
		writeFileSync(join(root, "sessions", "x"), "volatile");
		writeFileSync(join(root, "stable"), "stable");

		const scan = snapshotDirectory(root, {
			maxEntries: 1,
			maxFiles: 1,
			maxBytes: 100,
		});

		expect(scan.complete).toBe(true);
		expect(scan.truncated).toBe(false);
		expect(scan.bytesRead).toBe(6);
		expect([...scan.snapshot.keys()]).toEqual([".", "stable"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("#given a volatile log precedes one persistent file #when scanned at the entry limit #then the log consumes no entry budget", () => {
	const root = mkdtempSync(join(tmpdir(), "omo-senpi-volatile-log-budget-"));
	try {
		writeFileSync(join(root, "a.log"), "volatile");
		writeFileSync(join(root, "stable"), "stable");

		const scan = snapshotDirectory(root, {
			maxEntries: 1,
			maxFiles: 1,
			maxBytes: 100,
		});

		expect(scan.complete).toBe(true);
		expect(scan.truncated).toBe(false);
		expect(scan.bytesRead).toBe(6);
		expect([...scan.snapshot.keys()]).toEqual([".", "stable"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("#given a missing root and empty directories #when snapshots are compared #then persistent directory creation and deletion are observed", () => {
	const parent = mkdtempSync(join(tmpdir(), "omo-senpi-directory-identity-"));
	const root = join(parent, "agent");
	try {
		const missing = snapshotDirectory(root);
		mkdirSync(root);
		const emptyRoot = snapshotDirectory(root);
		mkdirSync(join(root, "nested"));
		const nestedCreated = snapshotDirectory(root);
		rmSync(join(root, "nested"), { recursive: true });
		const nestedDeleted = snapshotDirectory(root);

		expect(missing.complete).toBe(true);
		expect(emptyRoot.complete).toBe(true);
		expect(changedSnapshotPaths(missing.snapshot, emptyRoot.snapshot)).toEqual([
			".",
		]);
		expect(
			changedSnapshotPaths(emptyRoot.snapshot, nestedCreated.snapshot),
		).toEqual(["nested"]);
		expect(
			changedSnapshotPaths(nestedCreated.snapshot, nestedDeleted.snapshot),
		).toEqual(["nested"]);
		const protectedState = {
			snapshot: new Map(),
			complete: true,
			errors: [],
		};
		const verdict = isolationState.isolationVerdict({
			beforeProtected: protectedState,
			afterProtected: protectedState,
			beforeObserved: missing,
			afterObserved: emptyRoot,
			observedChangedPaths: changedSnapshotPaths(
				missing.snapshot,
				emptyRoot.snapshot,
			),
		});
		expect(verdict.changedPaths).toEqual(["."]);
		expect(verdict.untouched).toBe(false);
	} finally {
		rmSync(parent, { recursive: true, force: true });
	}
});

test("#given a tree beyond the file bound #when observed #then truncation is explicit and never complete", () => {
	const root = mkdtempSync(join(tmpdir(), "omo-senpi-tree-bound-"));
	try {
		writeFileSync(join(root, "a.jsonl"), "a\n");
		writeFileSync(join(root, "b.jsonl"), "b\n");

		const scan = snapshotDirectory(root, { maxFiles: 1, maxBytes: 1024 });

		expect(scan.complete).toBe(false);
		expect(scan.truncated).toBe(true);
		expect(scan.errors).toEqual([]);
		expect(scan.snapshot.size).toBe(2);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("#given identical protected read failures #when snapshots are compared #then isolation fails closed with structured relative errors", () => {
	const root = mkdtempSync(join(tmpdir(), "omo-senpi-protected-error-"));
	try {
		writeFileSync(join(root, "auth.json"), "secret\n");
		const deniedRead = () => {
			const error = new Error("denied");
			error.code = "EACCES";
			throw error;
		};

		const before = snapshotProtectedState(root, deniedRead);
		const after = snapshotProtectedState(root, deniedRead);

		expect(before.complete).toBe(false);
		expect(before.errors).toEqual([{ path: "auth.json", code: "EACCES" }]);
		expect(changedSnapshotPaths(before.snapshot, after.snapshot)).toEqual([]);
		expect(isolationState.protectedSnapshotsUntouched?.(before, after)).toBe(
			false,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("#given files exceed the byte budget #when observed #then descriptor reads never exceed maxBytes", () => {
	const root = mkdtempSync(join(tmpdir(), "omo-senpi-byte-bound-"));
	try {
		writeFileSync(join(root, "a.bin"), "1234");
		writeFileSync(join(root, "b.bin"), "12345678");
		let bytesRead = 0;
		const io = {
			openSync,
			closeSync,
			fstatSync,
			statSync,
			readSync(fd, buffer, offset, length, position) {
				const count = readSync(fd, buffer, offset, length, position);
				bytesRead += count;
				return count;
			},
		};

		const scan = snapshotDirectory(
			root,
			{ maxFiles: 10, maxBytes: 6, maxEntries: 10 },
			io,
		);

		expect(bytesRead).toBe(4);
		expect(scan.complete).toBe(false);
		expect(scan.truncated).toBe(true);
		expect(scan.errors).toEqual([]);
		expect([...scan.snapshot.keys()]).toEqual([".", "a.bin"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("#given a file shrinks after traversal #when observed #then short read is explicit and incomplete", () => {
	const root = mkdtempSync(join(tmpdir(), "omo-senpi-short-read-"));
	try {
		const path = join(root, "state.json");
		writeFileSync(path, "12345678");
		let truncated = false;
		const io = {
			closeSync,
			fstatSync,
			statSync,
			openSync(file) {
				return openSync(file, "r+");
			},
			readSync(fd, buffer, offset, length, position) {
				if (!truncated) {
					truncated = true;
					ftruncateSync(fd, 0);
				}
				return readSync(fd, buffer, offset, length, position);
			},
		};

		const scan = snapshotDirectory(
			root,
			{ maxFiles: 10, maxBytes: 1024, maxEntries: 10 },
			io,
		);

		expect(scan.complete).toBe(false);
		expect(scan.errors).toEqual([{ path: "state.json", code: "SHORT_READ" }]);
		expect([...scan.snapshot.keys()]).toEqual(["."]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("#given a file grows while hashing #when observed #then growth is explicit and incomplete", () => {
	const root = mkdtempSync(join(tmpdir(), "omo-senpi-growth-"));
	try {
		const path = join(root, "state.json");
		writeFileSync(path, "1234");
		let grew = false;
		const io = {
			openSync,
			closeSync,
			fstatSync,
			statSync,
			readSync(fd, buffer, offset, length, position) {
				const count = readSync(fd, buffer, offset, length, position);
				if (!grew) {
					grew = true;
					appendFileSync(path, "5678");
				}
				return count;
			},
		};

		const scan = snapshotDirectory(
			root,
			{ maxFiles: 10, maxBytes: 1024, maxEntries: 10 },
			io,
		);

		expect(scan.complete).toBe(false);
		expect(scan.errors).toEqual([{ path: "state.json", code: "FILE_CHANGED" }]);
		expect([...scan.snapshot.keys()]).toEqual(["."]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("#given a path is replaced after open #when observed #then replacement is explicit and incomplete", () => {
	const root = mkdtempSync(join(tmpdir(), "omo-senpi-replacement-"));
	try {
		const path = join(root, "state.json");
		const moved = join(root, "state.old");
		writeFileSync(path, "1234");
		let replaced = false;
		const io = {
			closeSync,
			fstatSync,
			readSync,
			statSync,
			openSync(file, flags) {
				const fd = openSync(file, flags);
				if (!replaced) {
					replaced = true;
					renameSync(path, moved);
					writeFileSync(path, "abcd");
				}
				return fd;
			},
		};

		const scan = snapshotDirectory(
			root,
			{ maxFiles: 10, maxBytes: 1024, maxEntries: 10 },
			io,
		);

		expect(scan.complete).toBe(false);
		expect(scan.errors).toEqual([
			{ path: "state.json", code: "FILE_REPLACED" },
		]);
		expect([...scan.snapshot.keys()]).toEqual(["."]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("#given one file exceeds the byte budget #when observed #then truncation occurs without reading or BYTE_LIMIT errors", () => {
	const root = mkdtempSync(join(tmpdir(), "omo-senpi-oversized-observation-"));
	try {
		writeFileSync(join(root, "state.json"), "12345");
		let bytesRead = 0;
		const io = {
			openSync,
			closeSync,
			fstatSync,
			statSync,
			readSync(...args) {
				const count = readSync(...args);
				bytesRead += count;
				return count;
			},
		};
		const scan = snapshotDirectory(
			root,
			{ maxFiles: 10, maxBytes: 4, maxEntries: 10 },
			io,
		);
		expect(bytesRead).toBe(0);
		expect(scan.bytesRead).toBe(0);
		expect(scan.complete).toBe(false);
		expect(scan.truncated).toBe(true);
		expect(scan.errors).toEqual([]);
		expect([...scan.snapshot.keys()]).toEqual(["."]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
