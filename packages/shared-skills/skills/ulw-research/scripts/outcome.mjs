// outcome.mjs - the per-run outcome manifest (`outcome.json`) and the closing briefing.
// Manifest functions are pure (they return a new manifest); the briefing reads only the
// manifest, the sources-ledger text, and an injected `now`. node: builtins only.

import * as nodeFs from "node:fs"
import { basename, dirname, join } from "node:path"

import { DELIVERABLE_FORMATS, DELIVERABLE_STATUSES, GATE_NAMES, GATE_STATUSES, LANES } from "./contracts.mjs"
import { MANIFEST_CODES, SCHEMA_VERSION, validateOutcomeManifest } from "./contracts.mjs"

export const MANIFEST_FILENAME = "outcome.json"
const MISSING = MANIFEST_CODES[0]
const SESSION_STAMP = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/
const SOURCE_LINE = /^\[(S|Source )\d+\]/
const URL_PATTERN = /https?:\/\/[^\s)<>\]"'`]+/g
const DRAFT_MARKER = "STATUS: draft"
const DRAFT_SCAN_LINES = 5
const REASON_REQUIRED = new Set(["blocked_capability", "skipped", "failed"])

export class OutcomeError extends Error {
	/** @param {string} code @param {string} message @param {readonly string[]} [allowed] */
	constructor(code, message, allowed) {
		super(message)
		this.name = "OutcomeError"
		this.code = code
		if (allowed) this.allowed = [...allowed]
	}
}

function assertOneOf(code, label, value, allowed) {
	if (!allowed.includes(value)) {
		throw new OutcomeError(code, `unknown ${label} ${JSON.stringify(value)}; allowed: ${allowed.join(", ")}`, allowed)
	}
}

const clone = (manifest) => structuredClone(manifest)
const isMissing = (error) => error?.code === "ENOENT" || error?.code === "ENOTDIR"

function stamp(now) {
	return (now ?? new Date()).toISOString()
}

/** Local wall-clock start time from a `YYYYMMDD-HHMMSS` session dir basename. */
export function parseSessionStart(sessionDir) {
	const match = SESSION_STAMP.exec(basename(sessionDir))
	if (!match) throw new OutcomeError("invalid_session_dir", `session dir basename must be YYYYMMDD-HHMMSS: ${sessionDir}`)
	const [y, mo, d, h, mi, s] = match.slice(1).map(Number)
	const date = new Date(y, mo - 1, d, h, mi, s)
	if (date.getMonth() !== mo - 1 || date.getDate() !== d || date.getHours() !== h) {
		throw new OutcomeError("invalid_session_dir", `session dir basename is not a real local time: ${sessionDir}`)
	}
	return date
}

/** @param {{ sessionDir: string, promised: string[], lane: string|null, interview?: object|null, now?: Date }} input */
export function initManifest({ sessionDir, promised, lane, interview = null, now }) {
	const startedAt = parseSessionStart(sessionDir).toISOString()
	if (lane !== null && lane !== undefined) assertOneOf("unknown_lane", "lane", lane, LANES)
	const formats = [...new Set(promised)]
	for (const format of formats) assertOneOf("unknown_format", "deliverable format", format, DELIVERABLE_FORMATS)
	const updatedAt = stamp(now)
	return {
		schemaVersion: SCHEMA_VERSION,
		sessionDir,
		startedAt,
		finishedAt: null,
		elapsedMinutes: null,
		lane: lane ?? null,
		interview,
		deliverables: formats.map((format) => ({ format, status: "pending", promised: true, updatedAt })),
		renders: [],
		gates: Object.fromEntries(GATE_NAMES.map((gate) => [gate, "not_run"])),
		residualDefects: [],
		repair: null,
		sources: null,
	}
}

/**
 * Set one format's row; every other row is kept as is. An unpromised format gets a new
 * row with promised=false. The row's detail fields are replaced by the ones given.
 * @param {{ path?: string, reason?: string, pages?: number, bytes?: number, now?: Date }} [detail]
 */
export function setDeliverable(manifest, format, status, detail = {}) {
	assertOneOf("unknown_format", "deliverable format", format, DELIVERABLE_FORMATS)
	assertOneOf("unknown_status", "deliverable status", status, DELIVERABLE_STATUSES)
	const next = clone(manifest)
	const index = next.deliverables.findIndex((row) => row.format === format)
	const row = { format, status, promised: index >= 0 ? next.deliverables[index].promised : false, updatedAt: stamp(detail.now) }
	for (const key of ["path", "reason", "pages", "bytes"]) {
		if (detail[key] !== undefined) row[key] = detail[key]
	}
	if (index >= 0) next.deliverables[index] = row
	else next.deliverables.push(row)
	return next
}

export function setGate(manifest, gate, status) {
	assertOneOf("unknown_gate", "gate", gate, GATE_NAMES)
	assertOneOf("unknown_gate_status", "gate status", status, GATE_STATUSES)
	const next = clone(manifest)
	next.gates[gate] = status
	return next
}

export function addRender(manifest, path, page) {
	if (typeof path !== "string" || path.length === 0) throw new OutcomeError("invalid_render", "render path must be a non-empty string")
	if (!Number.isInteger(page) || page < 1) throw new OutcomeError("invalid_render", `render page must be an integer >= 1, got ${page}`)
	const next = clone(manifest)
	if (!next.renders.some((render) => render.path === path && render.page === page)) next.renders.push({ path, page })
	return next
}

function fileSize(fs, path) {
	try {
		const stat = fs.statSync(path)
		return stat.isFile() ? stat.size : null
	} catch (error) {
		if (isMissing(error)) return null
		throw error
	}
}

