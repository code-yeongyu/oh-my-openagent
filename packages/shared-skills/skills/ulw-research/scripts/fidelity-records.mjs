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

import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs"
import { join } from "node:path"

import { CliError, readJsonFile, sha256Of, writeJsonAtomic } from "./cli-support.mjs"
import { LEDGER_FILENAME } from "./fact-ledger.mjs"
import { meaningCheckEnabled, requireLockedBrief } from "./fidelity-brief.mjs"
import { blocksDelivery, deliveryBlockReason } from "./gates-fidelity.mjs"

export const FIDELITY_RECORD = "fidelity-defects.json"
/** The legacy session meaning record: a candidate for every edition whose bytes it claims, like any edition record (newest run wins). */
export const MEANING_RECORD = "fidelity-meaning-defects.json"
/** The meaning record of one delivered edition, named by its outcome format (`fact meaning-check --edition`). */
export const meaningRecordName = (format) => `fidelity-meaning-defects.${format}.json`

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
const hashOf = (path) => (existsSync(path) ? sha256Of(readFileSync(path)) : null)

/** One record per delivered edition: the file its row names with --verified-by, bound to that edition's bytes. */
const perEdition = (sessionDir, delivered) =>
	delivered.map((row) => ({ path: row.verifiedBy ?? null, declared: row.verifiedBy !== undefined, format: row.format, at: `${row.format}: `, subjects: [subjectOf(row)].filter((subject) => subject !== null) }))

const sessionTarget = (sessionDir, file) => ({ path: join(sessionDir, file), declared: false, format: null, at: "", subjects: [] })

/** Include every existing session fidelity record, even when no delivered row attaches it. */
const perEditionAndSession = (sessionDir, delivered) => [
	...perEdition(sessionDir, delivered),
	...(existsSync(join(sessionDir, FIDELITY_RECORD)) ? [sessionTarget(sessionDir, FIDELITY_RECORD)] : []),
]

/** Edition meaning records on disk (fidelity-meaning-defects.<format>.json). */
const EDITION_MEANING = /^fidelity-meaning-defects\.[^.]+\.json$/u

/** Verdict severity for equal times: a confirmed drift, then any other blocking defect (unverified), then clean. */
const severityOf = (defects) =>
	defects.some((defect) => defect?.code === "meaning_drift_confirmed") ? 2 : defects.some((defect) => typeof defect?.code === "string" && blocksDelivery(defect)) ? 1 : 0

/**
 * What selection reads from a meaning record: the bytes it claims, when it was written, how severe it is.
 * An unreadable record matches no bytes (its own row still reads and refuses it); a record with no
 * readable written_at sorts newest, so the barrier reads it and refuses it as malformed.
 */
function claimOf(path) {
	let record
	try {
		record = readJsonFile(path)
	} catch {
		return null
	}
	const at = Date.parse(record?.written_at)
	return { path, hash: record?.artifact_sha256 ?? null, at: Number.isNaN(at) ? Infinity : at, severity: severityOf(Array.isArray(record?.defects) ? record.defects : []) }
}

/** Newest written_at first; on equal times the more severe verdict first. File names never decide. */
const newestFirst = (a, b) => (a.at === b.at ? b.severity - a.severity : b.at > a.at ? 1 : -1)

/**
 * One meaning record per delivered edition, bound to that edition's bytes. Every record whose
 * artifact_sha256 equals the edition's current bytes (a PDF counts its --rendered-from bytes) is a
 * candidate: its own fidelity-meaning-defects.<format>.json, another edition's record (a
 * byte-identical copy, or the html edition a PDF renders), and the legacy session record. The
 * newest reader run wins; on equal times the more severe verdict wins. When no record claims these
 * bytes the target is its own record (refused as for a different edition), else the legacy record,
 * else its own name, so the refusal names the file to write (meaning gate not run).
 */
function perEditionMeaning(sessionDir, delivered) {
	if (delivered.length === 0) return [sessionTarget(sessionDir, MEANING_RECORD)]
	const legacy = join(sessionDir, MEANING_RECORD)
	const editions = readdirSync(sessionDir).filter((name) => EDITION_MEANING.test(name)).map((name) => join(sessionDir, name))
	const claims = [...editions, ...(existsSync(legacy) ? [legacy] : [])].map(claimOf).filter((claim) => claim !== null)
	return perEdition(sessionDir, delivered).map((target) => {
		const own = join(sessionDir, meaningRecordName(target.format))
		const bytes = target.subjects.length > 0 ? hashOf(target.subjects[0]) : null
		const [newest] = bytes === null ? [] : claims.filter((claim) => claim.hash === bytes).sort(newestFirst)
		return { ...target, declared: false, path: newest?.path ?? (existsSync(own) ? own : existsSync(legacy) ? legacy : own) }
	})
}

/** Every fidelity record the barrier reads, in check order; each column is one rule the barrier applies. */
export const FIDELITY_RECORDS = Object.freeze([
	Object.freeze({
		kind: "fidelity",
		file: FIDELITY_RECORD,
		step: "fidelity gate",
		targets: perEditionAndSession,
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
		targets: perEditionMeaning,
		requiredWhen: meaningRequired,
		remedy: (target) => `run fact pairs and fact meaning-check --edition ${target.format} on ${target.subjects[0] ?? "the edition"} before delivery`,
		bindsTo: "artifact_sha256",
		blocking: blocksDelivery,
		payload: Object.freeze(["command", "status", "exitCode", "run_id", "pairs_sha256", "counts", "dropped", "unverified", "calibration_path", "calibration_written", "calibration_replaced", "promotion_eligibility"]),
	}),
])

// Collection warnings use the same envelope, but are not delivery-gate records.
const SOURCE_RECORDS = Object.freeze([
	Object.freeze({
		kind: "source_conversion",
		payload: Object.freeze(["conversion_altered_numbers", "lost", "raw_count", "converted_count"]),
	}),
])

const entryOf = (kind) => {
	const entry = [...FIDELITY_RECORDS, ...SOURCE_RECORDS].find((row) => row.kind === kind)
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

/** Barrier problems for `outcome verify` and `outcome finish`; empty when nothing blocks delivery. */
export function fidelityProblems(sessionDir, manifest) {
	const delivered = manifest.deliverables.filter((row) => row.status === "delivered")
	const targets = FIDELITY_RECORDS.map((entry) => [entry, entry.targets(sessionDir, delivered)])
	// Any session record a row did not name (a session fidelity record, a meaning record) is fidelity evidence.
	const hasFidelity = existsSync(join(sessionDir, LEDGER_FILENAME)) || targets.some(([, list]) => list.some((target) => !target.declared && target.path !== null && existsSync(target.path)))
	const lastFidelity = manifest.gateHistory?.findLast((entry) => entry.gate === "fidelity")
	const exempt = !hasFidelity && manifest.gates.fidelity === "not_run" && lastFidelity?.status === "not_run" && Boolean(lastFidelity.reason?.trim())
	const context = { sessionDir, hasFidelity }
	const problems = []
	const counted = new Set()
	for (const [entry, list] of targets) {
		for (const target of list) {
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
				refuse(`${entry.kind} record ${target.path} is for a different edition than ${target.subjects.join(", ")}; ${entry.remedy(target)}`)
			}
			const path = realpathSync.native(target.path)
			if (counted.has(path)) continue
			counted.add(path)
			const codes = [...new Set(record.defects.filter(entry.blocking).map((defect) => defect.code))].sort()
			if (codes.length > 0) problems.push(unresolved(target.format, codes, target.path))
		}
	}
	return problems
}
