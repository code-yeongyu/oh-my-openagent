// fact-commands-polish.mjs - `fact polish-apply` and `fact polish-diff`, the script half of the
// proofread gate, plus the --changed-since filter of `fact pairs`.
//
// The writing lane returns polish-edits.json ([{before, after, reason}]) and never edits the
// report. polish-apply applies each edit through polish-apply.mjs and writes the result; a
// rejected (major) or unlocated (minor) edit leaves its region unchanged and is listed with its
// index and reason so the orchestrator can re-send it; every rejection reason is printed verbatim, one
// line per rejected edit (index and the first 60 characters of its before), in the summary and in
// data.rejected_reasons. It exits 0 whenever it wrote the output; json.applied is false when
// any edit was rejected or unlocated, independently of data.applied's accepted-edit count.
// polish-apply never rewrites a fill map: it checks that the edition's map (fillMapOf) records the
// input's bytes, refusing otherwise, and writes `<out>.polished.fill-map.json` beside the output
// (artifact = the polished file, its hash, and polishedFrom = the fill map's path and sha256).
// polish-diff is the whole-document backstop (polish-diff.mjs) between the pre-polish artifact
// and any later copy; it exits 1 on a blocker. pairsChangedSince always reads the pre-polish fill
// map (following a polished map's polishedFrom) and keeps only the pairs whose sentence text
// (normalized) is not in the artifact it names, so the meaning readers re-check exactly what
// changed; when that artifact no longer hashes to the map (polished in place, or edited) nothing
// can be ruled out and every pair is kept. No model, no network.

import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { CliError, parseArgs, readJsonFile, sha256Of, writeJsonAtomic, writeTextAtomic } from "./cli-support.mjs"
import { countDefects, DEFECT_CODES } from "./contracts.mjs"
import { editionFormatOf, fillMapOf, ledgerFrom, markdownAsHtml, sessionOf } from "./fact-commands-verify.mjs"
import { extractPairs } from "./fact-pairs.mjs"
import { lockedBrief } from "./fidelity-policy.mjs"
import { applyEdits, POLISH_EDIT_FIELDS, validatePolishEdits } from "./polish-apply.mjs"
import { diffPolish } from "./polish-diff.mjs"
import { normalizeText } from "./text-normalize.mjs"

export { ledgerFrom, POLISH_EDIT_FIELDS, validatePolishEdits }

export const POLISH_RECORD = "polish-defects.json"

/**
 * The polish-diff exit policy: only a registry blocker fails the command; majors are reported.
 * Fail-closed like the delivery barrier: a code the registry does not know refuses outright,
 * because a caller-claimed severity may not demote it.
 */
export const polishDiffFails = (defects) =>
	defects.some((defect) => {
		if (!Object.hasOwn(DEFECT_CODES, defect?.code)) throw new CliError(`unknown defect code ${defect?.code}`)
		return DEFECT_CODES[defect.code].severity === "blocker"
	})

function readText(path) {
	try {
		return readFileSync(path, "utf8")
	} catch (error) {
		throw new CliError(`cannot read ${path}: ${error.code ?? error.message}`)
	}
}

const withSeverity = (entry) => ({ ...entry, severity: DEFECT_CODES[entry.code].severity, hint: DEFECT_CODES[entry.code].hint })

/** The first 60 characters of an edit's before, on one line. */
const beforePreview = (before) => (typeof before === "string" ? before : "").replace(/\s+/gu, " ").slice(0, 60)

/** One line per rejected edit: its index, the start of its before, and its reason verbatim. */
const rejectionLine = (entry, edit) => `  rejected edit ${entry.index} ("${beforePreview(edit?.before)}"): ${entry.reason}`

function runPolishApply(args) {
	const [report] = args.positionals
	const { flags } = args
	if (!report || flags.edits === undefined || flags.out === undefined) throw new CliError("usage: fact polish-apply <report.html> --edits polish-edits.json --out <report.polished.html> [--fill-map F] [--ledger F] [--brief brief.md] [--session-dir D]")
	if (editionFormatOf(report, flags.format) === "md") throw new CliError("fact polish-apply takes the filled HTML edition; polish a Markdown edition through its HTML source")
	const { refusal } = lockedBrief("fact polish-apply", flags)
	if (refusal) return refusal
	const html = readText(report)
	const editsText = readText(flags.edits)
	const edits = readJsonFile(flags.edits)
	try {
		validatePolishEdits(edits)
	} catch (error) {
		throw new CliError(`${flags.edits} must be an array of {${Object.keys(POLISH_EDIT_FIELDS).join(", ")}} objects: ${error.message}`)
	}
	const result = applyEdits(html, edits, ledgerFrom(flags))
	const mapPath = fillMapOf(report, html, flags["fill-map"])
	const map = mapPath === null ? null : readJsonFile(mapPath)
	if (map !== null && map.artifact_sha256 !== sha256Of(html)) throw new CliError(`${mapPath} does not record the bytes of ${report} (artifact_sha256 differs); refusing to carry its brief binding to the polished edition`)
	const polishedFrom = map?.polishedFrom ?? (map && { map: resolve(mapPath), sha256: sha256Of(readText(mapPath)) })
	writeTextAtomic(flags.out, result.out)
	if (map) writeJsonAtomic(`${resolve(flags.out)}.polished.fill-map.json`, { ...map, artifact: resolve(flags.out), artifact_sha256: sha256Of(result.out), polishedFrom })
	const defects = [...result.rejected, ...result.unlocated].sort((a, b) => a.index - b.index).map(withSeverity)
	const counts = { applied: result.applied.length, rejected: result.rejected.length, unlocated: result.unlocated.length }
	const data = { out: resolve(flags.out), ...counts, applied_indexes: result.applied, input_sha256: sha256Of(html), edits_sha256: sha256Of(editsText), out_sha256: sha256Of(result.out) }
	const rejected_reasons = result.rejected.map((entry) => rejectionLine(entry, edits[entry.index]))
	const summary = [`fact polish-apply: ${counts.applied} applied, ${counts.rejected} rejected, ${counts.unlocated} unlocated of ${edits.length} edit(s)`, ...rejected_reasons].join("\n")
	return { json: { command: "fact polish-apply", status: "pass", exitCode: 0, applied: counts.rejected === 0 && counts.unlocated === 0, defects, data: { ...data, rejected_reasons } }, summary, exitCode: 0 }
}

