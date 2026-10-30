// Availability is checked before hash/locator checks, including the raw-byte snapshot contract.
// One code (snapshot_hash_mismatch) for every unreadable or changed snapshot; the message names the cause.
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { sha256Of } from "./cli-support.mjs"

function read(dir, file) {
	try {
		return readFileSync(join(dir, file))
	} catch (error) {
		if (error.code === "ENOENT") throw new Error(`${file} is missing`)
		if (error.code === "EISDIR") throw new Error(`${file} is not a readable file`)
		throw new Error(`${file} is unreadable (${error.code ?? error.message})`)
	}
}

/** Why the snapshot behind `row` cannot be trusted, or null when it reads and matches its pinned hash. */
export function snapshotCause(sourcesDir, row) {
	if (!sourcesDir) return "has no sources directory"
	const dir = join(sourcesDir, row.source_id)
	try {
		let meta
		try {
			meta = JSON.parse(read(dir, "meta.json").toString("utf8"))
		} catch (error) {
			throw error instanceof SyntaxError ? new Error("meta.json is not valid JSON") : error
		}
		if (!meta || typeof meta.sha256 !== "string") return "has invalid snapshot metadata (meta.json has no sha256)"
		const needsRaw = ["bytes", "utf8-bytes"].includes(row.locator?.unit) && meta.kind !== "converted-only"
		const file = existsSync(join(dir, "raw.bin")) || needsRaw ? "raw.bin" : "text.txt"
		return sha256Of(read(dir, file)) === meta.sha256 ? null : `hash mismatch: ${file} changed after its snapshot was pinned`
	} catch (error) {
		return error.message
	}
}

/** Flags each cited row whose own snapshot is unreadable; returns those source ids so healthy sources keep their metadata. */
export function unreadableSnapshots(ctx, rows, cited, sourcesDir, out) {
	const unreadable = new Set()
	for (const [id, node] of cited) {
		const row = rows.get(id)
		if (!row?.source_id) continue
		const cause = snapshotCause(sourcesDir, row)
		if (cause === null) continue
		unreadable.add(row.source_id)
		out.push({ ...ctx.defect("snapshot_hash_mismatch", node, `${id}: snapshot ${row.source_id} ${cause}`), fact_id: id })
	}
	return unreadable
}
