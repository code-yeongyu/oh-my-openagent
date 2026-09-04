// allow: SIZE_OK - bounded snapshots and their canonical verdict share one normalization contract.
import { createHash } from "node:crypto";
import { constants, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
	errorCode,
	FILE_IO,
	fileMetadata,
	hashFileBounded,
	hashSymlinkBounded,
	isMissingSnapshotEntryError,
	isTransientSnapshotEntryError,
	readProtectedFileStable,
} from "./isolation-file-readers.mjs";

const CREDENTIAL_FILES = [
	"auth.json",
	"models.json",
	"settings.json",
	"trust.json",
];
export const PROTECTED_STATE_FILES = [
	"auth.json",
	"settings.json",
	"models.json",
	"models-store.json",
	"trust.json",
	"hooks-state.json",
];
export const OBSERVATION_LIMITS = {
	maxFiles: 10_000,
	maxBytes: 64 * 1024 * 1024,
	maxEntries: 20_000,
};
const NATIVE_PATH_STYLE = process.platform === "win32" ? "windows" : "posix";
const VOLATILE_SUBTREES = new Set(["sessions", "cache", "logs"]);

export function credentialDigest(agentDir, { readFile = readFileSync } = {}) {
	const hash = createHash("sha256");
	for (const name of CREDENTIAL_FILES) {
		let content;
		try {
			content = credentialBytes(readFile(join(agentDir, name)), name);
		} catch (error) {
			if (errorCode(error) !== "ENOENT") throw error;
			content = Buffer.from("absent");
		}
		hash.update(name);
		hash.update("\0");
		hash.update(content);
		hash.update("\0");
	}
	return hash.digest("hex");
}

export function snapshotProtectedState(root, readFileOrIo = FILE_IO) {
	const io = protectedFileIo(readFileOrIo);
	const snapshot = new Map();
	const errors = [];
	for (const name of PROTECTED_STATE_FILES) {
		const result = readProtectedFileStable(join(root, name), io);
		if (result.error !== undefined)
			errors.push({ path: name, code: result.error });
		else if (result.absent) snapshot.set(name, "absent");
		else
			snapshot.set(
				name,
				createHash("sha256")
					.update(credentialBytes(result.content, name))
					.digest("hex"),
			);
	}
	return { snapshot, complete: errors.length === 0, errors };
}

export function protectedSnapshotsUntouched(before, after) {
	return (
		before.complete &&
		after.complete &&
		changedSnapshotPaths(before.snapshot, after.snapshot).length === 0
	);
}

export function snapshotDirectory(
	root,
	limits = OBSERVATION_LIMITS,
	{ pathStyle = NATIVE_PATH_STYLE, ...ioOverrides } = {},
) {
	const io = { ...FILE_IO, ...ioOverrides };
	const state = {
		root,
		pathStyle,
		snapshot: new Map(),
		files: 0,
		errors: [],
		entries: 0,
		bytesRead: 0,
		truncated: false,
		limits: {
			maxFiles: limits.maxFiles,
			maxBytes: limits.maxBytes,
			maxEntries: limits.maxEntries ?? OBSERVATION_LIMITS.maxEntries,
		},
		io,
	};
	collectFilesBounded(root, state);
	return {
		snapshot: new Map(
			[...state.snapshot.entries()].sort(([left], [right]) =>
				compareCanonicalText(left, right),
			),
		),
		complete: !state.truncated && state.errors.length === 0,
		truncated: state.truncated,
		errors: state.errors.sort(compareSnapshotErrors),
		bytesRead: state.bytesRead,
		domain: "nonvolatile-home",
	};
}

export function changedSnapshotPaths(
	before,
	after,
	pathStyle = NATIVE_PATH_STYLE,
) {
	return [...new Set([...before.keys(), ...after.keys()])]
		.filter((path) => before.get(path) !== after.get(path))
		.map((path) => canonicalRelativePath(path, pathStyle))
		.sort(compareCanonicalText);
}

export function classifyObservedChanges(paths, pathStyle = NATIVE_PATH_STYLE) {
	const volatile = new Set();
	const protectedState = new Set();
	const other = new Set();
	for (const rawPath of paths) {
		const path = canonicalRelativePath(rawPath, pathStyle);
		if (
			path.startsWith("sessions/") ||
			path.startsWith("cache/") ||
			path.startsWith("logs/") ||
			path.endsWith(".log")
		)
			volatile.add(path);
		else if (PROTECTED_STATE_FILES.includes(path)) protectedState.add(path);
		else other.add(path);
	}
	return {
		volatile: [...volatile].sort(compareCanonicalText),
		protectedState: [...protectedState].sort(compareCanonicalText),
		other: [...other].sort(compareCanonicalText),
	};
}

