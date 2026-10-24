// fidelity-records.mjs - the fidelity record schema and the delivery barrier of `outcome verify`
// and `outcome finish`.
//
// The table and the schema are the spec for the barrier. Every fidelity record is written through
// writeFidelityRecord, which stamps one envelope (RECORD_ENVELOPE: record_kind, artifact_sha256,
// report, written_at, defects) plus the fields its kind declares, and read through
// readFidelityRecord, which refuses a missing, unknown, or ill-typed field (fail closed).
// FIDELITY_RECORDS holds every per-record rule as a column: where the records are (targets), when a
// delivered session must carry one (requiredWhen), which envelope field binds it to the delivered
// bytes (bindsTo), and which defects block delivery (blocking). The barrier is one loop over the
// table with no record-specific branch; a new fidelity step adds a row here and nothing else.
//
// HTML/PDF/DOCX need a gate record or an explicitly logged not_run reason, even without a ledger.
// That logged exemption covers deliveries this harness never gated: once a ledger or any session
// fidelity record exists, the barrier refuses the unverified edition regardless of it, and the same
// exemption is the only way a required record may be absent.

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { CliError, readJsonFile, sha256Of, writeJsonAtomic } from "./cli-support.mjs"
import { LEDGER_FILENAME } from "./fact-ledger.mjs"
import { meaningCheckEnabled, requireLockedBrief } from "./fidelity-brief.mjs"
import { blocksDelivery, deliveryBlockReason } from "./gates-fidelity.mjs"

export const FIDELITY_RECORD = "fidelity-defects.json"
export const MEANING_RECORD = "fidelity-meaning-defects.json"

/** The fields every fidelity record carries, whatever its kind. */
export const RECORD_ENVELOPE = Object.freeze(["record_kind", "artifact_sha256", "report", "written_at", "defects"])

/** Formats that need a fidelity record even in a session with no ledger and no record. */
const GATED_FORMATS = Object.freeze(["html", "pdf", "docx"])

/** The meaning record is required unless the locked brief turns the check off; a malformed block cannot prove off. */
function meaningRequired({ sessionDir }) {
	const lock = requireLockedBrief(join(sessionDir, "brief.md"))
	return lock.exitCode === 2 || (lock.locked && meaningCheckEnabled(lock.parsed))
}

const subjectOf = (row) => row.renderedFrom ?? row.path ?? null

/** One record per delivered edition: the file its row names with --verified-by, bound to that edition's bytes. */
const perEdition = (sessionDir, delivered) =>
	delivered.map((row) => ({ path: row.verifiedBy ?? null, declared: row.verifiedBy !== undefined, format: row.format, at: `${row.format}: `, subjects: [subjectOf(row)].filter((subject) => subject !== null) }))

/** One record per session, in the session directory, bound to any delivered edition's bytes. */
const perSession = (file) => (sessionDir, delivered) => [{ path: join(sessionDir, file), declared: false, format: null, at: "", subjects: delivered.map(subjectOf).filter((subject) => subject !== null) }]

/** Every fidelity record the barrier reads, in check order; each column is one rule the barrier applies. */
export const FIDELITY_RECORDS = Object.freeze([
	Object.freeze({
		kind: "fidelity",
		file: FIDELITY_RECORD,
		step: "fidelity gate",
		targets: perEdition,
		requiredWhen: ({ hasFidelity }, target) => hasFidelity || GATED_FORMATS.includes(target.format),
		remedy: (target) => `run fact verify on ${target.subjects[0] ?? "the edition"} and set it with --verified-by`,
		bindsTo: "artifact_sha256",
		blocking: blocksDelivery,
		payload: Object.freeze(["command", "status", "exitCode", "format", "counts", "gatesRun"]),
	}),
	Object.freeze({
		kind: "meaning",
		file: MEANING_RECORD,
		step: "meaning gate",
		targets: perSession(MEANING_RECORD),
		requiredWhen: meaningRequired,
		remedy: () => "run fact pairs and fact meaning-check before delivery",
		bindsTo: "artifact_sha256",
		blocking: blocksDelivery,
		payload: Object.freeze(["command", "status", "exitCode", "run_id", "pairs_sha256", "counts", "dropped", "unverified", "calibration_path", "calibration_written", "calibration_replaced", "promotion_eligibility"]),
	}),
])

const entryOf = (kind) => {
	const entry = FIDELITY_RECORDS.find((row) => row.kind === kind)
	if (entry === undefined) throw new CliError(`unknown fidelity record kind ${kind}`)
	return entry
}

