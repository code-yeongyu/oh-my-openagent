// fact-commands-verify.mjs - `fact verify` and the Markdown projection it checks.
//
// fact verify runs the deterministic fidelity gate over one filled HTML or Markdown edition and
// writes a fidelity record (default $SESSION_DIR/fidelity-defects.json, through
// writeFidelityRecord) carrying the artifact's sha256. It
// exits 1 on any blocker or major defect (the orchestrator then records `outcome gate fidelity
// fail`); minors alone exit 0 and are listed. A Markdown edition is read through md-lite into an
// escaped HTML projection (same line numbers) and checked with its fill map, which is the only
// record of where its values sit; LaTeX is verified through its Markdown source.
//
// The locked brief is re-judged here, not only at fill: the edition's fill map (--fill-map, else
// `<report>.fill-map.json` when present) must carry the current brief's brief_sha256
// (brief_changed), and policyErrors re-runs over every data-fact the edition carries, so an
// edition that violates the current derived-numbers or source-floor rule fails here too.
//
// The delivery barrier that reads these records (and every other fidelity record) is
// fidelity-records.mjs.

import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import { CliError, readJsonFile, sha256Of } from "./cli-support.mjs"
import { countDefects } from "./contracts.mjs"
import { recompute } from "./fact-derive.mjs"
import { readLedger } from "./fact-ledger.mjs"
import { validateLedger } from "./fact-ledger-schema.mjs"
import { briefBindingErrors, fillPolicy, lockedBrief, policyErrors } from "./fidelity-policy.mjs"
import { FIDELITY_RECORD, writeFidelityRecord } from "./fidelity-records.mjs"
import { blocksDelivery, checkFidelity } from "./gates-fidelity.mjs"
import { parseMarkdown } from "./md-lite.mjs"
import { escapeHtml, parseRenderedQuote, renderQuote, renderValueHtml } from "./placeholder.mjs"
import { sessionDirOf } from "./source-commands.mjs"

function readText(path) {
	try {
		return readFileSync(path, "utf8")
	} catch (error) {
		throw new CliError(`cannot read ${path}: ${error.code ?? error.message}`)
	}
}

/**
 * md-lite block kind -> its projection: the element tag (null = h<level>) and, for a run of one kind,
 * the container that wraps the run. Code and table rows also take the specialized bodies below.
 */
export const MD_HTML_BLOCK_RULES = Object.freeze({
	heading: Object.freeze({ tag: null }),
	paragraph: Object.freeze({ tag: "p" }),
	list_item: Object.freeze({ tag: "li", group: Object.freeze(["<ul>", "</ul>"]) }),
	blockquote: Object.freeze({ tag: "blockquote" }),
	code: Object.freeze({ tag: "code" }),
	table_row: Object.freeze({ tag: "tr", group: Object.freeze(["<table>", "</table>"]) }),
})

