// source-refresh.mjs - `source refresh <S<n>>`: the one explicit repin of a source snapshot.
//
// Re-fetches meta.url (or reads the new capture given with the source snapshot input flags),
// replaces the snapshot, and re-anchors every active byte-located ledger row on that source by its
// exact quote plus its stored context (raw-locator.mjs reanchor): a row found once gets the new
// snapshot_sha256 and keeps its old locator, so `fact verify` then reports minor `relocated` with
// the old and new byte offsets; a row whose quote is gone keeps its old pin, is reported as
// quote_not_verbatim here, and stays a snapshot_hash_mismatch blocker until it is retracted or
// re-added. A legacy text.txt row on the source (no byte locator) cannot be re-anchored: it is
// listed as legacy_not_reanchored and stays a blocker. Exit 0 when every row re-anchored, 1 otherwise. node: builtins and sibling imports only.

import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { CliError, parseArgs } from "./cli-support.mjs"
import { DEFECT_CODES } from "./contracts.mjs"
import { readLedger, writeLedger } from "./fact-ledger.mjs"
import { reanchor } from "./raw-locator.mjs"
import { acquire, sessionDirOf, snapshotOf } from "./source-commands.mjs"
import { writeSnapshot } from "./source-snapshot.mjs"

export const REFRESH_USAGE =
	"usage: source refresh S<n> [--url <u> | --html <file> | --raw <file> [--text <file> --extractor NAME@VERSION] | --text <file> | --command '<argv json>' --cwd DIR] [--charset NAME] --session-dir D (no input flag re-fetches the source's http(s) url)"

const INPUTS = ["url", "html", "raw", "text", "command"]

const defect = (code, message) => ({ code, severity: DEFECT_CODES[code].severity, integrity: DEFECT_CODES[code].integrity, message })

export async function runRefresh(argv) {
	const args = parseArgs(argv)
	const id = args.positionals[0] ?? args.flags.id
	if (!id || id === true) throw new CliError(REFRESH_USAGE)
	const sessionDir = sessionDirOf(args.flags)
	const before = snapshotOf(sessionDir, id)
	const flags = { ...args.flags }
	if (!INPUTS.some((name) => flags[name] !== undefined)) {
		if (!/^https?:\/\//i.test(String(before.meta.url))) throw new CliError(`${id} was not fetched from an http(s) url; pass its new capture. ${REFRESH_USAGE}`)
		flags.url = before.meta.url
	}
	const { receipt, ...input } = await acquire(flags)
	input.kind ??= flags.kind ?? before.meta.kind
	input.provenance = flags.provenance ?? before.meta.provenance
	input.revision = flags.revision ?? before.meta.revision ?? undefined
	let written
	try {
		written = writeSnapshot(join(sessionDir, "sources"), id, input, { replace: true })
	} catch (error) {
		if (error instanceof TypeError) throw new CliError(error.message)
		throw error
	}
	if (receipt) writeFileSync(join(written.dir, "command.json"), `${JSON.stringify(receipt, null, 2)}\n`)
	const after = snapshotOf(sessionDir, id)
	const ledger = readLedger(sessionDir)
	const rows = []
	const defects = []
	for (const row of ledger.rows) {
		if (row.source_id !== id || row.status !== "active") continue
		if (row.locator?.unit === undefined) {
			rows.push({ fact_id: row.fact_id, status: "legacy_not_reanchored" })
			defects.push(defect("snapshot_hash_mismatch", `${row.fact_id}: a legacy text.txt row has no byte locator to re-anchor on refreshed ${id}; add it again from the new snapshot or retract it`))
			continue
		}
		if (row.locator.unit !== "bytes") continue
		const anchor = row.locator.artifact === after.view.artifact ? reanchor(after.view, row) : null
		const span = `${row.locator.char_start}:${row.locator.char_end}`
		if (!anchor) {
			rows.push({ fact_id: row.fact_id, status: "not_found", from: span })
			defects.push(defect("quote_not_verbatim", `${row.fact_id}: its quote and context are not found once in refreshed ${id}; retract it or add it again from the new snapshot`))
			continue
		}
		row.snapshot_sha256 = after.sha256
		rows.push({ fact_id: row.fact_id, status: anchor.relocated ? "relocated" : "unchanged", from: span, to: `${anchor.start}:${anchor.end}` })
		if (anchor.relocated) defects.push(defect("relocated", `${row.fact_id}: ${span} -> ${anchor.start}:${anchor.end} (bytes of ${id}/${after.view.artifact})`))
	}
	writeLedger(sessionDir, ledger)
	const failed = rows.filter((row) => row.status === "not_found" || row.status === "legacy_not_reanchored").length
	const exitCode = failed > 0 ? 1 : 0
	const data = { source_id: id, previous_sha256: before.sha256, snapshot_sha256: after.sha256, text_source: after.view.mode, rows }
	const json = { command: "source refresh", status: exitCode === 0 ? "pass" : "fail", exitCode, defects, data }
	const moved = rows.filter((row) => row.status === "relocated").length
	return { json, summary: `source refresh: ${id} ${before.sha256.slice(0, 12)} -> ${after.sha256.slice(0, 12)}; ${rows.length - failed} row(s) re-anchored (${moved} relocated), ${failed} not re-anchored`, exitCode }
}
