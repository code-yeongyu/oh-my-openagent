// fidelity-policy.mjs - what the locked `## Fidelity` block of brief.md means to the CLI stages.
//
// lockedBrief is the gate the six reader-facing stages (fact fill, verify, pairs, meaning-check,
// polish-apply, polish-diff) run before reading or writing anything: an unlocked brief returns
// one fidelity_interview_incomplete defect (exit 1), a malformed block is a usage error (exit 2).
// fillPolicy reads the fields fact fill consumes, and policyErrors refuses a placeholder whose row
// the brief forbids: derived_not_allowed (`derived numbers: none` against a derived, converted, or
// assumed row) and source_outside_floor (the source floor is evaluated live against each source's
// meta.json at every fill; a row's outside_floor is only the cached result). Collection stages
// never call this module. node: builtins and sibling imports only.

import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { CliError } from "./cli-support.mjs"
import { DEFECT_CODES } from "./contracts.mjs"
import { KIND_RULES } from "./fact-ledger-kinds.mjs"
import { meaningCheckEnabled, requireLockedBrief } from "./fidelity-brief.mjs"

export { meaningCheckEnabled }

/**
 * Ledger kinds a brief with `derived numbers: none` refuses. A policy list, not the ledger's
 * derivation set: it also names assumed. Every name must be a KIND_RULES kind (checked at load).
 */
const DERIVED_KINDS = Object.freeze(["derived", "converted", "assumed"])
for (const kind of DERIVED_KINDS) {
	if (!Object.hasOwn(KIND_RULES, kind)) throw new Error(`fidelity-policy: ${kind} is not a KIND_RULES kind`)
}

/** How each field value the fill stages consume is read; the single owner of those readings. */
export const FIDELITY_VALUE_RULES = Object.freeze({
	derivedKinds: DERIVED_KINDS,
	derivedRefused: (kind) => DERIVED_KINDS.includes(kind),
	derivedNone: (value) => /^none$/iu.test(value.trim()),
	fallback: (value) => (/^omit$/iu.test(value.trim()) ? "omit" : "quote"),
	translations: (value) => /with translation beside/iu.test(value),
	meaningCheck: (value) => meaningCheckEnabled({ fields: { "meaning check": value } }),
})

/** The `source floor` forms: `pattern` reads one, `listed` forms carry a comma list. */
export const SOURCE_FLOOR_RULES = Object.freeze([
	Object.freeze({ kind: "standard", form: "standard", pattern: /^standard$/iu, listed: false }),
	Object.freeze({ kind: "primary", form: "primary only", pattern: /^primary only$/iu, listed: false }),
	Object.freeze({ kind: "pointed", form: "pointed only: <list>", pattern: /^pointed only:\s*(.+)$/iu, listed: true }),
	Object.freeze({ kind: "classes", form: "classes: <list>", pattern: /^classes:\s*(.+)$/iu, listed: true }),
])
const lineOf = (text, at) => text.slice(0, at).split("\n").length
const listOf = (text) => text.split(",").map((entry) => entry.trim()).filter(Boolean)

/** brief.md from --brief, else the session's; a usage error when neither is known. */
export function briefPathOf(flags) {
	if (flags.brief !== undefined && flags.brief !== true) return resolve(flags.brief)
	const dir = flags["session-dir"] ?? process.env.SESSION_DIR
	if (!dir || dir === true) throw new CliError("--brief is required without --session-dir (or SESSION_DIR)")
	return join(resolve(dir), "brief.md")
}

/**
 * @returns {{ parsed: object, refusal: null } | { parsed: null, refusal: { json: object, summary: string, exitCode: 1 } }}
 */
export function lockedBrief(command, flags) {
	const path = briefPathOf(flags)
	const lock = requireLockedBrief(path)
	if (lock.exitCode === 2) throw new CliError(`${path}: ${lock.errors.join("; ")}`)
	if (lock.locked) return { parsed: lock.parsed, refusal: null }
	const json = { command, status: "fail", exitCode: 1, defects: lock.defects }
	return { parsed: null, refusal: { json, summary: `${command}: ${lock.defects[0].message}`, exitCode: 1 } }
}

