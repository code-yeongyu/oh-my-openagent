// fact-commands-meaning.mjs - `fact pairs` and `fact meaning-check`, the script half of the
// separate-session meaning verifier. fact pairs writes the (source, report sentence) pairs a
// reader lane gets and nothing else (with --changed-since, only the pairs whose sentence polish
// rewrote); it honours the brief's `meaning check` field and writes
// `{ skipped: true }` when it is off. fact meaning-check ingests the readers' verdict files
// (meaning-check.mjs), writes fidelity-meaning-defects.json (a fidelity record bound to the pairs'
// artifact_sha256 and report, through writeFidelityRecord), and records the run in
// fidelity-calibration.jsonl: a header with the promotion criterion on first write, then per run
// one run line plus one line per flagged pair. The run id hashes the inputs only, so a rerun or a
// --dispute rerun of the same inputs replaces that run's lines in place (disputes carry forward)
// instead of counting a second run. Both refuse an unlocked brief (fidelity_interview_incomplete) before
// reading anything else. Neither command calls a model or the network.

import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import { CliError, parseArgs, readJsonFile, sha256Of, writeJsonAtomic, writeTextAtomic } from "./cli-support.mjs"
import { countDefects } from "./contracts.mjs"
import { ledgerFrom, markdownAsHtml, readEdition, sessionOf } from "./fact-commands-verify.mjs"
import { pairsChangedSince } from "./fact-commands-polish.mjs"
import { extractPairs, PAIR_KINDS } from "./fact-pairs.mjs"
import { FIDELITY_INCOMPLETE } from "./fidelity-brief.mjs"
import { briefPathOf, lockedBrief, meaningCheckEnabled } from "./fidelity-policy.mjs"
import { MEANING_RECORD, writeFidelityRecord } from "./fidelity-records.mjs"
import { blocksDelivery } from "./gates-fidelity.mjs"
import { ingestVerdicts, unverifiedDefects, VERDICT_SCHEMA } from "./meaning-check.mjs"

export const PAIRS_FILE = "pairs.json"
export const CALIBRATION_FILE = "fidelity-calibration.jsonl"
/** Starting values, recorded in the calibration log header; changed only with evidence. */
export const PROMOTION = Object.freeze({ code: "meaning_drift_confirmed", to: "integrity", min_runs: 20, max_disputed_to_confirmed: 0.1, false_block_window: 20, max_report_false_blocks_in_window: 2 })

/** The command status: fail when any defect blocks delivery under the registry policy. */
export const meaningStatus = (defects) => (defects.some(blocksDelivery) ? "fail" : "pass")

const inSession = (session, name, flag) => {
	if (session === null) throw new CliError(`${flag} is required without --session-dir (or SESSION_DIR)`)
	return join(session, name)
}

function runPairs(args) {
	const [report] = args.positionals
	const { flags } = args
	if (!report) throw new CliError("usage: fact pairs <report> [--format html|md] [--ledger F] [--claims claims.json] [--changed-since <fill-map.json>] [--brief brief.md] [--out pairs.json]")
	const session = sessionOf(flags)
	const out = resolve(flags.out ?? inSession(session, PAIRS_FILE, "--out"))
	const { parsed, refusal } = lockedBrief("fact pairs", flags)
	if (refusal) return refusal
	if (!meaningCheckEnabled(parsed)) {
		const record = { schemaVersion: 1, skipped: true, reason: "meaning check: off", pairs: [] }
		writeJsonAtomic(out, record)
		return { json: { command: "fact pairs", status: "skipped", exitCode: 0, data: { out, ...record } }, summary: "fact pairs: skipped (meaning check: off)", exitCode: 0 }
	}
	const edition = readEdition(report, flags)
	const claimsPath = flags.claims ?? (session === null ? null : join(session, "claims.json"))
	const claims = claimsPath !== null && (flags.claims !== undefined || existsSync(claimsPath)) ? readJsonFile(claimsPath) : null
	const ledger = ledgerFrom(flags, session)
	const html = edition.format === "md" ? markdownAsHtml(edition.text, edition.entries, ledger).html : edition.text
	const all = extractPairs(html, ledger, claims)
	const pairs = flags["changed-since"] === undefined ? all : pairsChangedSince(all, flags["changed-since"], ledger, claims)
	const counts = { total: pairs.length, force_strong: pairs.filter((pair) => pair.force_strong).length }
	for (const kind of PAIR_KINDS) counts[kind] = pairs.filter((pair) => pair.kind === kind).length
	const record = { schemaVersion: 1, skipped: false, report: resolve(report), format: edition.format, artifact_sha256: sha256Of(edition.text), pairs_sha256: sha256Of(JSON.stringify(pairs)), counts, verdict_schema: VERDICT_SCHEMA, pairs }
	writeJsonAtomic(out, record)
	const summary = `fact pairs: ${counts.total} pair(s), ${counts.force_strong} routed to the strong reader`
	return { json: { command: "fact pairs", status: "pass", exitCode: 0, data: { out, ...record, pairs: undefined } }, summary, exitCode: 0 }
}

