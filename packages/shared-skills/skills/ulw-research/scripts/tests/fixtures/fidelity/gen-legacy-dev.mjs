// gen-legacy-dev.mjs - regenerates ledger-legacy-dev.json with dev's own pre-registry writer, so the
// dimension 31 tests load every value shape dev could write, not hand-picked rows.
// Pinned dev commit: 99220c4e95f9ef3a667834486f2caa03873deeab (origin/dev when the fixture was generated).
// Usage: node gen-legacy-dev.mjs [dev-sha]. Needs git and the commit in the local clone; node: builtins only.

import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const DEV_SHA = process.argv[2] ?? "99220c4e95f9ef3a667834486f2caa03873deeab"
const SCRIPTS = "packages/shared-skills/skills/ulw-research/scripts"
// fact-ledger.mjs and every module it imports at the pinned commit.
const WRITER_FILES = ["fact-ledger.mjs", "fact-ledger-kinds.mjs", "fact-ledger-schema.mjs", "cli-support.mjs", "entry-guard.mjs"]
const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, "ledger-legacy-dev.json")

const at = { artifact: "sources/S1/text.txt", line: 2, char_start: 0, char_end: 30 }
const sha = "a".repeat(64)
const base = { extracted_by: "fact add --find", observed_at: "2026-10-20T08:00:00Z" }

function measured(label, value, unit) {
	const raw = `${value} ${unit}`
	return { ...base, kind: "measured", label, value, unit, raw, quote: `The figure is ${raw}.`, value_span: [14, 14 + value.length], source_id: "S1", locator: at, snapshot_sha256: sha }
}

function assumed(label, value, unit, exact) {
	return { ...base, kind: "assumed", label, value, unit, exact, raw: "", quote: "", extracted_by: "fact add --assumed", rationale: "planning assumption from the brief" }
}

function legacy(kind, label, fields) {
	return { ...base, kind, label, raw: "", quote: "", extracted_by: "fact derive", ...fields }
}

// Every kind and every value shape dev's addRow accepts: alias units (English and Korean count and
// currency words, written as escapes so this file stays ASCII), leading zeros, negative values,
// assumed rows with unreduced or zero-padded exacts, and a legacy derived and converted row. The
// last three are shapes dev accepted that the strict dimensions do not (empty metadata, an operation
// on a source row, an extra key in exact): they must load and be refused only as operands.
const SEEDS = [
	measured("north-span", "12", "kilometers"),
	measured("south-span", "8.5", "kilometers"),
	measured("share-online", "41.2", "per cent"),
	measured("share-gap", "1.5", "pp"),
	measured("staff-count", "320", "\uBA85"),
	measured("unit-price", "750", "\uCC9C\uC6D0"),
	measured("padded-span", "007", "km"),
	measured("net-change", "-2.5", "per cent"),
	{ ...base, kind: "quote", label: "quote-claim", raw: "grew fast", quote: "The market grew fast.", value_span: [11, 20], source_id: "S1", locator: at, snapshot_sha256: sha },
	assumed("growth-assumption", "3", "%", null),
	assumed("whole-ratio", "1", "%", { num: "2", den: "2" }),
	assumed("quarter-ratio", "2.5", "kilometers", { num: "10", den: "4" }),
	assumed("padded-exact", "7", "km", { num: "007", den: "01" }),
	assumed("negative-exact", "-2.5", "per cent", { num: "-10", den: "04" }),
	legacy("derived", "total-span", { value: "20.5", unit: "kilometers", exact: { num: "82", den: "4" }, operation: "sum", operands: ["F1", "F2"], derived_from: ["F1", "F2"], formula: "F1 + F2" }),
	legacy("converted", "span-metres", { value: "12000", unit: "m", exact: { num: "24000", den: "2" }, operation: "convert", operands: ["F1"], derived_from: ["F1"], formula: "F1 * 1000", factor: "1000" }),
	{ ...measured("blank-entity", "5", "km"), entity: "" },
	{ ...measured("tagged-sum", "6", "km"), operation: "sum" },
	assumed("keyed-exact", "3", "km", { num: "3", den: "1", note: "from the brief" }),
]

/** JSON with every non-ASCII character as a \u escape, tab-indented like the other fixtures. */
function asciiJson(value) {
	return `${JSON.stringify(value, null, "\t").replace(/[\u0080-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)}\n`
}

async function main() {
	const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: HERE, encoding: "utf8" }).trim()
	const work = mkdtempSync(join(tmpdir(), "gen-legacy-dev-"))
	try {
		mkdirSync(join(work, "scripts"))
		for (const file of WRITER_FILES) {
			const source = execFileSync("git", ["show", `${DEV_SHA}:${SCRIPTS}/${file}`], { cwd: root, encoding: "utf8" })
			writeFileSync(join(work, "scripts", file), source)
		}
		const dev = await import(pathToFileURL(join(work, "scripts", "fact-ledger.mjs")).href)
		const ledger = dev.emptyLedger()
		for (const seed of SEEDS) dev.addRow(ledger, seed)
		const errors = dev.validateLedger(ledger)
		if (errors.length > 0) throw new Error(`dev's validateLedger rejected the generated ledger: ${errors.join("; ")}`)
		writeFileSync(OUT, asciiJson(ledger))
		process.stdout.write(`wrote ${OUT} (${ledger.rows.length} rows, dev ${DEV_SHA})\n`)
	} finally {
		rmSync(work, { recursive: true, force: true })
	}
}

await main()
