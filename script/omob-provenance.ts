import { createHash } from "node:crypto"
import { closeSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs"

export interface BinaryIdentity {
	readonly dev: number
	readonly ino: number
	readonly size: number
	readonly mtimeMs: number
	/** Included so a chmod alone stops the marker from speaking for the file. */
	readonly mode: number
}

export interface ProvenanceMarker {
	readonly identity: BinaryIdentity
	readonly contentSha256: string
	readonly versionOutput: string
}

/**
 * Digests the executable in bounded chunks rather than reading 100+ MB into memory. Measured at
 * ~97ms for the current binary against ~213ms to spawn it for `--version`, so verifying content
 * is both cheaper than the spawn it replaces and a stronger claim than what the file says about
 * itself.
 */
export function binaryContentDigest(binary: string): string | undefined {
	const chunk = Buffer.allocUnsafe(1024 * 1024)
	let handle: number | undefined
	try {
		handle = openSync(binary, "r")
		const hash = createHash("sha256")
		for (;;) {
			const read = readSync(handle, chunk, 0, chunk.length, null)
			if (read <= 0) break
			hash.update(chunk.subarray(0, read))
		}
		return hash.digest("hex")
	} catch {
		return undefined
	} finally {
		if (handle !== undefined) {
			try {
				closeSync(handle)
			} catch {
				// The descriptor is already gone; nothing to release.
			}
		}
	}
}

export function provenancePath(binary: string): string {
	return `${binary}.provenance.json`
}

export function binaryIdentity(binary: string): BinaryIdentity | undefined {
	try {
		const stats = statSync(binary)
		return { dev: stats.dev, ino: stats.ino, size: stats.size, mtimeMs: stats.mtimeMs, mode: stats.mode }
	} catch {
		return undefined
	}
}

const IDENTITY_FIELDS = ["dev", "ino", "size", "mtimeMs", "mode"] as const

function isBinaryIdentity(value: unknown): value is BinaryIdentity {
	if (typeof value !== "object" || value === null) return false
	const record = value as Record<string, unknown>
	return IDENTITY_FIELDS.every((field) => typeof record[field] === "number")
}

function sameIdentity(left: BinaryIdentity, right: BinaryIdentity): boolean {
	return IDENTITY_FIELDS.every((field) => left[field] === right[field])
}

/**
 * Records what an installed executable answers to `--version`, so the refresh check does not
 * have to spawn it on every launch. The marker is bound to the exact bytes it was written for:
 * the stat identity is a free pre-filter and the content digest is the actual proof, so a marker
 * cannot outlive a failed install, a replaced executable, or an in-place rewrite that restores
 * the original size, mtime and mode.
 */
export function writeProvenanceMarker(binary: string, versionOutput: string): void {
	const identity = binaryIdentity(binary)
	if (identity === undefined) return
	const contentSha256 = binaryContentDigest(binary)
	if (contentSha256 === undefined) return
	try {
		writeFileSync(provenancePath(binary), `${JSON.stringify({ identity, contentSha256, versionOutput })}\n`)
	} catch {
		// The marker is a cache; failing to write it only costs the next launch a spawn.
	}
}

export function readProvenanceMarker(binary: string): string | undefined {
	const identity = binaryIdentity(binary)
	if (identity === undefined) return undefined
	let parsed: unknown
	try {
		parsed = JSON.parse(readFileSync(provenancePath(binary), "utf8"))
	} catch {
		return undefined
	}
	// Anything can be on disk here - a truncated write, a hand-edit, a file from another tool - and
	// every shape must degrade to "ask the executable", never to a throw on the launch path.
	if (typeof parsed !== "object" || parsed === null) return undefined
	const record = parsed as Record<string, unknown>
	if (typeof record.versionOutput !== "string") return undefined
	if (typeof record.contentSha256 !== "string") return undefined
	if (!isBinaryIdentity(record.identity)) return undefined
	// Cheap metadata first: a mismatch here rules the marker out without hashing 100+ MB.
	if (!sameIdentity(record.identity, identity)) return undefined
	const contentSha256 = binaryContentDigest(binary)
	if (contentSha256 === undefined || contentSha256 !== record.contentSha256) return undefined
	return record.versionOutput
}
