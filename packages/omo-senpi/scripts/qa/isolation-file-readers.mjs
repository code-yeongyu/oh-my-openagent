import { createHash } from "node:crypto";
import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	opendirSync,
	openSync,
	readFileSync,
	readlinkSync,
	readSync,
	statSync,
} from "node:fs";

const HASH_CHUNK_BYTES = 64 * 1024;
const NO_FOLLOW_READ_FLAGS =
	constants.O_NOFOLLOW === undefined
		? undefined
		: constants.O_RDONLY | constants.O_NOFOLLOW;

export const FILE_IO = {
	noFollowReadFlags: NO_FOLLOW_READ_FLAGS,
	closeSync,
	fstatSync,
	lstatSync,
	openSync,
	opendirSync,
	readFileSync,
	readlinkSync,
	readSync,
	statSync,
};

export function hashFileBounded(
	file,
	{ remainingBytes, io, normalizeCredential },
) {
	let fd;
	let bytesRead = 0;
	let result;
	try {
		if (io.noFollowReadFlags === undefined)
			throw snapshotError("NO_FOLLOW_UNAVAILABLE");
		fd = io.openSync(file.path, io.noFollowReadFlags);
		const opened = fileMetadata(io.fstatSync(fd, { bigint: true }));
		const openingError = changedMetadataCode(file.metadata, opened);
		if (openingError !== undefined)
			diagnoseOpeningRace(file.path, opened, openingError, io);
		const hash = createHash("sha256");
		const settingsChunks = file.rel === "settings.json" ? [] : undefined;
		const buffer = Buffer.allocUnsafe(
			Math.min(HASH_CHUNK_BYTES, Math.max(file.size, 1)),
		);
		while (bytesRead < file.size) {
			const requested = Math.min(
				buffer.length,
				file.size - bytesRead,
				remainingBytes - bytesRead,
			);
			const count = io.readSync(fd, buffer, 0, requested, bytesRead);
			if (count === 0) throw snapshotError("SHORT_READ");
			const chunk = buffer.subarray(0, count);
			hash.update(chunk);
			if (settingsChunks !== undefined) settingsChunks.push(Buffer.from(chunk));
			bytesRead += count;
		}
		const finished = fileMetadata(io.fstatSync(fd, { bigint: true }));
		const pathMetadata = fileMetadata(
			io.lstatSync(file.path, { bigint: true }),
		);
		if (!sameIdentity(finished, pathMetadata))
			throw snapshotError("FILE_REPLACED");
		if (
			changedMetadataCode(opened, finished) !== undefined ||
			changedMetadataCode(finished, pathMetadata) !== undefined
		) {
			throw snapshotError("FILE_CHANGED");
		}
		const digest =
			settingsChunks === undefined
				? hash.digest("hex")
				: createHash("sha256")
						.update(
							normalizeCredential(
								Buffer.concat(settingsChunks),
								"settings.json",
							),
						)
						.digest("hex");
		result = { bytesRead, digest };
	} catch (error) {
		result = { bytesRead, error: errorCode(error) };
	} finally {
		if (fd !== undefined) {
			try {
				io.closeSync(fd);
			} catch (error) {
				if (result?.error === undefined)
					result = { bytesRead, error: errorCode(error) };
			}
		}
	}
	return result;
}

export function hashSymlinkBounded(file, { remainingBytes, io }) {
	try {
		const opened = fileMetadata(io.lstatSync(file.path, { bigint: true }));
		const openingError = changedMetadataCode(file.metadata, opened);
		if (openingError !== undefined)
			diagnoseOpeningRace(file.path, opened, openingError, io, "lstatSync");
		const target = Buffer.from(
			io.readlinkSync(file.path, { encoding: "buffer" }),
		);
		if (target.length > remainingBytes)
			return { bytesRead: 0, truncated: true };
		const finished = fileMetadata(io.lstatSync(file.path, { bigint: true }));
		const changed = changedMetadataCode(opened, finished);
		if (changed !== undefined) throw snapshotError(changed);
		return {
			bytesRead: target.length,
			digest: createHash("sha256")
				.update("symlink\0")
				.update(target)
				.digest("hex"),
		};
	} catch (error) {
		return { bytesRead: 0, error: errorCode(error) };
	}
}

