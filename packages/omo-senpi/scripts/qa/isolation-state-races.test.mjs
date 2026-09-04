// allow: SIZE_OK - this scenario table exhausts mutation, replacement, and error-precedence races.
import { expect, test } from "bun:test";
import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	opendirSync,
	openSync,
	readFileSync,
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

test("#given a same-size in-place overwrite after an observation read #when metadata is verified #then the snapshot fails closed", () => {
	const root = mkdtempSync(join(tmpdir(), "omo-senpi-same-size-observation-"));
	try {
		const path = join(root, "state.json");
		writeFileSync(path, "AAAA");
		let mutated = false;
		const io = {
			openSync,
			closeSync,
			fstatSync,
			statSync,
			readSync(fd, buffer, offset, length, position) {
				const count = readSync(fd, buffer, offset, length, position);
				if (!mutated) {
					mutated = true;
					writeFileSync(path, "BBBB");
				}
				return count;
			},
		};
		const scan = snapshotDirectory(
			root,
			{ maxFiles: 10, maxBytes: 4, maxEntries: 10 },
			io,
		);
		expect(scan.bytesRead).toBe(4);
		expect(scan.complete).toBe(false);
		expect(scan.errors).toEqual([{ path: "state.json", code: "FILE_CHANGED" }]);
		expect([...scan.snapshot.keys()]).toEqual(["."]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("#given a same-size in-place overwrite after a protected read #when metadata is verified #then the snapshot fails closed", () => {
	const root = mkdtempSync(join(tmpdir(), "omo-senpi-same-size-protected-"));
	try {
		const path = join(root, "auth.json");
		writeFileSync(path, "AAAA");
		let mutated = false;
		const readFile = (file) => {
			const content = readFileSync(file);
			if (!mutated) {
				mutated = true;
				writeFileSync(path, "BBBB");
			}
			return content;
		};
		const snapshot = snapshotProtectedState(root, readFile);
		expect(snapshot.complete).toBe(false);
		expect(snapshot.errors).toEqual([
			{ path: "auth.json", code: "FILE_CHANGED" },
		]);
		expect(snapshot.snapshot.has("auth.json")).toBe(false);
		expect(isolationState.protectedSnapshotsUntouched(snapshot, snapshot)).toBe(
			false,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("#given an existence probe would hide inaccessible protected state #when opened directly #then EACCES fails closed", () => {
	const root = mkdtempSync(join(tmpdir(), "omo-senpi-protected-access-"));
	try {
		const deniedRead = () => {
			const error = new Error("denied");
			error.code = "EACCES";
			throw error;
		};
		deniedRead.openSync = (file, flags) => {
			if (file === join(root, "auth.json")) return deniedRead();
			return openSync(file, flags);
		};
		const snapshot = snapshotProtectedState(root, deniedRead);
		expect(snapshot.complete).toBe(false);
		expect(snapshot.errors).toEqual([{ path: "auth.json", code: "EACCES" }]);
		expect(snapshot.snapshot.has("auth.json")).toBe(false);
		expect(isolationState.protectedSnapshotsUntouched(snapshot, snapshot)).toBe(
			false,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("#given only volatile settings stamps change #when bounded complete-tree snapshots are compared #then settings stay unchanged", () => {
	const root = mkdtempSync(join(tmpdir(), "omo-senpi-volatile-settings-"));
	try {
		const path = join(root, "settings.json");
		writeFileSync(
			path,
			JSON.stringify({
				theme: "dark",
				tipsHistory: { first: 1 },
				lastChangelogVersion: "1",
				modelLastOnThinkingLevels: { model: "low" },
			}),
		);
		const before = snapshotDirectory(root);
		writeFileSync(
			path,
			JSON.stringify({
				theme: "dark",
				tipsHistory: { second: 2 },
				lastChangelogVersion: "2",
				modelLastOnThinkingLevels: { model: "high" },
			}),
		);
		const after = snapshotDirectory(root);
		expect(before.complete).toBe(true);
		expect(after.complete).toBe(true);
		expect(changedSnapshotPaths(before.snapshot, after.snapshot)).toEqual([]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("#given an enumerated entry vanishes before stat #when final directory metadata is checked #then the mutation fails closed without an entry error", () => {
	const root = mkdtempSync(join(tmpdir(), "omo-senpi-transient-entry-"));
	try {
		const path = join(root, "vanished.tmp");
		writeFileSync(path, "temporary");
		let removed = false;
		const io = {
			openSync,
			closeSync,
			fstatSync,
			opendirSync,
			readFileSync,
			readSync,
			lstatSync(file, options) {
				if (!removed && (file === path || file.endsWith("/vanished.tmp"))) {
					removed = true;
					rmSync(path);
					const error = new Error("entry vanished");
					error.code = "ENOENT";
					throw error;
				}
				return lstatSync(file, options);
			},
		};
		const scan = snapshotDirectory(
			root,
			{ maxFiles: 10, maxBytes: 1024, maxEntries: 10 },
			io,
		);
		expect(scan.complete).toBe(false);
		expect(scan.truncated).toBe(false);
		expect(scan.errors).toEqual([{ path: ".", code: "FILE_CHANGED" }]);
		expect([...scan.snapshot.keys()]).toEqual(["."]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("#given replacement between initial stat and open #when snapshotted #then public paths preserve FILE_REPLACED", () => {
	for (const kind of ["observed", "protected"]) {
		const root = mkdtempSync(join(tmpdir(), `omo-senpi-preopen-${kind}-`));
		try {
			const name = kind === "observed" ? "state.json" : "auth.json";
			const path = join(root, name);
			writeFileSync(path, "AAAA");
			let replaced = false;
			const io = {
				openSync(file, flags) {
					if (!replaced && (file === path || file.endsWith(`/${name}`))) {
						replaced = true;
						renameSync(path, join(root, `${name}.old`));
						writeFileSync(path, "BBBB");
					}
					return openSync(file, flags);
				},
			};
			const result =
				kind === "observed"
					? snapshotDirectory(
							root,
							{ maxFiles: 10, maxBytes: 1024, maxEntries: 10 },
							io,
						)
					: snapshotProtectedState(root, io);
			expect(result.complete).toBe(false);
			expect(result.errors).toEqual([{ path: name, code: "FILE_REPLACED" }]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}
});

test("#given success or primary failure plus close failure #when reading #then primary-operation precedence is stable", () => {
	for (const kind of ["observed", "protected"]) {
		const root = mkdtempSync(join(tmpdir(), `omo-senpi-close-${kind}-`));
		try {
			const name = kind === "observed" ? "state.json" : "auth.json";
			writeFileSync(join(root, name), "AAAA");
			const run = (io) =>
				kind === "observed"
					? snapshotDirectory(
							root,
							{ maxFiles: 10, maxBytes: 1024, maxEntries: 10 },
							io,
						)
					: snapshotProtectedState(root, io);
			expect(
				run({
					closeSync() {
						throw codedError("ECLOSE");
					},
				}).errors,
			).toEqual([{ path: name, code: "ECLOSE" }]);
			const io =
				kind === "observed"
					? {
							readSync() {
								throw codedError("EIO");
							},
							closeSync() {
								throw codedError("ECLOSE");
							},
						}
					: {
							readFileSync() {
								throw codedError("EIO");
							},
							closeSync() {
								throw codedError("ECLOSE");
							},
						};
			expect(run(io).errors).toEqual([{ path: name, code: "EIO" }]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}
});

test("#given ENOENT stat then open success and close failure #when absence races #then FILE_REPLACED remains primary", () => {
	const root = mkdtempSync(join(tmpdir(), "omo-senpi-absence-close-"));
	try {
		const path = join(root, "auth.json");
		let firstStat = true;
		const snapshot = snapshotProtectedState(root, {
			lstatSync(file, options) {
				if (file === path && firstStat) {
					firstStat = false;
					writeFileSync(path, "AAAA");
					throw codedError("ENOENT");
				}
				return lstatSync(file, options);
			},
			closeSync() {
				throw codedError("ECLOSE");
			},
		});
		expect(snapshot.errors).toEqual([
			{ path: "auth.json", code: "FILE_REPLACED" },
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("#given the root vanishes after its initial identity check #when directory open reports absence #then the snapshot fails closed as replacement", () => {
	const root = mkdtempSync(join(tmpdir(), "omo-senpi-root-open-race-"));
	try {
		const scan = snapshotDirectory(
			root,
			{ maxFiles: 10, maxBytes: 1024, maxEntries: 10 },
			{
				opendirSync() {
					throw codedError("ENOENT");
				},
			},
		);

		expect(scan.complete).toBe(false);
		expect(scan.errors).toEqual([{ path: ".", code: "FILE_REPLACED" }]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("#given directory open returns a stale external descriptor #when traversal binds identity #then it fails closed without reading the external tree", () => {
	const root = mkdtempSync(join(tmpdir(), "omo-senpi-directory-descriptor-"));
	const state = join(root, "state");
	const external = mkdtempSync(
		join(tmpdir(), "omo-senpi-external-descriptor-"),
	);
	try {
		mkdirSync(state);
		writeFileSync(join(external, "private.txt"), "private");
		const externalFd = openSync(
			external,
			constants.O_RDONLY | (constants.O_DIRECTORY ?? 0),
		);
		let suppliedExternalFd = false;
		const scan = snapshotDirectory(
			root,
			{ maxFiles: 10, maxBytes: 1024, maxEntries: 10 },
			{
				openDirectorySync(path, flags) {
					if (
						(path === state || path.endsWith("/state")) &&
						!suppliedExternalFd
					) {
						suppliedExternalFd = true;
						return externalFd;
					}
					return openSync(path, flags);
				},
			},
		);
		if (!suppliedExternalFd) closeSync(externalFd);

		expect(scan.complete).toBe(false);
		expect(scan.errors).toContainEqual({
			path: "state",
			code: "FILE_REPLACED",
		});
		expect(scan.snapshot.has("state/private.txt")).toBe(false);
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(external, { recursive: true, force: true });
	}
});

test("#given an opened directory is replaced after its identity check #when traversal finishes #then the snapshot fails closed", () => {
	const root = mkdtempSync(join(tmpdir(), "omo-senpi-post-open-directory-"));
	const state = join(root, "state");
	const oldState = join(root, "state-old");
	try {
		mkdirSync(state);
		let replaced = false;
		let directoryOpens = 0;
		const scan = snapshotDirectory(
			root,
			{ maxFiles: 10, maxBytes: 1024, maxEntries: 10 },
			{
				opendirSync(path) {
					directoryOpens += 1;
					const directory = opendirSync(path);
					if (directoryOpens !== 2) return directory;
					return {
						readSync() {
							if (!replaced) {
								replaced = true;
								renameSync(state, oldState);
								mkdirSync(state);
								writeFileSync(join(state, "new.txt"), "new");
							}
							return directory.readSync();
						},
						closeSync() {
							directory.closeSync();
						},
					};
				},
			},
		);

		expect(scan.complete).toBe(false);
		expect(scan.errors).toContainEqual({
			path: "state",
			code: "FILE_REPLACED",
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("#given non-ASCII canonical paths #when snapshots and errors are ordered #then code-point order is independent of host locale", () => {
	const root = mkdtempSync(join(tmpdir(), "omo-senpi-canonical-order-"));
	try {
		writeFileSync(join(root, "z"), "z");
		writeFileSync(join(root, "ä"), "a");
		const scan = snapshotDirectory(
			root,
			{ maxFiles: 10, maxBytes: 1024, maxEntries: 10 },
			{
				openSync() {
					throw codedError("EIO");
				},
			},
		);

		expect(scan.errors).toEqual([
			{ path: "z", code: "EIO" },
			{ path: "ä", code: "EIO" },
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("#given transient or primary complete-tree read errors #when digesting #then only ENOENT and ENOTDIR are tolerated", () => {
	const root = mkdtempSync(join(tmpdir(), "omo-senpi-digest-read-"));
	try {
		writeFileSync(join(root, "stable.txt"), "stable");
		writeFileSync(join(root, "raced.tmp"), "temporary");
		const stableEntries = [
			{ name: "stable.txt", isDirectory: () => false, isFile: () => true },
		];
		const allEntries = [
			...stableEntries,
			{ name: "raced.tmp", isDirectory: () => false, isFile: () => true },
		];
		const expected = isolationState.digestDirectory(root, {
			readdir: () => stableEntries,
			readFile: () => Buffer.from("stable"),
		});
		for (const code of ["ENOENT", "ENOTDIR"]) {
			const digest = isolationState.digestDirectory(root, {
				readdir: () => allEntries,
				readFile(file) {
					if (file.endsWith("raced.tmp")) throw codedError(code);
					return Buffer.from("stable");
				},
			});
			expect(digest).toBe(expected);
		}
		for (const code of ["EACCES", "EIO"]) {
			expect(() =>
				isolationState.digestDirectory(root, {
					readFile() {
						throw codedError(code);
					},
				}),
			).toThrow();
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

function codedError(code) {
	const error = new Error(code);
	error.code = code;
	return error;
}
