// fact-commands.mjs - the `fact` subcommands of report-tools: add, quote, retract, export, derive,
// fill (fact-commands-fill.mjs), verify (fact-commands-verify.mjs), pairs and meaning-check
// (fact-commands-meaning.mjs), polish-apply and polish-diff (fact-commands-polish.mjs). Every value reaches the ledger from a source
// snapshot through a deterministic locator or from a declared derivation; nothing here accepts a
// typed value. add and quote print the row with 60 chars of source context on each side (JSON
// with --json). Exit 0 ok, 1 semantic failure (fact_not_located, fill errors, a refused
// derivation), 2 usage. node: builtins and sibling imports only.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { CliError, parseArgs, sha256Of } from "./cli-support.mjs"
import { DEFECT_CODES } from "./contracts.mjs"
import { alteredIn } from "./conversion-probe.mjs"
import { derive } from "./fact-derive.mjs"
import { addRow, readLedger, retractRow, supersedeRow, writeLedger } from "./fact-ledger.mjs"
import { locateFind, locateMatch, locatePageLine, locateTable } from "./fact-locate.mjs"
import { QUALIFIER_FORMS } from "./fidelity-lexicon.mjs"
import { exportRows } from "./fidelity-values.mjs"
import { rawLocated } from "./raw-locator.mjs"
import { pointedFlag, sessionDirOf, snapshotOf } from "./source-commands.mjs"

const CONTEXT = 60
const BOOLEANS = ["json", "csv", "md", "inline", "view", "replace-failed", "disjoint"]
const QUALIFIER_OF = new Map(Object.entries(QUALIFIER_FORMS).flatMap(([term, forms]) => forms.map((form) => [form, term])))
const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "fact"

function readText(path) {
	try {
		return readFileSync(path, "utf8")
	} catch (error) {
		throw new CliError(`cannot read ${path}: ${error.code ?? error.message}`)
	}
}

/** A caller-supplied --now value as ISO; parsing only, never the clock. */
function isoOf(text) {
	const date = new Date(text)
	if (Number.isNaN(date.getTime())) throw new CliError("--now requires an ISO timestamp")
	return date.toISOString()
}

const nowIso = (flags) => (flags.now === undefined ? new Date().toISOString() : isoOf(flags.now))

function failure(command, error, detail) {
	const json = { command, status: "fail", exitCode: 1, error, ...detail }
	return { json, summary: `${command}: ${error}${detail.message ? ` (${detail.message})` : ""}`, exitCode: 1 }
}

/** Every locator reads the view text (visible text nodes for a page), never raw markup. */
function locate(flags, view, id, quote) {
	const sourceId = id
	if (quote) return locateMatch(view.text, { match: flags.match, sourceId })
	if (flags.find !== undefined) return locateFind(view.text, { find: flags.find, unitExpected: flags["unit-expected"], sourceId })
	if (flags.table !== undefined) {
		if (view.root === null) throw new CliError(`source ${id} is not an HTML page snapshot; --table needs one`)
		return locateTable(view, { table: flags.table, row: flags.row, col: flags.col, sourceId })
	}
	if (flags.page !== undefined) return locatePageLine(view.text, { page: Number(flags.page), line: Number(flags.line), sourceId })
	throw new CliError("usage: fact add --source S<n> (--find TEXT | --table T --row R --col C | --page P --line L) --label LABEL")
}

function contextOf(text, row) {
	const start = row.locator.char_start + (row.value_span?.[0] ?? 0)
	const end = row.value_span ? row.locator.char_start + row.value_span[1] : row.locator.char_end
	return { before: text.slice(Math.max(0, start - CONTEXT), start), match: text.slice(start, end), after: text.slice(end, end + CONTEXT) }
}

/** `fact add --assumed V --rationale R`: a value nobody measured, rendered ASSUMED; the rationale is required. */
function runAssumed(args) {
	const sessionDir = sessionDirOf(args.flags)
	const ledger = readLedger(sessionDir)
	const value = String(args.flags.assumed)
	const row = addRow(ledger, { kind: "assumed", value, unit: args.flags.unit ?? null, raw: value, quote: "", extracted_by: "model", observed_at: nowIso(args.flags), label: args.required("label"), rationale: args.required("rationale") })
	writeLedger(sessionDir, ledger)
	return { json: { command: "fact add", status: "pass", exitCode: 0, defects: [], data: { row } }, exitCode: 0 }
}