export function readProtectedFileStable(path, io) {
	let beforePathStat;
	try {
		beforePathStat = io.lstatSync(path, { bigint: true });
	} catch (error) {
		if (errorCode(error) !== "ENOENT") return { error: errorCode(error) };
		return readProtectedAbsentRace(path, io);
	}
	if (!beforePathStat.isFile()) return { error: "UNSUPPORTED_ENTRY" };
	const beforePath = fileMetadata(beforePathStat);
	let fd;
	let result;
	try {
		if (io.noFollowReadFlags === undefined)
			throw snapshotError("NO_FOLLOW_UNAVAILABLE");
		fd = io.openSync(path, io.noFollowReadFlags);
		const opened = fileMetadata(io.fstatSync(fd, { bigint: true }));
		const openingError = changedMetadataCode(beforePath, opened);
		if (openingError !== undefined)
			diagnoseOpeningRace(path, opened, openingError, io, "lstatSync");
		const content = io.readFileSync(fd);
		const finished = fileMetadata(io.fstatSync(fd, { bigint: true }));
		const afterPath = fileMetadata(io.lstatSync(path, { bigint: true }));
		if (!sameIdentity(finished, afterPath))
			throw snapshotError("FILE_REPLACED");
		if (
			changedMetadataCode(opened, finished) !== undefined ||
			changedMetadataCode(finished, afterPath) !== undefined
		) {
			throw snapshotError("FILE_CHANGED");
		}
		result = { content };
	} catch (error) {
		result = { error: errorCode(error) };
	} finally {
		if (fd !== undefined) {
			try {
				io.closeSync(fd);
			} catch (error) {
				if (result?.error === undefined) result = { error: errorCode(error) };
			}
		}
	}
	return result;
}

export function errorCode(error) {
	return typeof error === "object" && error !== null && "code" in error
		? String(error.code)
		: "UNKNOWN";
}

export function isMissingSnapshotEntryError(error) {
	return errorCode(error) === "ENOENT";
}

export function isTransientSnapshotEntryError(error) {
	return isMissingSnapshotEntryError(error) || errorCode(error) === "ENOTDIR";
}

export function fileMetadata(stat) {
	return {
		dev: BigInt(stat.dev),
		ino: BigInt(stat.ino),
		size: BigInt(stat.size),
		mtimeNs: BigInt(stat.mtimeNs),
		ctimeNs: BigInt(stat.ctimeNs),
	};
}

function readProtectedAbsentRace(path, io) {
	let fd;
	let result;
	try {
		if (io.noFollowReadFlags === undefined)
			throw snapshotError("NO_FOLLOW_UNAVAILABLE");
		fd = io.openSync(path, io.noFollowReadFlags);
		result = { error: "FILE_REPLACED" };
	} catch (error) {
		result =
			errorCode(error) === "ENOENT"
				? { absent: true }
				: { error: errorCode(error) };
	} finally {
		if (fd !== undefined) {
			try {
				io.closeSync(fd);
			} catch (error) {
				if (result?.error === undefined) result = { error: errorCode(error) };
			}
		}
	}
	return result;
}

function diagnoseOpeningRace(
	path,
	opened,
	openingError,
	io,
	statMethod = "statSync",
) {
	let currentPath;
	try {
		currentPath = fileMetadata(io[statMethod](path, { bigint: true }));
	} catch {
		throw snapshotError(openingError);
	}
	if (!sameIdentity(opened, currentPath)) throw snapshotError("FILE_REPLACED");
	throw snapshotError(openingError);
}

function sameIdentity(before, after) {
	return before.dev === after.dev && before.ino === after.ino;
}

function changedMetadataCode(before, after) {
	if (!sameIdentity(before, after)) return "FILE_REPLACED";
	if (
		before.size !== after.size ||
		before.mtimeNs !== after.mtimeNs ||
		before.ctimeNs !== after.ctimeNs
	)
		return "FILE_CHANGED";
	return undefined;
}

function snapshotError(code) {
	return Object.assign(new Error(code), { code });
}
