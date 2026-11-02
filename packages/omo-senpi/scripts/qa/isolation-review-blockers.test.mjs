// allow: SIZE_OK - this blocker suite keeps every isolation error-precedence regression together.
import { expect, test } from "bun:test";
import {
	closeSync,
	fstatSync,
	lstatSync,
	mkdtempSync,
	opendirSync,
	openSync,
	readSync,
	renameSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as isolationState from "./isolation-state.mjs";

const {
	classifyObservedChanges,
	credentialDigest,
	digestDirectory,
	isolationVerdict,
	snapshotDirectory,
	snapshotProtectedState,
} = isolationState;

const LIMITS = { maxFiles: 10, maxBytes: 1024, maxEntries: 10 };
const fdIt = test.skipIf(process.platform !== "linux");

function codedError(code) {
	return Object.assign(new Error(code), { code });
}

function completeProtected(entries = []) {
	return { snapshot: new Map(entries), complete: true, errors: [] };
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

function buildVerdict(beforeProtected, afterProtected, observedChangedPaths) {
	return isolationVerdict({
		beforeProtected,
		afterProtected,
		beforeObserved: completeObserved(),
		afterObserved: completeObserved(),
		observedChangedPaths,
	});
}

test("#given missing or arbitrary observation domains #when the canonical verdict is built #then untouched fails closed", () => {
	// Given
	const protectedState = completeProtected();
	const valid = completeObserved();
	const { domain: _missingDomain, ...missingDomain } = valid;
	const arbitraryDomain = { ...valid, domain: "whole-home" };

	// When
	const missingBefore = isolationVerdict({
		beforeProtected: protectedState,
		afterProtected: protectedState,
		beforeObserved: missingDomain,
		afterObserved: valid,
		observedChangedPaths: [],
	});
	const arbitraryAfter = isolationVerdict({
		beforeProtected: protectedState,
		afterProtected: protectedState,
		beforeObserved: valid,
		afterObserved: arbitraryDomain,
		observedChangedPaths: [],
	});

	// Then
	expect(missingBefore.untouched).toBe(false);
	expect(arbitraryAfter.untouched).toBe(false);
});

test("#given direct, protected-observed, persistent-observed, and volatile changes #when the canonical verdict is built #then only volatile paths are excluded from the sorted union", () => {
	// Given
	const before = completeProtected([["auth.json", "before"]]);
	const after = completeProtected([["auth.json", "after"]]);

	// When
	const verdict = buildVerdict(before, after, [
		"sessions/live.jsonl",
		"nested/persistent.json",
		"auth.json",
		"nested/persistent.json",
	]);

	// Then
	expect(classifyObservedChanges(["nested/persistent.json"]).other).toEqual([
		"nested/persistent.json",
	]);
	expect(verdict.changedPaths).toEqual(["auth.json", "nested/persistent.json"]);
	expect(verdict.untouched).toBe(false);
});

test("#given only explicitly volatile observed writes #when the canonical verdict is built #then the protected home remains untouched", () => {
	// Given
	const before = completeProtected([["auth.json", "stable"]]);
	const after = completeProtected([["auth.json", "stable"]]);

	// When
	const verdict = buildVerdict(before, after, [
		"cache/index.json",
		"logs/run.log",
		"sessions/live.jsonl",
	]);

	// Then
	expect(verdict.changedPaths).toEqual([]);
	expect(verdict.untouched).toBe(true);
});

test("#given a protected change or incomplete protected snapshot #when the canonical verdict is built #then untouched fails closed", () => {
	// Given
	const stable = completeProtected([["auth.json", "stable"]]);
	const changed = completeProtected([["auth.json", "changed"]]);
	const incomplete = {
		snapshot: new Map(stable.snapshot),
		complete: false,
		errors: [{ path: "auth.json", code: "EIO" }],
	};

	// When
	const changedVerdict = buildVerdict(stable, changed, []);
	const incompleteVerdict = buildVerdict(stable, incomplete, []);

	// Then
	expect(changedVerdict.changedPaths).toEqual(["auth.json"]);
	expect(changedVerdict.untouched).toBe(false);
	expect(incompleteVerdict.untouched).toBe(false);
});

test("#given POSIX and Windows-shaped observed paths #when changes are classified #then volatile prefixes are canonical on both platforms", () => {
	// Given
	const paths = [
		"sessions/a",
		"sessions\\b",
		"cache/a",
		"cache\\b",
		"logs/a",
		"logs\\b",
		"state\\keep.json",
	];

	// When
	const classified = classifyObservedChanges(paths, "windows");

	// Then
	expect(classified.volatile).toEqual([
		"cache/a",
		"cache/b",
		"logs/a",
		"logs/b",
		"sessions/a",
		"sessions/b",
	]);
	expect(classified.other).toEqual(["state/keep.json"]);
});

test("#given credential files are absent or inaccessible #when credentialDigest reads directly #then only ENOENT is treated as absent", () => {
	// Given
	const root = mkdtempSync(join(tmpdir(), "omo-senpi-credential-io-"));
	try {
		const absent = () => {
			throw codedError("ENOENT");
		};

		// When
		const digest = credentialDigest(root, { readFile: absent });

		// Then
		expect(typeof digest).toBe("string");
		for (const code of ["EACCES", "EIO"]) {
			expect(() =>
				credentialDigest(root, {
					readFile() {
						throw codedError(code);
					},
				}),
			).toThrow(code);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

fdIt(
	"#given bounded observation root enumeration fails #when snapshotDirectory runs #then inaccessible IO is structured and incomplete while absence is empty-complete",
	() => {
		// Given
		const root = mkdtempSync(join(tmpdir(), "omo-senpi-root-io-"));
		try {
			for (const code of ["EACCES", "EIO"]) {
				// When
				const scan = snapshotDirectory(root, LIMITS, {
					opendirSync() {
						throw codedError(code);
					},
				});

				// Then
				expect(scan.complete).toBe(false);
				expect(scan.errors).toEqual([{ path: ".", code }]);
			}
			for (const code of ["ENOENT", "ENOTDIR"]) {
				const scan = snapshotDirectory(root, LIMITS, {
					opendirSync() {
						throw codedError(code);
					},
				});
				expect(scan.complete).toBe(false);
				expect(scan.errors).toEqual([{ path: ".", code: "FILE_REPLACED" }]);
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	},
);

fdIt(
	"#given persistent entries exceed maxEntries #when the directory is enumerated #then readSync stops after bounded lookahead",
	() => {
		// Given
		const root = mkdtempSync(join(tmpdir(), "omo-senpi-entry-enumeration-"));
		try {
			for (let index = 0; index < 8; index += 1)
				writeFileSync(join(root, `persistent-${index}`), "x");
			let readCalls = 0;
			const io = {
				opendirSync(path) {
					const directory = opendirSync(path);
					return {
						readSync() {
							readCalls += 1;
							return directory.readSync();
						},
						closeSync: () => directory.closeSync(),
					};
				},
			};

			// When
			const result = snapshotDirectory(root, { ...LIMITS, maxEntries: 1 }, io);

			// Then
			expect({
				readCalls,
				complete: result.complete,
				truncated: result.truncated,
			}).toEqual({ readCalls: 2, complete: false, truncated: true });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	},
);

fdIt(
	"#given a persistent file appears after enumeration #when final directory metadata is checked #then the snapshot fails closed",
	() => {
		// Given
		const root = mkdtempSync(join(tmpdir(), "omo-senpi-late-persistent-"));
		try {
			let fstatCalls = 0;
			const io = {
				fstatDirectorySync(fd, options) {
					fstatCalls += 1;
					if (fstatCalls === 2)
						writeFileSync(join(root, "late-persistent"), "late");
					const metadata = fstatSync(fd, options);
					return fstatCalls === 1
						? metadata
						: {
								...metadata,
								mtimeNs: metadata.mtimeNs + 1n,
								isDirectory: () => true,
							};
				},
			};

			// When
			const result = snapshotDirectory(root, LIMITS, io);

			// Then
			expect(result.complete).toBe(false);
			expect(result.errors).toEqual([{ path: ".", code: "FILE_CHANGED" }]);
			expect(result.snapshot.has("late-persistent")).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	},
);

fdIt(
	"#given root ENOENT hides a regular parent #when snapshotDirectory diagnoses the boundary #then it remains incomplete",
	() => {
		// Given
		const parent = mkdtempSync(join(tmpdir(), "omo-senpi-enonent-parent-"));
		try {
			const file = join(parent, "file");
			const root = join(file, "agent");
			writeFileSync(file, "not a directory");

			// When
			const result = snapshotDirectory(root, LIMITS, {
				lstatSync(path, options) {
					if (path === root) throw codedError("ENOENT");
					return lstatSync(path, options);
				},
			});

			// Then
			expect(result.complete).toBe(false);
			expect(result.errors).toEqual([{ path: ".", code: "ENOENT" }]);
		} finally {
			rmSync(parent, { recursive: true, force: true });
		}
	},
);

test("#given a non-directory root component #when snapshotDirectory runs #then the platform error is exact and incomplete", () => {
	// Given
	const parent = mkdtempSync(join(tmpdir(), "omo-senpi-enotdir-snapshot-"));
	try {
		const file = join(parent, "file");
		writeFileSync(file, "not a directory");

		// When
		const result = snapshotDirectory(join(file, "agent"), LIMITS);

		// Then
		expect(result.complete).toBe(false);
		// The root stat fails BEFORE directory identity binding is attempted, so the platform's own
		// errno wins on every host. Linux reports ENOTDIR for a file used as a path component;
		// macOS also reports ENOTDIR, which isolation-state.mjs remaps to
		// DIRECTORY_IDENTITY_UNAVAILABLE (darwin only); Windows has no ENOTDIR for this case and
		// reports ENOENT - the same absence mapping the digestDirectory case below pins. A
		// two-way linux/other split collapsed macOS and Windows together and was only ever
		// validated on macOS.
		const platformRootError =
			process.platform === "win32"
				? "ENOENT"
				: process.platform === "darwin"
					? "DIRECTORY_IDENTITY_UNAVAILABLE"
					: "ENOTDIR";
		expect(result.errors).toEqual([{ path: ".", code: platformRootError }]);
	} finally {
		rmSync(parent, { recursive: true, force: true });
	}
});

test("#given a non-directory root component #when digestDirectory sees the platform error #then Windows absence mapping matches the root contract", () => {
	// Given
	const parent = mkdtempSync(join(tmpdir(), "omo-senpi-enotdir-digest-"));
	try {
		const file = join(parent, "file");
		writeFileSync(file, "not a directory");

		// When / Then
		if (process.platform === "win32") {
			expect(
				digestDirectory(join(file, "agent"), {
					readdir() {
						throw codedError("ENOENT");
					},
				}),
			).toBe("absent");
		} else {
			expect(() => digestDirectory(join(file, "agent"))).toThrow("ENOTDIR");
		}
	} finally {
		rmSync(parent, { recursive: true, force: true });
	}
});

test("#given digest enumeration fails through injected seams #when digestDirectory runs #then only ENOENT is absence and other IO propagates", () => {
	// Given
	const root = mkdtempSync(join(tmpdir(), "omo-senpi-digest-io-"));
	try {
		expect(
			digestDirectory(root, {
				readdir() {
					throw codedError("ENOENT");
				},
			}),
		).toBe("absent");

		// When / Then
		for (const code of ["ENOTDIR", "EACCES", "EIO"]) {
			expect(() =>
				digestDirectory(root, {
					readdir() {
						throw codedError(code);
					},
				}),
			).toThrow(code);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

fdIt(
	"#given pre-open metadata changed and current-path diagnostic stat fails #when public readers report the race #then the established replacement error wins",
	() => {
		for (const kind of ["observed", "protected"]) {
			for (const openingCode of ["FILE_REPLACED", "FILE_CHANGED"]) {
				for (const diagnosticCode of ["ENOENT", "EACCES"]) {
					// Given
					const root = mkdtempSync(
						join(tmpdir(), `omo-senpi-diagnostic-${kind}-`),
					);
					const name = kind === "observed" ? "state.json" : "auth.json";
					const path = join(root, name);
					try {
						writeFileSync(path, "AAAA");
						let statCalls = 0;
						const io = {
							openSync,
							closeSync,
							fstatSync(fd, options) {
								const metadata = fstatSync(fd, options);
								return openingCode === "FILE_REPLACED"
									? { ...metadata, ino: metadata.ino + 1n }
									: { ...metadata, size: metadata.size + 1n };
							},
							...(kind === "protected"
								? {
										lstatSync(file, options) {
											statCalls += 1;
											if (file === path && statCalls > 1)
												throw codedError(diagnosticCode);
											return lstatSync(file, options);
										},
									}
								: {
										statSync(file, options) {
											statCalls += 1;
											if (file === path && statCalls > 1)
												throw codedError(diagnosticCode);
											return statSync(file, options);
										},
									}),
						};

						// When
						const result =
							kind === "observed"
								? snapshotDirectory(root, LIMITS, io)
								: snapshotProtectedState(root, io);

						// Then
						expect(result.complete).toBe(false);
						expect(result.errors).toEqual([{ path: name, code: openingCode }]);
					} finally {
						rmSync(root, { recursive: true, force: true });
					}
				}
			}
		}
	},
);

fdIt(
	"#given a primary read error and failing shrink diagnostic #when an observed file is hashed #then the primary read error is preserved",
	() => {
		// Given
		const root = mkdtempSync(join(tmpdir(), "omo-senpi-read-diagnostic-"));
		const path = join(root, "state.json");
		try {
			writeFileSync(path, "AAAA");
			let fstatCalls = 0;
			const io = {
				openSync,
				closeSync,
				statSync,
				readSync() {
					throw codedError("EREAD");
				},
				fstatSync(fd, options) {
					fstatCalls += 1;
					if (fstatCalls > 1) throw codedError("EFSTAT");
					return fstatSync(fd, options);
				},
			};

			// When
			const result = snapshotDirectory(root, LIMITS, io);

			// Then
			expect(result.complete).toBe(false);
			expect(result.errors).toEqual([{ path: "state.json", code: "EREAD" }]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	},
);

fdIt(
	"#given a primary read error and a successful shrink diagnostic #when an observed file is hashed #then the primary read error is preserved",
	() => {
		// Given
		const root = mkdtempSync(join(tmpdir(), "omo-senpi-read-shrink-"));
		const path = join(root, "state.json");
		try {
			writeFileSync(path, "AAAA");
			let fstatCalls = 0;
			const io = {
				openSync,
				closeSync,
				statSync,
				readSync() {
					throw codedError("EIO");
				},
				fstatSync(fd, options) {
					fstatCalls += 1;
					const metadata = fstatSync(fd, options);
					return fstatCalls === 1 ? metadata : { ...metadata, size: 0n };
				},
			};

			// When
			const result = snapshotDirectory(root, LIMITS, io);

			// Then
			expect(result.complete).toBe(false);
			expect(result.errors).toEqual([{ path: "state.json", code: "EIO" }]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	},
);

fdIt(
	"#given directory traversal and close both fail #when the tree is snapshotted #then the traversal error remains primary",
	() => {
		// Given
		const root = mkdtempSync(join(tmpdir(), "omo-senpi-directory-primary-"));
		try {
			const io = {
				opendirSync() {
					return {
						readSync() {
							throw codedError("EIO");
						},
						closeSync() {
							throw codedError("ECLOSE");
						},
					};
				},
			};

			// When
			const result = snapshotDirectory(root, LIMITS, io);

			// Then
			expect(result.complete).toBe(false);
			expect(result.errors).toEqual([{ path: ".", code: "EIO" }]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	},
);

fdIt(
	"#given post-open directory replacement and failing closes #when setup aborts #then both handles close and replacement remains primary",
	() => {
		// Given
		const root = mkdtempSync(join(tmpdir(), "omo-senpi-directory-setup-race-"));
		try {
			let rootStats = 0;
			let directoryCloseCalls = 0;
			let descriptorCloseCalls = 0;
			const io = {
				lstatSync(path, options) {
					const metadata = lstatSync(path, options);
					rootStats += 1;
					return rootStats === 1
						? metadata
						: { ...metadata, ino: metadata.ino + 1n, isDirectory: () => true };
				},
				opendirSync(path) {
					const directory = opendirSync(path);
					return {
						readSync: () => directory.readSync(),
						closeSync() {
							directoryCloseCalls += 1;
							directory.closeSync();
							throw codedError("EDIRECTORY_CLOSE");
						},
					};
				},
				closeDirectorySync(fd) {
					descriptorCloseCalls += 1;
					closeSync(fd);
					throw codedError("EDESCRIPTOR_CLOSE");
				},
			};

			// When
			const result = snapshotDirectory(root, LIMITS, io);

			// Then
			expect({
				directoryCloseCalls,
				descriptorCloseCalls,
				errors: result.errors,
			}).toEqual({
				directoryCloseCalls: 1,
				descriptorCloseCalls: 1,
				errors: [{ path: ".", code: "FILE_REPLACED" }],
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	},
);

fdIt(
	"#given successful raw directory traversal and descriptor close failure #when the tree is snapshotted #then the close error surfaces",
	() => {
		// Given
		const root = mkdtempSync(join(tmpdir(), "omo-senpi-raw-directory-close-"));
		try {
			const io = {
				closeDirectorySync() {
					throw codedError("ECLOSE");
				},
			};

			// When
			const result = snapshotDirectory(root, LIMITS, io);

			// Then
			expect(result.complete).toBe(false);
			expect(result.errors).toEqual([{ path: ".", code: "ECLOSE" }]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	},
);

fdIt(
	"#given successful directory traversal and close failure #when the tree is snapshotted #then the close error surfaces",
	() => {
		// Given
		const root = mkdtempSync(join(tmpdir(), "omo-senpi-directory-close-"));
		try {
			const io = {
				opendirSync() {
					return {
						readSync() {
							return null;
						},
						closeSync() {
							throw codedError("ECLOSE");
						},
					};
				},
			};

			// When
			const result = snapshotDirectory(root, LIMITS, io);

			// Then
			expect(result.complete).toBe(false);
			expect(result.errors).toEqual([{ path: ".", code: "ECLOSE" }]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	},
);

fdIt(
	"#given a regular file uses a volatile directory name #when the tree is snapshotted #then it remains observable and persistent",
	() => {
		// Given
		const root = mkdtempSync(join(tmpdir(), "omo-senpi-volatile-name-file-"));
		try {
			writeFileSync(join(root, "sessions"), "persistent");

			// When
			const result = snapshotDirectory(root, LIMITS);

			// Then
			expect(result.complete).toBe(true);
			expect(result.snapshot.has("sessions")).toBe(true);
			expect(result.errors).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	},
);

fdIt(
	"#given a regular file becomes a symlink after reading #when final identity is checked #then the symlink target is never dereferenced",
	() => {
		// Given
		const root = mkdtempSync(join(tmpdir(), "omo-senpi-post-read-symlink-"));
		const target = mkdtempSync(join(tmpdir(), "omo-senpi-post-read-target-"));
		try {
			const path = join(root, "state.json");
			const oldPath = join(root, "state.old");
			const targetPath = join(target, "secret");
			writeFileSync(path, "safe");
			writeFileSync(targetPath, "secret");
			let replaced = false;
			let targetDereferenced = false;
			const io = {
				readSync(fd, buffer, offset, length, position) {
					const count = readSync(fd, buffer, offset, length, position);
					if (!replaced) {
						replaced = true;
						renameSync(path, oldPath);
						symlinkSync(targetPath, path);
					}
					return count;
				},
				statSync(file, options) {
					if (file === path || file.endsWith("/state.json"))
						targetDereferenced = true;
					return statSync(file, options);
				},
			};

			// When
			const result = snapshotDirectory(root, LIMITS, io);

			// Then
			expect(targetDereferenced).toBe(false);
			expect(result.complete).toBe(false);
			expect(result.errors).toEqual([
				{ path: "state.json", code: "FILE_REPLACED" },
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
			rmSync(target, { recursive: true, force: true });
		}
	},
);

fdIt(
	"#given a regular file is replaced by a symlink before hashing #when the tree is snapshotted #then the symlink target is never dereferenced",
	() => {
		// Given
		const root = mkdtempSync(join(tmpdir(), "omo-senpi-file-symlink-race-"));
		const target = mkdtempSync(
			join(tmpdir(), "omo-senpi-file-symlink-target-"),
		);
		try {
			const path = join(root, "state.json");
			const targetPath = join(target, "secret");
			writeFileSync(path, "safe");
			writeFileSync(targetPath, "secret");
			let targetDereferenced = false;
			const io = {
				openSync(file, flags) {
					if (file === path || file.endsWith("/state.json")) {
						rmSync(file);
						symlinkSync(targetPath, file);
						try {
							const fd = openSync(file, flags);
							targetDereferenced = true;
							return fd;
						} catch (error) {
							if (error.code !== "ELOOP") throw error;
							throw error;
						}
					}
					return openSync(file, flags);
				},
			};

			// When
			const result = snapshotDirectory(root, LIMITS, io);

			// Then
			expect(result.complete).toBe(false);
			expect(targetDereferenced).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
			rmSync(target, { recursive: true, force: true });
		}
	},
);