/** Every line of the log after the header, in file order; a corrupt line is a usage error naming path:line. */
function calibrationRows(path) {
	if (!existsSync(path)) return []
	const rows = []
	for (const [index, line] of readFileSync(path, "utf8").split("\n").entries()) {
		if (line.trim() === "") continue
		try {
			rows.push(JSON.parse(line))
		} catch (error) {
			throw new CliError(`${path}:${index + 1}: corrupt calibration log line (${error.message}); repair or move the file`)
		}
	}
	return rows.filter((row) => row.header !== true)
}

/** The promotion criterion evaluated over the log: runs, disputed-to-confirmed, report-level false blocks. */
export function promotionEligibility(rows) {
	const runs = [...new Set(rows.map((row) => row.run_id))]
	const confirmed = rows.filter((row) => row.run !== true && row.confirmed)
	const disputed = confirmed.filter((row) => row.disputed).length
	const ratio = confirmed.length === 0 ? null : disputed / confirmed.length
	const falseBlocks = runs.slice(-PROMOTION.false_block_window).filter((run) => {
		const blocking = confirmed.filter((row) => row.run_id === run)
		return blocking.length > 0 && blocking.every((row) => row.disputed)
	}).length
	const eligible = runs.length >= PROMOTION.min_runs && ratio !== null && ratio < PROMOTION.max_disputed_to_confirmed && falseBlocks <= PROMOTION.max_report_false_blocks_in_window
	return { runs: runs.length, confirmed: confirmed.length, disputed_confirmed: disputed, disputed_to_confirmed: ratio, report_false_blocks_in_window: falseBlocks, eligible }
}

/**
 * Writes this run's lines: one run line (so a run with no flagged pair still counts) and one line per
 * flagged pair. A run id already in the log is replaced in place, keeping its position in the false
 * block window and any earlier dispute on a pair the new lines do not dispute.
 */
function recordCalibration(path, lines, runId, pairsSha) {
	const before = calibrationRows(path)
	const previous = before.filter((row) => row.run_id === runId)
	const disputes = new Map(previous.filter((row) => row.disputed).map((row) => [row.pair_id, row.reason]))
	const pairRows = lines.map((line) => {
		const row = { ...JSON.parse(line), run_id: runId, pairs_sha256: pairsSha }
		return !row.disputed && disputes.has(row.pair_id) ? { ...row, disputed: true, reason: disputes.get(row.pair_id) } : row
	})
	const rows = [{ run: true, run_id: runId, pairs_sha256: pairsSha, flagged: pairRows.length }, ...pairRows]
	const at = previous.length === 0 ? before.length : before.indexOf(previous[0])
	const after = [...before.slice(0, at).filter((row) => row.run_id !== runId), ...rows, ...before.slice(at).filter((row) => row.run_id !== runId)]
	const header = { header: true, schemaVersion: 1, promotion: PROMOTION, note: "starting values; change them only with evidence" }
	writeTextAtomic(path, `${[header, ...after].map((row) => JSON.stringify(row)).join("\n")}\n`)
	return { written: pairRows.length, replaced: previous.length > 0, rows: after }
}