export function scopedIsolationVerdict(observations) {
	const changedPaths = observations
		.flatMap(({ name, before, after }) =>
			changedSnapshotPaths(before.snapshot, after.snapshot).map(
				(path) => `${name}/${path}`,
			),
		)
		.sort(compareCanonicalText);
	const errors = observations
		.flatMap(({ name, before, after }) => [
			...before.errors.map((error) => ({
				root: name,
				phase: "before",
				...error,
			})),
			...after.errors.map((error) => ({
				root: name,
				phase: "after",
				...error,
			})),
		])
		.sort(compareScopedErrors);
	const complete = observations.every(
		({ before, after }) =>
			observationComplete(before) && observationComplete(after),
	);
	return {
		certified: complete && changedPaths.length === 0,
		complete,
		truncated: observations.some(
			({ before, after }) => before.truncated || after.truncated,
		),
		changedPaths,
		errors,
		bytesRead: observations.reduce(
			(total, { before, after }) => total + before.bytesRead + after.bytesRead,
			0,
		),
	};
}

export function isolationVerdict({
	beforeProtected,
	afterProtected,
	beforeObserved,
	afterObserved,
	observedChangedPaths,
	pathStyle = NATIVE_PATH_STYLE,
}) {
	const directProtected = changedSnapshotPaths(
		beforeProtected.snapshot,
		afterProtected.snapshot,
		pathStyle,
	);
	const observed = classifyObservedChanges(observedChangedPaths, pathStyle);
	const changedPaths = [
		...new Set([
			...directProtected,
			...observed.protectedState,
			...observed.other,
		]),
	].sort(compareCanonicalText);
	return {
		changedPaths,
		untouched:
			beforeProtected.complete &&
			afterProtected.complete &&
			observationComplete(beforeObserved) &&
			observationComplete(afterObserved) &&
			changedPaths.length === 0,
	};
}

export function digestDirectory(
	root,
	{ readdir = readdirSync, readFile = readFileSync } = {},
) {
	const files = [];
	if (!collectFiles(root, files, readdir, true)) return "absent";
	const hash = createHash("sha256");
	for (const file of files.sort()) {
		const rel = canonicalRelativePath(
			file.slice(root.length + 1),
			NATIVE_PATH_STYLE,
		);
		try {
			const fileDigest = createHash("sha256")
				.update(readFile(file))
				.digest("hex");
			hash.update(rel);
			hash.update("\0");
			hash.update(fileDigest);
			hash.update("\0");
		} catch (error) {
			if (!isTransientSnapshotEntryError(error)) throw error;
		}
	}
	return hash.digest("hex");
}

function credentialBytes(content, name) {
	if (name !== "settings.json") return content;
	try {
		const settings = JSON.parse(content.toString("utf8"));
		if (
			typeof settings !== "object" ||
			settings === null ||
			Array.isArray(settings)
		)
			return content;
		delete settings.tipsHistory;
		delete settings.lastChangelogVersion;
		delete settings.modelLastOnThinkingLevels;
		return JSON.stringify(settings);
	} catch {
		return content;
	}
}

