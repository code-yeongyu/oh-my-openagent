import type { Buffer } from "node:buffer"

import { checkPng } from "./png-check"

export const SURFACES = ["http", "cli", "tui", "web", "gui", "library", "data"] as const
export const VERDICTS = ["PASS", "FAIL", "NA"] as const
export type Surface = (typeof SURFACES)[number]
export type Verdict = (typeof VERDICTS)[number]
const VISUAL_SURFACES: ReadonlySet<string> = new Set(["web", "gui"])

export interface SourceIdentity {
	readonly commitSha: string
	readonly dirty: boolean
	readonly treeHash?: string
}

export interface ArtifactInfo {
	readonly exists: boolean
	readonly isFile: boolean
	readonly size: number
	readonly inside: boolean
	read(): Buffer
}

export interface ValidationContext {
	readonly artifact: (relativePath: string) => ArtifactInfo
	readonly live?: SourceIdentity
}

export interface ValidationError {
	readonly rowId: string | null
	readonly message: string
}

export interface ValidationResult {
	readonly ok: boolean
	readonly errors: readonly ValidationError[]
	readonly counts: Readonly<Record<Verdict, number>>
}

const SHA1 = /^[0-9a-f]{40}$/
const SHA256 = /^[0-9a-f]{64}$/

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0
}

function isSurface(value: unknown): value is Surface {
	return typeof value === "string" && (SURFACES as readonly string[]).includes(value)
}

function isVerdict(value: unknown): value is Verdict {
	return typeof value === "string" && (VERDICTS as readonly string[]).includes(value)
}

function isRfc3339(value: unknown): value is string {
	return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(new Date(value).getTime())
}

function sourceErrors(source: unknown, live: SourceIdentity | undefined): ValidationError[] {
	const errors: ValidationError[] = []
	if (!isRecord(source)) return [{ rowId: null, message: "source must be an object with commitSha and dirty" }]
	const { commitSha, dirty, treeHash } = source
	if (typeof commitSha !== "string" || !SHA1.test(commitSha)) errors.push({ rowId: null, message: "source.commitSha must be a 40-character lowercase hex sha" })
	if (typeof dirty !== "boolean") errors.push({ rowId: null, message: "source.dirty must be a boolean" })
	if (dirty === true && (typeof treeHash !== "string" || !SHA256.test(treeHash))) errors.push({ rowId: null, message: "source.treeHash must be a sha256 hex when dirty is true" })
	if (dirty === false && treeHash !== undefined) errors.push({ rowId: null, message: "source.treeHash is only allowed when dirty is true" })
	if (errors.length > 0 || live === undefined || typeof commitSha !== "string" || typeof dirty !== "boolean") return errors
	if (commitSha !== live.commitSha) errors.push({ rowId: null, message: `source.commitSha ${commitSha} is stale: the checkout is at ${live.commitSha}` })
	if (dirty !== live.dirty) errors.push({ rowId: null, message: `source.dirty is ${String(dirty)} but the checkout is ${live.dirty ? "dirty" : "clean"}` })
	else if (dirty && treeHash !== live.treeHash) errors.push({ rowId: null, message: `source.treeHash does not match the current uncommitted changes (${live.treeHash ?? "none"})` })
	return errors
}

function artifactErrors(rowId: string, surface: Surface, verdict: Verdict, artifacts: unknown, context: ValidationContext): ValidationError[] {
	const errors: ValidationError[] = []
	if (!Array.isArray(artifacts)) return [{ rowId, message: "artifacts must be an array of relative paths" }]
	let pngCount = 0
	for (const ref of artifacts) {
		if (!isNonEmptyString(ref)) {
			errors.push({ rowId, message: "artifacts contains an empty or non-string entry" })
			continue
		}
		const info = context.artifact(ref)
		if (!info.inside) {
			errors.push({ rowId, message: `artifact ${ref} resolves outside the evidence directory` })
			continue
		}
		if (!info.exists) {
			errors.push({ rowId, message: `artifact ${ref} is missing` })
			continue
		}
		if (!info.isFile || info.size === 0) {
			errors.push({ rowId, message: `artifact ${ref} is empty or not a regular file` })
			continue
		}
		if (ref.toLowerCase().endsWith(".png")) {
			pngCount += 1
			const png = checkPng(info.read())
			for (const problem of png.errors) errors.push({ rowId, message: `artifact ${ref}: ${problem}` })
		}
	}
	if (verdict === "PASS" && artifacts.length === 0) errors.push({ rowId, message: "a PASS row needs at least one artifact" })
	if (verdict === "PASS" && VISUAL_SURFACES.has(surface) && pngCount === 0) errors.push({ rowId, message: `a ${surface} PASS row needs at least one .png capture` })
	return errors
}

function rowErrors(row: unknown, index: number, seenIds: Set<string>, context: ValidationContext): { errors: ValidationError[]; verdict: Verdict | null } {
	const fallbackId = `rows[${index}]`
	if (!isRecord(row)) return { errors: [{ rowId: fallbackId, message: "row must be an object" }], verdict: null }
	const rowId = isNonEmptyString(row.id) ? row.id : fallbackId
	const errors: ValidationError[] = []
	if (!isNonEmptyString(row.id)) errors.push({ rowId, message: "id must be a non-empty string" })
	else if (seenIds.has(row.id)) errors.push({ rowId, message: `duplicate row id ${row.id}` })
	else seenIds.add(row.id)
	for (const field of ["scenario", "command", "expected", "observed"] as const) {
		if (!isNonEmptyString(row[field])) errors.push({ rowId, message: `${field} must be a non-empty string` })
	}
	if (!isSurface(row.surface)) errors.push({ rowId, message: `surface must be one of ${SURFACES.join(", ")}` })
	if (!isVerdict(row.verdict)) errors.push({ rowId, message: `verdict must be one of ${VERDICTS.join(", ")}; inferred and partial do not exist` })
	if (row.verdict === "NA" && !isNonEmptyString(row.naReason)) errors.push({ rowId, message: "an NA row needs a non-empty naReason naming why the scenario cannot apply" })
	if (isSurface(row.surface) && isVerdict(row.verdict)) errors.push(...artifactErrors(rowId, row.surface, row.verdict, row.artifacts, context))
	return { errors, verdict: isVerdict(row.verdict) ? row.verdict : null }
}

export function validateMatrix(document: unknown, context: ValidationContext): ValidationResult {
	const counts: Record<Verdict, number> = { PASS: 0, FAIL: 0, NA: 0 }
	if (!isRecord(document)) return { ok: false, errors: [{ rowId: null, message: "qa-matrix.json must be a JSON object" }], counts }
	const errors: ValidationError[] = []
	if (document.schemaVersion !== 1) errors.push({ rowId: null, message: "schemaVersion must be 1" })
	if (!isRfc3339(document.capturedAt)) errors.push({ rowId: null, message: "capturedAt must be an RFC 3339 timestamp with a date and a T" })
	errors.push(...sourceErrors(document.source, context.live))
	if (!Array.isArray(document.rows) || document.rows.length === 0) {
		errors.push({ rowId: null, message: "rows must be a non-empty array" })
		return { ok: false, errors, counts }
	}
	const seenIds = new Set<string>()
	document.rows.forEach((row, index) => {
		const result = rowErrors(row, index, seenIds, context)
		errors.push(...result.errors)
		if (result.verdict !== null) counts[result.verdict] += 1
	})
	return { ok: errors.length === 0, errors, counts }
}