/** A `{ skipped: true }` pairs file is accepted only when the locked brief turns the meaning check off. */
function skippedRefusal(flags, parsed) {
	if (meaningCheckEnabled(parsed)) return { error: "meaning_check_required", message: `${flags.pairs} says skipped but ${briefPathOf(flags)} has meaning check on; rerun fact pairs` }
	return null
}

function runMeaningCheck(args) {
	const { flags } = args
	const usage = "usage: fact meaning-check --pairs pairs.json --verdicts cheap.json [--verdicts strong.json] [--dispute P<n> --reason TEXT] [--run-id ID] [--calibration F] [--brief brief.md] [--out F]"
	if (flags.pairs === undefined || !Array.isArray(flags.verdicts)) throw new CliError(usage)
	const session = sessionOf(flags)
	const { parsed, refusal } = lockedBrief("fact meaning-check", flags)
	if (refusal) return { ...refusal, json: { ...refusal.json, error: FIDELITY_INCOMPLETE } }
	const pairsText = readFileSync(flags.pairs, "utf8")
	const pairsDoc = readJsonFile(flags.pairs)
	if (pairsDoc?.skipped === true) {
		const skipped = skippedRefusal(flags, parsed)
		if (skipped !== null) return { json: { command: "fact meaning-check", status: "fail", exitCode: 1, ...skipped }, summary: `fact meaning-check: ${skipped.message}`, exitCode: 1 }
		return { json: { command: "fact meaning-check", status: "skipped", exitCode: 0, defects: [] }, summary: JSON.stringify({ command: "fact meaning-check", status: "skipped" }), exitCode: 0 }
	}
	if (typeof pairsDoc?.artifact_sha256 !== "string" || typeof pairsDoc.report !== "string") throw new CliError(`${flags.pairs} names no artifact_sha256 and report, so the meaning record cannot be bound to an edition; rerun fact pairs`)
	for (const file of flags.verdicts) readJsonFile(file)
	const verdictTexts = flags.verdicts.map((file) => readFileSync(file, "utf8"))
	const dispute = flags.dispute === undefined ? undefined : { pair_id: flags.dispute, reason: args.required("reason") }
	let result
	try {
		result = ingestVerdicts(pairsDoc, flags.verdicts, dispute ? { dispute } : {})
	} catch (error) {
		throw new CliError(`invalid verdict input: ${error.message}`)
	}
	const out = resolve(flags.out ?? inSession(session, MEANING_RECORD, "--out"))
	const calibration = resolve(flags.calibration ?? join(session ?? dirname(out), CALIBRATION_FILE))
	const runId = flags["run-id"] ?? sha256Of([pairsText, ...verdictTexts].join("\0")).slice(0, 16)
	const pairsSha = pairsDoc.pairs_sha256 ?? sha256Of(pairsText)
	const log = recordCalibration(calibration, result.calibrationLines, runId, pairsSha)
	const defects = [...result.defects, ...unverifiedDefects(result.unverified)]
	const counts = countDefects(defects)
	const status = meaningStatus(defects)
	const exitCode = status === "fail" ? 1 : 0
	const record = writeFidelityRecord(out, "meaning", { command: "fact meaning-check", status, exitCode, artifact_sha256: pairsDoc.artifact_sha256, report: pairsDoc.report, run_id: runId, pairs_sha256: pairsSha, defects, counts, dropped: result.dropped, unverified: result.unverified, calibration_path: calibration, calibration_written: log.written, calibration_replaced: log.replaced, promotion_eligibility: promotionEligibility(log.rows) })
	const confirmed = result.defects.filter((defect) => defect.code === "meaning_drift_confirmed").length
	const summary = JSON.stringify({ command: "fact meaning-check", status, defects: defects.length, confirmed, warn: result.defects.length - confirmed, dropped: result.dropped.length, unverified: result.unverified.length })
	return { json: { ...record, out }, summary, exitCode }
}

/** @param {string[]} argv the arguments after `fact pairs` or `fact meaning-check` */
export function runFactMeaning(sub, argv) {
	const args = parseArgs(argv, { repeatable: ["verdicts"] })
	return sub === "pairs" ? runPairs(args) : runMeaningCheck(args)
}