function collectFilesBounded(currentRoot, state, boundRoot = currentRoot) {
	const { io, limits } = state;
	const currentRel = canonicalRelativePath(
		relative(state.root, currentRoot) || ".",
		state.pathStyle,
	);
	let beforeOpen;
	try {
		beforeOpen = io.lstatSync(boundRoot, { bigint: true });
	} catch (error) {
		if (isMissingSnapshotEntryError(error)) {
			if (currentRoot !== state.root)
				state.errors.push({ path: currentRel, code: "FILE_REPLACED" });
		} else if (
			currentRoot !== state.root &&
			isTransientSnapshotEntryError(error)
		) {
			state.errors.push({ path: currentRel, code: "FILE_REPLACED" });
		} else {
			state.errors.push({ path: currentRel, code: errorCode(error) });
		}
		return;
	}
	if (!beforeOpen.isDirectory()) {
		state.errors.push({
			path: currentRel,
			code: currentRoot === state.root ? "UNSUPPORTED_ENTRY" : "FILE_REPLACED",
		});
		return;
	}
	const beforeMetadata = fileMetadata(beforeOpen);
	let directoryFd;
	let directory;
	try {
		if (
			constants.O_DIRECTORY === undefined ||
			constants.O_NOFOLLOW === undefined
		)
			throw Object.assign(new Error("DIRECTORY_IDENTITY_UNAVAILABLE"), {
				code: "DIRECTORY_IDENTITY_UNAVAILABLE",
			});
		directoryFd = (io.openDirectorySync ?? FILE_IO.openSync)(
			boundRoot,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		const opened = (io.fstatDirectorySync ?? FILE_IO.fstatSync)(directoryFd, {
			bigint: true,
		});
		const openedMetadata = fileMetadata(opened);
		if (
			!opened.isDirectory() ||
			beforeMetadata.dev !== openedMetadata.dev ||
			beforeMetadata.ino !== openedMetadata.ino
		)
			throw Object.assign(new Error("FILE_REPLACED"), {
				code: "FILE_REPLACED",
			});
		const descriptorRoot = directoryDescriptorPath(directoryFd);
		if (descriptorRoot === null)
			throw Object.assign(new Error("DIRECTORY_IDENTITY_UNAVAILABLE"), {
				code: "DIRECTORY_IDENTITY_UNAVAILABLE",
			});
		directory = io.opendirSync(descriptorRoot);
		assertDirectoryPathIdentity(currentRoot, beforeMetadata, io);
	} catch (error) {
		state.errors.push({
			path: currentRel,
			code: isTransientSnapshotEntryError(error)
				? "FILE_REPLACED"
				: errorCode(error),
		});
		if (directory !== undefined) closeDirectoryHandle(directory);
		if (directoryFd !== undefined) closeDirectoryFd(directoryFd, io);
		return;
	}
	const errorsBeforeTraversal = state.errors.length;
	let traversalFailed = false;
	try {
		const descriptorRoot = directoryDescriptorPath(directoryFd);
		if (descriptorRoot === null)
			throw Object.assign(new Error("DIRECTORY_IDENTITY_UNAVAILABLE"), {
				code: "DIRECTORY_IDENTITY_UNAVAILABLE",
			});
		state.snapshot.set(currentRel, "directory");
		const entries = [];
		while (true) {
			const entry = directory.readSync();
			if (entry === null) break;
			const path = join(currentRoot, entry.name);
			const rel = canonicalRelativePath(
				relative(state.root, path),
				state.pathStyle,
			);
			const boundPath = join(descriptorRoot, entry.name);
			let pathStat;
			try {
				pathStat = io.lstatSync(boundPath, { bigint: true });
			} catch (error) {
				if (!isTransientSnapshotEntryError(error))
					state.errors.push({ path: rel, code: errorCode(error) });
				continue;
			}
			if (pathStat.isDirectory()) {
				if (!entry.isDirectory()) {
					state.errors.push({ path: rel, code: "FILE_REPLACED" });
					continue;
				}
				if (VOLATILE_SUBTREES.has(rel)) continue;
			}
			if (pathStat.isFile() && rel.endsWith(".log")) continue;
			state.entries += 1;
			if (state.entries > limits.maxEntries) {
				state.truncated = true;
				return;
			}
			entries.push({ entry, path, rel, pathStat, boundPath });
		}
		entries.sort((left, right) => compareCanonicalText(left.rel, right.rel));
		for (const { path, rel, pathStat, boundPath } of entries) {
			if (pathStat.isDirectory()) {
				collectFilesBounded(path, state, boundPath);
				if (state.truncated) return;
				continue;
			}
			if (!pathStat.isFile() && !pathStat.isSymbolicLink()) {
				state.errors.push({ path: rel, code: "UNSUPPORTED_ENTRY" });
				continue;
			}
			if (state.files >= limits.maxFiles) {
				state.truncated = true;
				return;
			}
			state.files += 1;
			const metadata = fileMetadata(pathStat);
			const file = {
				path: boundPath,
				rel,
				kind: pathStat.isSymbolicLink() ? "symlink" : "file",
				size: boundedSize(metadata.size),
				metadata,
			};
			const remainingBytes = limits.maxBytes - state.bytesRead;
			if (file.size > remainingBytes) {
				state.truncated = true;
				return;
			}
			const result =
				file.kind === "symlink"
					? hashSymlinkBounded(file, { remainingBytes, io })
					: hashFileBounded(file, {
							remainingBytes,
							io,
							normalizeCredential: credentialBytes,
						});
			state.bytesRead += result.bytesRead;
			if (result.truncated) {
				state.truncated = true;
				return;
			}
			if (result.error !== undefined) {
				if (!isTransientSnapshotEntryError({ code: result.error }))
					state.errors.push({ path: rel, code: result.error });
				continue;
			}
			state.snapshot.set(rel, result.digest);
		}
		const finished = (io.fstatDirectorySync ?? FILE_IO.fstatSync)(directoryFd, {
			bigint: true,
		});
		const finishedMetadata = fileMetadata(finished);
		if (
			!finished.isDirectory() ||
			beforeMetadata.dev !== finishedMetadata.dev ||
			beforeMetadata.ino !== finishedMetadata.ino
		)
			throw Object.assign(new Error("FILE_REPLACED"), {
				code: "FILE_REPLACED",
			});
		assertDirectoryPathIdentity(currentRoot, beforeMetadata, io);
		if (
			state.errors.length === errorsBeforeTraversal &&
			(beforeMetadata.size !== finishedMetadata.size ||
				beforeMetadata.mtimeNs !== finishedMetadata.mtimeNs ||
				beforeMetadata.ctimeNs !== finishedMetadata.ctimeNs)
		)
			throw Object.assign(new Error("FILE_CHANGED"), {
				code: "FILE_CHANGED",
			});
	} catch (error) {
		traversalFailed = true;
		state.errors.push({ path: currentRel, code: errorCode(error) });
	} finally {
		const directoryCloseError = closeDirectoryHandle(directory);
		if (
			directoryCloseError !== undefined &&
			!traversalFailed &&
			state.errors.length === errorsBeforeTraversal
		)
			state.errors.push({ path: currentRel, code: directoryCloseError });
		const primaryFailed =
			traversalFailed || state.errors.length !== errorsBeforeTraversal;
		if (directoryFd !== undefined) {
			const closeError = closeDirectoryFd(directoryFd, io);
			if (!primaryFailed && closeError !== undefined)
				state.errors.push({ path: currentRel, code: closeError });
		}
	}
}

function assertDirectoryPathIdentity(path, expected, io) {
	const current = io.lstatSync(path, { bigint: true });
	const metadata = fileMetadata(current);
	if (
		!current.isDirectory() ||
		expected.dev !== metadata.dev ||
		expected.ino !== metadata.ino
	)
		throw Object.assign(new Error("FILE_REPLACED"), {
			code: "FILE_REPLACED",
		});
}

function directoryDescriptorPath(fd) {
	if (process.platform === "linux") return `/proc/self/fd/${fd}`;
	if (process.platform === "darwin") return `/dev/fd/${fd}`;
	return null;
}

function closeDirectoryHandle(directory) {
	try {
		directory.closeSync();
	} catch (error) {
		return errorCode(error);
	}
	return undefined;
}

function closeDirectoryFd(fd, io) {
	try {
		(io.closeDirectorySync ?? FILE_IO.closeSync)(fd);
	} catch (error) {
		return errorCode(error);
	}
	return undefined;
}

function protectedFileIo(readFileOrIo) {
	if (typeof readFileOrIo === "function") {
		return {
			...FILE_IO,
			...Object.fromEntries(Object.entries(readFileOrIo)),
			readFileSync: readFileOrIo,
		};
	}
	return { ...FILE_IO, ...readFileOrIo };
}

function boundedSize(size) {
	return size > BigInt(Number.MAX_SAFE_INTEGER)
		? Number.POSITIVE_INFINITY
		: Number(size);
}

function compareSnapshotErrors(left, right) {
	return (
		compareCanonicalText(left.path, right.path) ||
		compareCanonicalText(left.code, right.code)
	);
}

function compareScopedErrors(left, right) {
	return (
		compareCanonicalText(left.root, right.root) ||
		compareCanonicalText(left.phase, right.phase) ||
		compareSnapshotErrors(left, right)
	);
}

function compareCanonicalText(left, right) {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

function collectFiles(root, files, readdir, isRoot = false) {
	let entries;
	try {
		entries = readdir(root, { withFileTypes: true });
	} catch (error) {
		if (isMissingSnapshotEntryError(error)) return !isRoot;
		if (!isRoot && isTransientSnapshotEntryError(error)) return true;
		throw error;
	}
	for (const entry of entries) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) collectFiles(path, files, readdir);
		else if (entry.isFile()) files.push(path);
	}
	return true;
}

function observationComplete(observation) {
	return (
		observation.domain === "nonvolatile-home" &&
		observation.complete &&
		!observation.truncated &&
		observation.errors.length === 0
	);
}

function canonicalRelativePath(path, pathStyle) {
	return pathStyle === "windows" ? path.replaceAll("\\", "/") : path;
}