/** Escaped text with inline links and code spans kept as elements, so a URL is never read as prose. */
export const projectMarkdownInline = (text) =>
	escapeHtml(text)
		.replace(/\[([^\]]+)\]\(([^)\s]+)\)/gu, '<a href="$2">$1</a>')
		.replace(/`([^`]+)`/gu, "<code>$1</code>")

/** The element the HTML fill writes for one fill-map entry, or null when its bytes were edited since. */
function entryHtml(text, entry, rows) {
	const body = text.slice(entry.start, entry.end)
	if (body !== entry.rendered) return null
	const row = rows.get(entry.fact_id)
	if (entry.translates) return `<span data-translates="${escapeHtml(entry.translates)}">${projectMarkdownInline(body.replace(/^<!--[\s\S]*?-->\s*/u, ""))}</span>`
	if (!row) return `<data data-fact="${escapeHtml(entry.fact_id)}">${escapeHtml(body)}</data>`
	const quoted = row.kind === "quote" ? parseRenderedQuote(body) : null
	if (quoted) return renderQuote(row, entry.selector ?? "full", quoted.text, "html")
	return row.kind === "quote" ? null : renderValueHtml(row, body)
}

/** [from, to) of the filled text as HTML, each intact fill-map entry rebuilt as its fill element. */
function spanHtml(text, from, to, entries, rows, stale) {
	let html = ""
	let cursor = from
	for (const entry of entries) {
		if (entry.start < cursor || entry.end > to || entry.start < from || entry.replaced !== undefined) continue
		const element = entryHtml(text, entry, rows)
		if (element === null) continue
		stale.delete(entry)
		html += projectMarkdownInline(text.slice(cursor, entry.start)) + element
		cursor = entry.end
	}
	return html + projectMarkdownInline(text.slice(cursor, to))
}

/**
 * An escaped HTML projection of a filled Markdown edition: one element per md-lite block, each on
 * the source line it starts on, lists and table rows grouped. Never a rendering for readers.
 * @param {string} text the filled Markdown
 * @param {{ fact_id: string, start: number, end: number, rendered: string, replaced?: string, translates?: string }[]} entries its fill map
 * @param {{ rows: object[] }} ledger
 * @returns {{ html: string, stale: object[] }} stale: entries whose bytes changed after fill (checked by text)
 */
export function markdownAsHtml(text, entries, ledger) {
	const sorted = [...(entries ?? [])].sort((a, b) => a.start - b.start)
	const rows = new Map((ledger?.rows ?? []).map((row) => [row.fact_id, row]))
	const stale = new Set(sorted.filter((entry) => entry.replaced === undefined))
	const lineAt = (offset) => text.slice(0, offset).split("\n").length
	const parsed = parseMarkdown(text)
	if (parsed.problems.length > 0) {
		throw new CliError(`the Markdown edition is malformed: ${parsed.problems.map((problem) => `${problem.code} at line ${problem.line}`).join(", ")}; fix it before verifying`)
	}
	let html = "<!doctype html><html><head><title>md</title></head><body>"
	let line = 1
	let open = null
	for (const block of parsed.blocks) {
		const rule = MD_HTML_BLOCK_RULES[block.kind]
		if (rule === undefined) throw new CliError(`md-lite block kind ${block.kind} has no projection rule`)
		if (open && open !== block.kind) html += MD_HTML_BLOCK_RULES[open].group[1]
		const target = lineAt(block.start)
		if (target > line) html += "\n".repeat(target - line)
		line = Math.max(line, target) + (text.slice(block.start, block.end).match(/\n/gu)?.length ?? 0)
		if (rule.group && open !== block.kind) html += rule.group[0]
		open = rule.group ? block.kind : null
		const inner = (from, to) => spanHtml(text, from, to, sorted, rows, stale)
		if (block.kind === "table_row") html += `<${rule.tag}>${block.cells.map((cell) => `<td>${inner(cell.start, cell.end)}</td>`).join("")}</${rule.tag}>`
		else if (block.kind === "code") html += `<pre><${rule.tag}>${escapeHtml(block.text)}</${rule.tag}></pre>`
		else {
			const tag = rule.tag ?? `h${block.level}`
			const replaced = block.kind === "blockquote" ? sorted.find((entry) => entry.replaced !== undefined && entry.start <= block.start && entry.end >= block.end) : undefined
			const attrs = replaced ? ` data-fact="${escapeHtml(replaced.fact_id)}" data-replaced="${escapeHtml(replaced.replaced)}"` : ""
			html += `<${tag}${attrs}>${inner(block.start, block.end)}</${tag}>`
		}
	}
	return { html: `${html}${open ? MD_HTML_BLOCK_RULES[open].group[1] : ""}</body></html>\n`, stale: [...stale] }
}

/** The session dir from --session-dir or SESSION_DIR, or null; a bare flag names no session. */
export const sessionOf = (flags) => {
	const dir = flags["session-dir"] ?? process.env.SESSION_DIR
	return dir && dir !== true ? resolve(dir) : null
}

/** The ledger from --ledger (validated) or from the session dir; every fact command loads it here. */
export function ledgerFrom(flags, session = sessionOf(flags)) {
	if (flags.ledger === undefined) {
		if (session === null) throw new CliError("--ledger is required without --session-dir (or SESSION_DIR)")
		return readLedger(session)
	}
	const ledger = readJsonFile(flags.ledger)
	const errors = validateLedger(ledger)
	if (errors.length > 0) throw new CliError(`${flags.ledger} is not a valid fact ledger: ${errors[0]}`)
	return ledger
}

const MARKDOWN_EXTENSION = /\.(md|markdown)$/iu
/** The edition format: the explicit flag, else md for a .md or .markdown path (any case), else html. */
export const editionFormatOf = (path, flag) => flag ?? (MARKDOWN_EXTENSION.test(path) ? "md" : "html")

/** The report's format (from --format or its extension) and, for Markdown, its fill map entries. */
export function readEdition(report, flags) {
	const format = editionFormatOf(report, flags.format)
	if (format !== "html" && format !== "md") throw new CliError(`--format ${format}: verify html or md (a LaTeX edition is verified through its Markdown source)`)
	const text = readText(report)
	if (format === "html") return { format, text, entries: flags["fill-map"] === undefined ? null : readJsonFile(flags["fill-map"]).entries }
	const map = flags["fill-map"] ?? `${report}.fill-map.json`
	if (!existsSync(map)) throw new CliError(`a Markdown edition needs its fill map: ${map} is missing (pass --fill-map)`)
	return { format, text, entries: readJsonFile(map).entries }
}

/** @param {{ positionals: string[], flags: Record<string, any> }} args parsed by runFact */
export function runFactVerify(args) {
	const [report] = args.positionals
	const { flags } = args
	if (!report) throw new CliError("usage: fact verify <report> [--format html|md] [--sources D] [--claims claims.json] [--fill-map F] [--brief brief.md] [--out fidelity-defects.json]")
	const sessionDir = sessionDirOf(flags)
	const { parsed, refusal } = lockedBrief("fact verify", flags)
	if (refusal) return refusal
	const policy = fillPolicy(parsed)
	const edition = readEdition(report, flags)
	const claimsPath = flags.claims ?? join(sessionDir, "claims.json")
	const briefPath = flags.brief ?? join(sessionDir, "brief.md")
	const ledger = readLedger(sessionDir)
	const projected = edition.format === "md" ? markdownAsHtml(edition.text, edition.entries, ledger) : null
	const result = checkFidelity(projected?.html ?? edition.text, {
		ledger,
		sourcesDir: resolve(flags.sources ?? join(sessionDir, "sources")),
		claims: flags.claims !== undefined || existsSync(claimsPath) ? readJsonFile(claimsPath) : null,
		fillMap: projected?.stale ?? edition.entries,
		brief: existsSync(briefPath) ? readText(briefPath) : "",
		baseDir: dirname(resolve(report)),
		recompute,
	})
	const checked = projected?.html ?? edition.text
	const pointers = [...checked.matchAll(/\bdata-fact="([^"]+)"/gu)].map((match) => ({ token: match[0], start: match.index, parsed: { id: match[1] } }))
	const mapPath = flags["fill-map"] ?? `${report}.fill-map.json`
	const bound = existsSync(mapPath) ? briefBindingErrors(readJsonFile(mapPath), mapPath, parsed) : []
	const defects = [...bound, ...policyErrors(checked, pointers, ledger, sessionDir, policy).errors, ...result.defects]
	const counts = countDefects(defects)
	const status = defects.some(blocksDelivery) ? "fail" : "pass"
	const exitCode = status === "fail" ? 1 : 0
	const out = resolve(flags.out ?? join(sessionDir, FIDELITY_RECORD))
	const record = writeFidelityRecord(out, "fidelity", { command: "fact verify", status, exitCode, format: edition.format, report: resolve(report), artifact_sha256: sha256Of(edition.text), defects, counts, gatesRun: result.gatesRun })
	return { json: { ...record, out }, summary: `fact verify: ${status.toUpperCase()} - ${counts.blocker} blocker, ${counts.major} major, ${counts.minor} minor`, exitCode }
}