function runAdd(args, quote) {
	const command = quote ? "fact quote" : "fact add"
	const { flags } = args
	if (!quote && flags.assumed !== undefined) return runAssumed(args)
	const id = args.required("source")
	if (quote) args.required("match")
	const sessionDir = sessionDirOf(flags)
	const { meta, view, sha256, drift } = snapshotOf(sessionDir, id)
	const converted = view.mode === "converted"
	if (drift.length > 0) return failure(command, "snapshot_hash_mismatch", { message: `${id}: ${drift.join("; ")}` })
	if (view.mode === "legacy") return failure(command, "snapshot_not_raw", { message: `${id} is a legacy text.txt snapshot without raw.bin; snapshot the source again under a new id` })
	if (converted && !quote) return failure(command, "snapshot_not_raw", { message: `${id} is converted-only (no raw bytes); measured rows need source snapshot --raw <original> --text <extraction>` })
	const located = locate(flags, view, id, quote)
	const found = rawLocated(view, located)
	if (found.error === "unit_expected_mismatch") return failure(command, "unit_mismatch", { message: `expected ${found.expected}, found ${found.found}`, candidates: found.candidates })
	if (found.error) return failure(command, found.error, { message: `no single match in ${id}`, candidates: found.candidates })
	const altered = alteredIn(join(sessionDir, "sources", id), [found.raw, found.quote])
	if (altered.length > 0) return failure(command, "conversion_altered_number", { message: `${id}'s conversion altered ${[...new Set(altered)].join(", ")} (sources/${id}/conversion.json); the converted text cannot back this number, even where the source also shows it unaltered: write a verified text of the source and run \`source snapshot --id ${id} --text <verified.txt> --replace\`, then add the fact again`, tokens: altered, hint: DEFECT_CODES.conversion_altered_number.hint })
	const host = URL.canParse(meta.url) ? new URL(meta.url).hostname : null
	const labelSource = flags.find ?? flags.match ?? (flags.table !== undefined ? `${flags.row}_${flags.col}` : `p${flags.page}_l${flags.line}`)
	const ledger = readLedger(sessionDir)
	const row = addRow(ledger, {
		kind: quote ? "quote" : "measured",
		...(quote ? {} : { value: found.value, unit: found.unit, value_span: found.value_span, qualifier: QUALIFIER_OF.get(found.qualifier) ?? null }),
		raw: found.raw,
		quote: found.quote,
		context: found.context,
		source_id: id,
		locator: { ...found.locator, source_kind: meta.kind, url: meta.url, host, pointed: pointedFlag(sessionDir, meta.url) },
		snapshot_sha256: sha256,
		sentence_id: found.sentence_id ?? null,
		extracted_by: meta.extractor,
		observed_at: nowIso(flags),
		label: flags.label ?? slug(labelSource),
		entity: flags.entity ?? null,
		valid_at: flags["valid-at"] ?? null,
		population: flags.population ?? null,
		accounting_basis: flags["accounting-basis"] ?? null,
		observation_id: flags.observation ?? null,
		fuzzy: found.fuzzy === true,
	})
	writeLedger(sessionDir, ledger)
	const context = contextOf(view.text, located)
	const { severity, integrity } = DEFECT_CODES.quote_converted_only
	const defects = converted ? [{ code: "quote_converted_only", severity, integrity, message: `${id} is converted-only; the quote is not bound to the original fetched bytes` }] : []
	const json = { command, status: "pass", exitCode: 0, defects, data: { row, context } }
	if (flags.json) return { json, exitCode: 0 }
	const shown = quote ? row.quote : `${row.raw} (value ${row.value}${row.unit ? `, unit ${row.unit}` : ""})`
	const warnings = defects.map((defect) => `\n  warning ${defect.code}: ${defect.message}`).join("")
	return { text: `${row.fact_id} ${row.label}: ${shown} [${id} ${row.sentence_id ?? "-"}]\n  ...${context.before}[${context.match}]${context.after}...${warnings}`, exitCode: 0 }
}

function runRetract(args) {
	const [id] = args.positionals
	if (!id) throw new CliError("usage: fact retract <F<n>|Q<n>> --reason TEXT [--replacement ID]")
	const sessionDir = sessionDirOf(args.flags)
	const ledger = readLedger(sessionDir)
	const reason = args.required("reason")
	const row = args.flags.replacement === undefined ? retractRow(ledger, id, reason) : supersedeRow(ledger, id, args.flags.replacement, reason)
	writeLedger(sessionDir, ledger)
	return { json: { command: "fact retract", status: "pass", exitCode: 0, data: { fact_id: id, status: row.status, replacement: args.flags.replacement ?? null } }, exitCode: 0 }
}

const csvCell = (value) => (/[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value))