/** Why a value is not a valid record of this kind, or null. */
function envelopeProblem(record, entry) {
	if (record === null || typeof record !== "object" || Array.isArray(record)) return "not a record object"
	const missing = RECORD_ENVELOPE.filter((key) => !Object.hasOwn(record, key))
	if (missing.length > 0) return `missing ${missing.join(", ")}`
	const unknown = Object.keys(record).filter((key) => !RECORD_ENVELOPE.includes(key) && !entry.payload.includes(key))
	if (unknown.length > 0) return `unknown field(s) ${unknown.join(", ")}`
	if (record.record_kind !== entry.kind) return `record_kind ${JSON.stringify(record.record_kind)} is not ${entry.kind}`
	if (typeof record.artifact_sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(record.artifact_sha256)) return "artifact_sha256 is not a sha256 hex digest"
	if (typeof record.report !== "string" || record.report === "") return "report is not a path"
	if (typeof record.written_at !== "string" || Number.isNaN(Date.parse(record.written_at))) return "written_at is not an ISO time"
	if (!Array.isArray(record.defects) || !record.defects.every((defect) => typeof defect?.code === "string")) return "defects is not a list of coded defects"
	return null
}

/**
 * Write one fidelity record of a kind in the table: the envelope plus that kind's payload fields.
 * @param {string} path
 * @param {string} kind a FIDELITY_RECORDS kind
 * @param {{ artifact_sha256: string, report: string, defects: object[], [field: string]: unknown }} fields the envelope values plus the kind's payload
 */
export function writeFidelityRecord(path, kind, { artifact_sha256, report, defects, ...payload }, now = new Date()) {
	const entry = entryOf(kind)
	const record = { record_kind: kind, artifact_sha256, report, written_at: now.toISOString(), defects, ...payload }
	const problem = envelopeProblem(record, entry)
	if (problem !== null) throw new CliError(`refusing to write a malformed ${kind} record: ${problem}`)
	writeJsonAtomic(path, record)
	return record
}

/** Read one fidelity record of a kind; anything but a valid envelope is a CliError naming the path. */
export function readFidelityRecord(path, kind) {
	const entry = entryOf(kind)
	let record
	try {
		record = readJsonFile(path)
	} catch (error) {
		throw new CliError(`${kind} record ${path} is malformed: ${error.message}`)
	}
	const problem = envelopeProblem(record, entry)
	if (problem !== null) throw new CliError(`${kind} record ${path} is malformed: ${problem}`)
	return record
}

const unresolved = (format, codes, path) => ({ code: "fidelity_unresolved", format, codes, message: codes.map((code) => deliveryBlockReason({ code })).join("; "), path })
const hashOf = (path) => (existsSync(path) ? sha256Of(readFileSync(path)) : null)

/** Barrier problems for `outcome verify` and `outcome finish`; empty when nothing blocks delivery. */
export function fidelityProblems(sessionDir, manifest) {
	const delivered = manifest.deliverables.filter((row) => row.status === "delivered")
	const hasFidelity = existsSync(join(sessionDir, LEDGER_FILENAME)) || FIDELITY_RECORDS.some((entry) => existsSync(join(sessionDir, entry.file)))
	const lastFidelity = manifest.gateHistory?.findLast((entry) => entry.gate === "fidelity")
	const exempt = !hasFidelity && manifest.gates.fidelity === "not_run" && lastFidelity?.status === "not_run" && Boolean(lastFidelity.reason?.trim())
	const context = { sessionDir, hasFidelity }
	const problems = []
	const counted = new Set()
	for (const entry of FIDELITY_RECORDS) {
		for (const target of entry.targets(sessionDir, delivered)) {
			const refuse = (message, path = target.path) => problems.push({ code: "edition_unverified", format: target.format, message: `${target.at}${message}`, path })
			if (target.path === null || !existsSync(target.path)) {
				if (target.declared) refuse(`${entry.kind} record ${target.path} is missing`)
				else if (delivered.length > 0 && !exempt && entry.requiredWhen(context, target)) refuse(`${entry.step} not run; ${entry.remedy(target)}`, target.path ?? target.subjects[0] ?? null)
				continue
			}
			let record
			try {
				record = readFidelityRecord(target.path, entry.kind)
			} catch (error) {
				refuse(error.message)
				continue
			}
			if (target.subjects.length > 0 && !target.subjects.some((subject) => hashOf(subject) === record[entry.bindsTo])) {
				refuse(`${entry.kind} record ${target.path} is for a different edition than ${target.subjects.join(", ")}`)
			}
			if (counted.has(target.path)) continue
			counted.add(target.path)
			const codes = [...new Set(record.defects.filter(entry.blocking).map((defect) => defect.code))].sort()
			if (codes.length > 0) problems.push(unresolved(target.format, codes, target.path))
		}
	}
	return problems
}