/**
 * @param {object} manifest
 * @param {{ statSync: typeof nodeFs.statSync }} [fs]
 * @returns {{ ok: boolean, problems: { code: string, format: string, message: string, path?: string }[] }}
 */
export function verifyManifest(manifest, fs = nodeFs) {
	const problems = []
	for (const row of manifest.deliverables) {
		const problem = (message, path) => problems.push({ code: MISSING, format: row.format, message, ...(path ? { path } : {}) })
		if (row.status === "pending") problem(`${row.format} is still pending`)
		else if (row.status === "delivered") {
			if (!row.path) problem(`${row.format} is delivered without a path`)
			else {
				const size = fileSize(fs, row.path)
				if (size === null) problem(`${row.format} delivered file is missing: ${row.path}`, row.path)
				else if (size === 0) problem(`${row.format} delivered file is empty: ${row.path}`, row.path)
			}
		} else if (REASON_REQUIRED.has(row.status) && !row.reason) problem(`${row.format} is ${row.status} without a reason`)
	}
	return { ok: problems.length === 0, problems }
}

/**
 * none = missing or empty file; partial = `STATUS: draft` in the first 5 lines, or the
 * manifest (given, else a sibling outcome.json) still has a pending row; else complete.
 * @returns {"none"|"partial"|"complete"}
 */
export function deliverableState(deliverablePath, manifestOrNull) {
	let text
	try {
		text = nodeFs.readFileSync(deliverablePath, "utf8")
	} catch (error) {
		if (isMissing(error)) return "none"
		throw error
	}
	if (text.trim() === "") return "none"
	if (text.split(/\r?\n/, DRAFT_SCAN_LINES).some((line) => line.includes(DRAFT_MARKER))) return "partial"
	const sibling = join(dirname(deliverablePath), MANIFEST_FILENAME)
	const manifest = manifestOrNull ?? (nodeFs.existsSync(sibling) ? readManifest(sibling) : null)
	if (manifest && manifest.deliverables.some((row) => row.status === "pending")) return "partial"
	return "complete"
}

/** Hostname without a leading `www.`; null for a string URL cannot parse (not a source host). */
function hostOf(url) {
	return URL.canParse(url) ? new URL(url).hostname.toLowerCase().replace(/^www\./, "") : null
}

function repairSummary(repair) {
	if (!repair) return null
	const attempts = Array.isArray(repair.attempts) ? repair.attempts.length : repair.attempts ?? null
	return { attempts, action: repair.decision?.action ?? repair.action ?? null, reason: repair.decision?.reason ?? repair.reason ?? null }
}

/** The briefing numbers, from the manifest + ledger text + injected `now` only. */
export function briefingFacts(manifest, sourcesLedgerText, now) {
	const sourceLines = String(sourcesLedgerText ?? "").split(/\r?\n/).filter((line) => SOURCE_LINE.test(line))
	const hosts = new Set()
	for (const line of sourceLines) {
		for (const url of line.match(URL_PATTERN) ?? []) {
			const host = hostOf(url)
			if (host) hosts.add(host)
		}
	}
	const elapsedMs = now.getTime() - new Date(manifest.startedAt).getTime()
	return {
		sources: sourceLines.length,
		domains: hosts.size,
		hosts: [...hosts].sort(),
		minutes: Math.max(0, Math.round(elapsedMs / 60000)),
		deliverables: manifest.deliverables.map((row) => ({ format: row.format, status: row.status, reason: row.reason ?? null, path: row.path ?? null })),
		gates: { ...manifest.gates },
		residualDefects: manifest.residualDefects.length,
		repair: repairSummary(manifest.repair),
	}
}

/** The closing briefing block as plain text. */
export function buildBriefing(manifest, sourcesLedgerText, now) {
	const facts = briefingFacts(manifest, sourcesLedgerText, now)
	const repair = facts.repair
		? `${facts.repair.attempts ?? "?"} attempt(s), last decision ${facts.repair.action ?? "?"} (${facts.repair.reason ?? "?"})`
		: "not run"
	return [
		"Closing briefing",
		`- Sources: ${facts.sources} from ${facts.domains} distinct domain(s), counted from the sources ledger.`,
		`- Elapsed: ${facts.minutes} minute(s) since ${manifest.startedAt}.`,
		"- Deliverables:",
		"  | format | status | detail |",
		"  |---|---|---|",
		...facts.deliverables.map((row) => `  | ${row.format} | ${row.status} | ${row.reason ?? row.path ?? ""} |`),
		`- Gates: ${GATE_NAMES.map((gate) => `${gate} ${facts.gates[gate]}`).join(", ")}.`,
		`- Residual defects: ${facts.residualDefects}.`,
		`- Repair: ${repair}.`,
	].join("\n")
}

function assertValid(manifest, where) {
	const { ok, errors } = validateOutcomeManifest(manifest)
	if (!ok) throw new OutcomeError("invalid_manifest", `${where}: ${errors.join("; ")}`)
}

export function readManifest(file) {
	let manifest
	try {
		manifest = JSON.parse(nodeFs.readFileSync(file, "utf8"))
	} catch (error) {
		if (error instanceof SyntaxError) throw new OutcomeError("invalid_manifest", `${file}: not valid JSON (${error.message})`)
		throw error
	}
	assertValid(manifest, file)
	return manifest
}

/** Validate, then write atomically (temp file in the same dir + rename). */
export function writeManifest(file, manifest) {
	assertValid(manifest, file)
	const temp = join(dirname(file), `.${basename(file)}.${process.pid}.${Date.now()}.tmp`)
	try {
		nodeFs.writeFileSync(temp, `${JSON.stringify(manifest, null, "\t")}\n`, "utf8")
		nodeFs.renameSync(temp, file)
	} catch (error) {
		nodeFs.rmSync(temp, { force: true })
		throw error
	}
	return file
}