/** "N of M sources snapshotted, by extractor ...": M also counts sources-ledger ids not yet snapshotted. */
function coverageLine(sessionDir) {
	const dir = join(sessionDir, "sources")
	const snapped = existsSync(dir) ? readdirSync(dir).filter((name) => existsSync(join(dir, name, "meta.json"))) : []
	const ledgerFile = join(sessionDir, "sources-ledger.md")
	const listed = existsSync(ledgerFile) ? [...readText(ledgerFile).matchAll(/^\[S(\d+)\]/gm)].map((match) => `S${match[1]}`) : []
	const byExtractor = {}
	for (const id of snapped) {
		const extractor = JSON.parse(readText(join(dir, id, "meta.json"))).extractor
		byExtractor[extractor] = (byExtractor[extractor] ?? 0) + 1
	}
	const total = new Set([...snapped, ...listed]).size
	const parts = Object.entries(byExtractor).map(([name, count]) => `${name} ${count}`)
	return `${snapped.length} of ${total} sources snapshotted, by extractor: ${parts.join(", ") || "none"}`
}

function runExport(args) {
	const sessionDir = sessionDirOf(args.flags)
	const ledger = readLedger(sessionDir)
	const coverage = coverageLine(sessionDir)
	let text
	if (args.flags.csv) {
		const rows = exportRows(ledger)
		text = `${["fact_id,label,plot_value,unit", ...rows.map((row) => [row.fact_id, row.label, row.plot_value, row.unit].map(csvCell).join(","))].join("\n")}\n`
	} else text = `${JSON.stringify({ schemaVersion: ledger.schemaVersion, rows: ledger.rows, coverage }, null, 2)}\n`
	if (args.flags.out === undefined) return { text, summary: coverage, exitCode: 0 }
	writeFileSync(args.flags.out, text)
	return { json: { command: "fact export", status: "pass", exitCode: 0, data: { out: resolve(args.flags.out), format: args.flags.csv ? "csv" : "json", sha256: sha256Of(text), coverage } }, summary: coverage, exitCode: 0 }
}

function runDerive(args) {
	const { flags } = args
	const op = args.required("op")
	// Time is the caller's: without --now the CLI refuses with the library's missing_now code (exit 2) and never reads the clock.
	if (flags.now === undefined) throw new CliError("missing_now: fact derive needs --now <ISO timestamp> (the row's observed_at); no row written")
	const sessionDir = sessionDirOf(flags)
	const ledger = readLedger(sessionDir)
	// The registry refuses any field outside the operation's inputFields, so only the given flags go in; --unit null declares a dimensionless result.
	const picked = ["to", "from", "num", "den", "part", "whole", "reference", "rationale", "label"].filter((key) => flags[key] !== undefined)
	const spec = { op, now: isoOf(flags.now), ...Object.fromEntries(picked.map((key) => [key, flags[key]])) }
	if (op === "expr") spec.formula = args.positionals[0]
	else if (args.positionals.length > 0) spec.operands = args.positionals
	if (flags.disjoint === true) spec.disjoint = true
	if (flags.unit !== undefined) spec.unit = flags.unit === "null" ? null : flags.unit
	const result = derive(ledger, spec)
	if (result.error) return failure("fact derive", result.error, { message: result.detail, ...(result.hint ? { hint: result.hint } : {}) })
	writeLedger(sessionDir, ledger)
	const { row } = result
	const json = { command: "fact derive", status: "pass", exitCode: 0, defects: [], data: { row, compatibility: result.compatibility } }
	return flags.json ? { json, exitCode: 0 } : { text: `${row.fact_id} ${row.label}: ${row.render} (${row.operation} of ${row.operands.join(", ")}, ${result.compatibility})`, exitCode: 0 }
}

export async function runFact(argv) {
	const [sub, ...rest] = argv
	if (sub === "pairs" || sub === "meaning-check") return (await import("./fact-commands-meaning.mjs")).runFactMeaning(sub, rest)
	if (sub === "polish-apply" || sub === "polish-diff") return (await import("./fact-commands-polish.mjs")).runFactPolish(sub, rest)
	const args = parseArgs(rest, { booleans: BOOLEANS })
	switch (sub) {
		case "add":
			return runAdd(args, false)
		case "quote":
			return runAdd(args, true)
		case "retract":
			return runRetract(args)
		case "export":
			return runExport(args)
		case "fill":
			return (await import("./fact-commands-fill.mjs")).runFactFill(args)
		case "derive":
			return runDerive(args)
		case "verify":
			return (await import("./fact-commands-verify.mjs")).runFactVerify(args)
		default:
			throw new CliError("usage: fact <add|quote|retract|export|fill|verify|derive|pairs|meaning-check|polish-apply|polish-diff> ...")
	}
}
