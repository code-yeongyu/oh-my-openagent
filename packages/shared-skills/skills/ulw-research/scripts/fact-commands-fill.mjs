// fact-commands-fill.mjs - `fact fill`, the reader-facing fill of a placeholder source.
//
// It refuses an unlocked brief (fidelity_interview_incomplete) and applies the locked `## Fidelity`
// fields: `derived numbers: none` and the source floor refuse rows (derived_not_allowed,
// source_outside_floor, evaluated at every fill), `languages` decides whether a translation after a
// quote binds to it, and `fallback` picks the block quote or omission for --replace-failed. Any
// error writes no edition, fill map, or state; the one write that survives a refusal is the
// ledger's cached outside_floor per row (skipped under --view). The fill map records brief_sha256,
// the locked block fact verify checks it against. node: builtins and sibling imports only.

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, extname, resolve } from "node:path"

import { CliError, sha256Of, writeJsonAtomic } from "./cli-support.mjs"
import { DEFECT_CODES } from "./contracts.mjs"
import { markdownAsHtml } from "./fact-commands-verify.mjs"
import { FILL_FORMATS, fill } from "./fact-fill.mjs"
import { readLedger, writeLedger } from "./fact-ledger.mjs"
import { briefHashOf, fillPolicy, lockedBrief, policyErrors } from "./fidelity-policy.mjs"
import { readState, writeState } from "./fidelity-state.mjs"
import { withBoundUnits } from "./fidelity-value-unit.mjs"
import { parseMarkdown } from "./md-lite.mjs"
import { findPlaceholders } from "./placeholder.mjs"
import { sessionDirOf } from "./source-commands.mjs"

/** The CLI's input vocabulary: fill's output formats plus aliases (tex is filled as md), and the extension defaults. */
export const FILL_INPUT_FORMAT_RULES = Object.freeze({
	aliases: Object.freeze({ tex: "md" }),
	extensions: Object.freeze({ ".md": "md", ".tex": "tex" }),
})
export const FILL_INPUT_FORMATS = Object.freeze([...FILL_FORMATS, ...Object.keys(FILL_INPUT_FORMAT_RULES.aliases)])
const fillFormatOf = (format) => FILL_INPUT_FORMAT_RULES.aliases[format] ?? format

/** Value-mode entries carry the unit fill saw bound to them (unit_bound), read off the edition verify will check. */
function boundUnits(out, entries, ledger, format) {
	if (!entries.some((entry) => entry.mode === "value")) return entries
	const html = fillFormatOf(format) === "html" ? out : parseMarkdown(out).problems.length === 0 ? markdownAsHtml(out, entries, ledger).html : null
	return html === null ? entries : withBoundUnits(html, entries, new Map(ledger.rows.map((row) => [row.fact_id, row])))
}

function readText(path) {
	try {
		return readFileSync(path, "utf8")
	} catch (error) {
		throw new CliError(`cannot read ${path}: ${error.code ?? error.message}`)
	}
}

/** The inline edition: local stylesheets and scripts inlined, relative image paths made absolute. */
function inlineAssets(html, baseDir) {
	const local = (ref) => !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(ref)
	return html
		.replace(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi, (tag) => {
			const href = /\bhref=["']([^"']+)["']/i.exec(tag)?.[1]
			return href && local(href) ? `<style>${readText(resolve(baseDir, href))}</style>` : tag
		})
		.replace(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)><\/script>/gi, (tag, pre, src, post) => (local(src) ? `<script${pre}${post}>${readText(resolve(baseDir, src))}</script>` : tag))
		.replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'])/gi, (tag, pre, src, post) => (local(src) && !src.startsWith("/") ? `${pre}${resolve(baseDir, src)}${post}` : tag))
}

/** @param {{ positionals: string[], flags: Record<string, any> }} args parsed by runFact */
export function runFactFill(args) {
	const [source] = args.positionals
	const { flags } = args
	if (!source || (flags.out === undefined && !flags.view)) throw new CliError("usage: fact fill <src> (--out <path> | --view) [--format html|md|tex] [--inline] [--replace-failed] [--brief brief.md]")
	const format = flags.format ?? FILL_INPUT_FORMAT_RULES.extensions[extname(source).toLowerCase()] ?? "html"
	if (!FILL_INPUT_FORMATS.includes(format)) throw new CliError(`--format must be ${FILL_INPUT_FORMATS.slice(0, -1).join(", ")}, or ${FILL_INPUT_FORMATS.at(-1)}`)
	if (flags.inline && format !== "html") throw new CliError("--inline applies to the html edition only")
	const sessionDir = sessionDirOf(flags)
	const { parsed, refusal } = lockedBrief("fact fill", flags)
	if (refusal) return refusal
	const policy = fillPolicy(parsed)
	const text = readText(source)
	const ledger = readLedger(sessionDir)
	const refused = policyErrors(text, findPlaceholders(text), ledger, sessionDir, policy)
	if (refused.cacheChanged && !flags.view) writeLedger(sessionDir, ledger)
	const state = flags["replace-failed"] ? readState(sessionDir) : null
	const result = fill(text, ledger, { format: fillFormatOf(format), view: flags.view === true, fallback: policy.fallback, ...(state ? { replaceFailed: state } : {}) })
	const warnings = result.warnings
	if (result.out === null || refused.errors.length > 0) {
		const filled = result.errors.map((error) => ({ ...error, severity: DEFECT_CODES[error.code]?.severity ?? "blocker", hint: DEFECT_CODES[error.code]?.hint ?? null }))
		const defects = [...refused.errors, ...filled]
		return { json: { command: "fact fill", status: "fail", exitCode: 1, defects, warnings }, summary: `fact fill: FAIL - ${defects.length} error(s), nothing written`, exitCode: 1 }
	}
	const entries = policy.translations ? result.fillMap : result.fillMap.filter((entry) => entry.translates === undefined)
	const out = flags.inline ? inlineAssets(result.out, dirname(resolve(source))) : result.out
	if (flags.view) return { text: out, summary: `fact fill --view: ${entries.length} pointer(s), ${warnings.length} warning(s)`, exitCode: 0 }
	writeFileSync(flags.out, out)
	if (state) writeState(sessionDir, state)
	const artifact = sha256Of(out)
	const map = `${resolve(flags.out)}.fill-map.json`
	const brief = briefHashOf(parsed)
	writeJsonAtomic(map, { schemaVersion: 1, format, artifact: resolve(flags.out), artifact_sha256: artifact, brief_sha256: brief, entries: boundUnits(out, entries, ledger, format) })
	const data = { out: resolve(flags.out), map, artifact_sha256: artifact, brief_sha256: brief, occurrences: entries.length, warnings }
	return { json: { command: "fact fill", status: "pass", exitCode: 0, defects: [], data }, summary: `fact fill: wrote ${flags.out} (${entries.length} pointer(s))`, exitCode: 0 }
}
