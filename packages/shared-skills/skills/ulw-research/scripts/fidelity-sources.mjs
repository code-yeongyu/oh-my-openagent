// Source integrity and raw quote anchoring, shared by the fidelity value checks. Fails closed:
// a cited source-backed row whose sources dir, meta.json, raw.bin, or text.txt cannot be read, or
// whose snapshot no longer matches its pin, gets snapshot_hash_mismatch (with fact_id) naming the
// cause; healthy sources keep their metadata and checks. flag is (code, node, message, extra).
import { join } from "node:path"

import { proseText } from "./html-lite.mjs"
import { reanchor } from "./raw-locator.mjs"
import { readSnapshot } from "./source-view.mjs"

const short = (hash) => String(hash ?? "none").slice(0, 12)

function snapshotOf(sourcesDir, id) {
	if (!sourcesDir) throw new Error("has no sources directory")
	return readSnapshot(join(sourcesDir, id))
}

const blocked = (flag, cited, row, id, cause) => flag("snapshot_hash_mismatch", cited.get(row.fact_id), `${row.fact_id}: snapshot ${id} ${cause}`, { fact_id: row.fact_id })

/** One source's checks for the rows that cite it; byte-located rows are re-anchored on the view. */
function rowChecks(snap, id, referenced, cited, flag) {
	const converted = snap.view.mode === "converted"
	for (const row of referenced) {
		const node = cited.get(row.fact_id)
		// No locator unit marks a legacy text.txt row: it holds only on the legacy snapshot it pins.
		if (row.locator?.unit === undefined) {
			if (snap.view.mode !== "legacy") blocked(flag, cited, row, id, `is no longer the legacy text.txt snapshot the row was located on (now ${snap.view.mode}); add the row again from the new snapshot`)
			else if (row.snapshot_sha256 !== snap.sha256) blocked(flag, cited, row, id, `holds ${short(snap.sha256)} but the legacy row pins ${short(row.snapshot_sha256)}`)
			continue
		}
		if (snap.view.mode === "legacy") {
			blocked(flag, cited, row, id, "raw.bin is missing (the row is byte-located)")
			continue
		}
		if (converted && row.kind !== "quote") {
			flag("snapshot_not_raw", node, `${row.fact_id} cannot measure converted-only source ${id}`)
			continue
		}
		if (row.snapshot_sha256 !== snap.sha256) {
			blocked(flag, cited, row, id, `holds ${short(snap.sha256)} but the row pins ${short(row.snapshot_sha256)}; run source refresh ${id} to re-anchor`)
			continue
		}
		const anchor = row.locator.artifact === snap.view.artifact ? reanchor(snap.view, row) : null
		if (!anchor) flag("quote_not_verbatim", node, `${row.fact_id}: no unique exact quote and context in ${id}/${snap.view.artifact}`)
		else if (anchor.relocated) flag("relocated", node, `${row.fact_id}: ${row.locator.char_start}:${row.locator.char_end} -> ${anchor.start}:${anchor.end} (bytes of ${id}/${snap.view.artifact})`)
		if (converted && row.kind === "quote") flag("quote_converted_only", node, `${row.fact_id} quotes converted-only source ${id}, not the original fetched bytes`)
	}
}

export function sourceChecks(ctx, rows, cited, sourcesDir, flag, unreadable = new Set()) {
	const referenced = new Map()
	for (const key of cited.keys()) {
		const row = rows.get(key)
		if (row?.source_id) referenced.set(row.source_id, [...(referenced.get(row.source_id) ?? []), row])
	}
	const ids = new Set(referenced.keys())
	for (const match of proseText(ctx.body).matchAll(/\[S(\d+)\]/g)) ids.add(`S${match[1]}`)
	const meta = new Map()
	for (const id of ids) {
		if (unreadable.has(id)) continue
		const backing = referenced.get(id) ?? []
		let snap
		try {
			snap = snapshotOf(sourcesDir, id)
		} catch (error) {
			// A source only named in prose ([S<n>]) backs no row: an absent snapshot is not a finding.
			for (const row of backing) blocked(flag, cited, row, id, error.message)
			continue
		}
		meta.set(id, snap.meta)
		if (snap.drift.length === 0) rowChecks(snap, id, backing, cited, flag)
		else if (backing.length === 0) flag("snapshot_hash_mismatch", ctx.body, `snapshot ${id} ${snap.drift.join("; ")}`)
		else for (const row of backing) blocked(flag, cited, row, id, snap.drift.join("; "))
	}
	return meta
}