function runPolishDiff(args) {
	const { flags } = args
	if (flags.before === undefined || flags.after === undefined) throw new CliError("usage: fact polish-diff --before <pre-polish.html> --after <polished.html> [--ledger F] [--out polish-defects.json] [--brief brief.md] [--session-dir D]")
	const { refusal } = lockedBrief("fact polish-diff", flags)
	if (refusal) return refusal
	const after = readText(flags.after)
	const defects = diffPolish(readText(flags.before), after, ledgerFrom(flags)).map((defect) => ({ ...defect, hint: DEFECT_CODES[defect.code]?.hint ?? null }))
	const counts = countDefects(defects)
	const status = polishDiffFails(defects) ? "fail" : "pass"
	const exitCode = status === "fail" ? 1 : 0
	const record = { command: "fact polish-diff", status, exitCode, before: resolve(flags.before), artifact: resolve(flags.after), artifact_sha256: sha256Of(after), defects, counts }
	const session = sessionOf(flags)
	const out = flags.out ?? (session === null ? null : join(session, POLISH_RECORD))
	if (out !== null) writeJsonAtomic(resolve(out), record)
	const summary = `fact polish-diff: ${status.toUpperCase()} - ${counts.blocker} blocker, ${counts.major} major, ${counts.minor} minor`
	return { json: { ...record, out: out === null ? null : resolve(out) }, summary, exitCode }
}

const pairKey = (pair) => [pair.kind, pair.sentence_key, pair.claim_id ?? "", normalizeText(pair.sentence)].join("\u0000")

/** The pre-polish fill map behind --changed-since: a polished map leads to it through polishedFrom, whose sha256 it must still match. */
function prePolishMap(mapPath) {
	const given = readJsonFile(mapPath)
	if (given.polishedFrom === undefined) return { path: resolve(mapPath), map: given }
	const { map: path, sha256 } = given.polishedFrom
	if (typeof path !== "string" || sha256Of(readText(path)) !== sha256) throw new CliError(`${path} changed after polish wrote ${mapPath}; --changed-since needs the pre-polish fill map it names`)
	return { path, map: readJsonFile(path) }
}

/**
 * The pairs whose sentence text changed since the pre-polish artifact the fill map names: a pair is
 * kept unless the same (kind, sentence key, normalized sentence) occurs in that artifact. Only bytes
 * that still hash to the map's `artifact_sha256` narrow the set; otherwise (the report was polished
 * in place, or edited) every pair is kept, so nothing changed escapes the meaning re-check.
 * @param {object[]} pairs extractPairs output on the polished edition
 * @param {string} mapPath fact fill's `<out>.fill-map.json`, or polish-apply's `<out>.polished.fill-map.json`
 * @returns {{ pairs: object[], fill_map: string, narrowed: boolean }}
 */
export function pairsChangedSince(pairs, mapPath, ledger, claims) {
	const { path, map } = prePolishMap(mapPath)
	if (typeof map.artifact !== "string") throw new CliError(`${path} names no pre-polish artifact`)
	if (typeof map.artifact_sha256 !== "string") throw new CliError(`${path} fill map has no artifact_sha256; --changed-since needs the pre-polish hash`)
	const text = existsSync(map.artifact) ? readText(map.artifact) : null
	if (text === null || sha256Of(text) !== map.artifact_sha256) return { pairs, fill_map: path, narrowed: false }
	const html = map.format === "md" ? markdownAsHtml(text, map.entries, ledger).html : text
	const before = new Map()
	for (const pair of extractPairs(html, ledger, claims)) before.set(pairKey(pair), (before.get(pairKey(pair)) ?? 0) + 1)
	const kept = pairs.filter((pair) => {
		const left = before.get(pairKey(pair)) ?? 0
		if (left === 0) return true
		before.set(pairKey(pair), left - 1)
		return false
	})
	return { pairs: kept, fill_map: path, narrowed: true }
}

/** @param {string[]} argv the arguments after `fact polish-apply` or `fact polish-diff` */
export function runFactPolish(sub, argv) {
	const args = parseArgs(argv)
	return sub === "polish-apply" ? runPolishApply(args) : runPolishDiff(args)
}