/**
 * The source floor as a rule, or null for `standard`; a usage error for any other text.
 * @returns {null | { kind: "primary" } | { kind: "pointed" | "classes", list: string[] }}
 */
export function parseSourceFloor(value) {
	const text = value.trim()
	for (const rule of SOURCE_FLOOR_RULES) {
		const match = rule.pattern.exec(text)
		if (!match) continue
		if (rule.kind === "standard") return null
		return rule.listed ? { kind: rule.kind, list: listOf(match[1]) } : { kind: rule.kind }
	}
	throw new CliError(`source floor "${value}" is not ${SOURCE_FLOOR_RULES.map((rule) => rule.form).join(", ")}`)
}

function hostOf(url) {
	return typeof url === "string" && URL.canParse(url) ? new URL(url).hostname.toLowerCase() : null
}

/** Whether one source (id and meta.json) satisfies a parsed floor rule. */
export function sourceInsideFloor(rule, sourceId, meta) {
	if (rule.kind === "primary") return meta.provenance === "primary"
	if (rule.kind === "pointed") return rule.list.includes(sourceId) || rule.list.includes(meta.url)
	const host = hostOf(meta.url)
	return host !== null && rule.list.some((entry) => host === entry.toLowerCase() || host.endsWith(`.${entry.toLowerCase()}`))
}

/** The fields fact fill consumes: the fallback form and whether a translation binds to its quote. */
export function fillPolicy(parsed) {
	const field = (name) => parsed.fields[name]
	return {
		fallback: FIDELITY_VALUE_RULES.fallback(field("fallback")),
		translations: FIDELITY_VALUE_RULES.translations(field("languages")),
		derivedNone: FIDELITY_VALUE_RULES.derivedNone(field("derived numbers")),
		floor: parseSourceFloor(field("source floor")),
	}
}

/** Source ids behind a row: its own, or for a derived row its operands' sources. */
function sourcesOf(row, rows, seen = new Set()) {
	if (seen.has(row.fact_id)) return []
	seen.add(row.fact_id)
	if (row.source_id) return [row.source_id]
	return [...row.operands, ...row.derived_from].flatMap((id) => (rows.has(id) ? sourcesOf(rows.get(id), rows, seen) : []))
}

function metaOf(sessionDir, sourceId, cache) {
	if (!cache.has(sourceId)) {
		const file = join(sessionDir, "sources", sourceId, "meta.json")
		cache.set(sourceId, existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { url: null, provenance: "unknown" })
	}
	return cache.get(sourceId)
}

const defect = (code, pointer, text, message) => ({ code, token: pointer.token, line: lineOf(text, pointer.start), message, severity: DEFECT_CODES[code].severity, hint: DEFECT_CODES[code].hint })

/**
 * Refusals for the placeholders of one fill source. Sets each referenced sourced row's
 * outside_floor to this evaluation and reports whether any cached value changed.
 * @param {{ token: string, start: number, parsed: { id?: string } }[]} found findPlaceholders output
 * @returns {{ errors: object[], cacheChanged: boolean }}
 */
export function policyErrors(text, found, ledger, sessionDir, policy) {
	const rows = new Map(ledger.rows.map((row) => [row.fact_id, row]))
	const metas = new Map()
	const errors = []
	let cacheChanged = false
	for (const pointer of found) {
		const row = rows.get(pointer.parsed?.id)
		if (row === undefined || row.status !== "active") continue
		if (policy.derivedNone && FIDELITY_VALUE_RULES.derivedRefused(row.kind)) {
			errors.push(defect("derived_not_allowed", pointer, text, `${row.fact_id} is ${row.kind}; the brief records derived numbers: none`))
		}
		const sources = sourcesOf(row, rows)
		if (sources.length === 0) continue
		const outside = policy.floor === null ? [] : sources.filter((id) => !sourceInsideFloor(policy.floor, id, metaOf(sessionDir, id, metas)))
		if (row.outside_floor !== outside.length > 0) cacheChanged = true
		row.outside_floor = outside.length > 0
		if (outside.length > 0) errors.push(defect("source_outside_floor", pointer, text, `${row.fact_id} rests on ${outside.join(", ")}, outside the source floor`))
	}
	return { errors, cacheChanged }
}
