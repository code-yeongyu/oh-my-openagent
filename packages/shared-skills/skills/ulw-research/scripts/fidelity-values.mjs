// fidelity-values.mjs - value, quote, and chart checks of the deterministic fidelity gate.
//
// Each data-fact element must match its ledger row, and each Q element the script's
// reconstruction of its selection (report text never gets a fuzzy pass). Cited rows, table rows,
// snapshots, and chart CSVs are rechecked; the numeral and quotation trace is fidelity-trace.mjs,
// and the claim-kind checks (data-claim-kind, unsupported_verification) are fidelity-claims.mjs.
// No model, no network.

import { existsSync, readFileSync } from "node:fs"
import { join, resolve, sep } from "node:path"

import { sha256Of } from "./cli-support.mjs"
import { sameValue, unitKey } from "./fidelity-binding.mjs"
import { claimChecks } from "./fidelity-claims.mjs"
import { STRUCTURAL, clip, traceChecks } from "./fidelity-trace.mjs"
import { parseHtml, proseText } from "./html-lite.mjs"
import { parseNumeral } from "./numerals.mjs"
import { div, fromDecimal, sub } from "./rational.mjs"
import { normalizeText } from "./text-normalize.mjs"

const DECIMAL = /^-?\d+(?:\.\d+)?$/

const bare = (text) => normalizeText(String(text ?? "").replace(/\s*\[(?:S|Source\s*)\d+\]\s*$/i, "")).replace(/\u2026/g, "...").replace(/\s*\.\.\.\s*/g, "...").replace(/^["']+|["']+$/g, "").trim()

/** The text fill renders for a quote selection: full, lead=<n>, or from=<a>;to=<b> (placeholder form accepted). */
export function selectQuote(quote, selector) {
	const text = String(quote ?? "").trim()
	if (selector === "full") return text
	const lead = /^lead=(\d+)$/.exec(selector)
	const words = text.split(/\s+/)
	if (lead) return words.length <= Number(lead[1]) ? text : `${words.slice(0, Number(lead[1])).join(" ")}...`
	const range = /^from=(.+);to=(.+)$/.exec(selector) ?? /^from="(.+)":to="(.+)"$/.exec(selector)
	if (!range) return null
	const once = (anchor) => text.indexOf(anchor) !== -1 && text.indexOf(anchor) === text.lastIndexOf(anchor)
	if (!once(range[1]) || !once(range[2])) return null
	const start = text.indexOf(range[1])
	const end = text.indexOf(range[2]) + range[2].length
	if (end <= start) return null
	return `${start > 0 ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`
}

function quoteProblem(row, shown, selector) {
	const want = selectQuote(row.quote, selector)
	if (want === null) return ["quote_not_verbatim", `selection "${selector}" does not resolve in ${row.fact_id}'s quote`]
	return bare(shown) === bare(want) ? null : ["quote_not_verbatim", `"${clip(shown)}" is not the ${selector} selection of ${row.fact_id}: "${clip(want)}"`]
}

function factProblem(row, shown, attrs = {}) {
	if (attrs["data-unit"] !== undefined && unitKey(attrs["data-unit"]) !== unitKey(row.unit)) return ["unit_mismatch", `data-unit "${attrs["data-unit"]}" but ${row.fact_id} is in "${row.unit}"`]
	if (attrs.value !== undefined && !sameValue(attrs.value, row.value)) return ["value_mismatch", `value="${attrs.value}" but ${row.fact_id} is ${row.value}`]
	const text = normalizeText(shown)
	const forms = [row.raw, row.render, row.value, row.unit && `${row.value} ${row.unit}`].filter(Boolean).map(normalizeText)
	if (forms.some((form) => text === form || (text.endsWith(` ${form}`) && !/\d/.test(text.slice(0, -form.length))))) return null
	const parsed = parseNumeral(text)
	if (!parsed) return unitKey(text) === unitKey(row.unit) ? null : ["value_mismatch", `"${clip(shown)}" shows no value of ${row.fact_id} (${row.value})`]
	if (!sameValue(parsed.value, row.value)) return ["value_mismatch", `"${clip(shown)}" reads ${parsed.value}, but ${row.fact_id} is ${row.value}`]
	if (parsed.unitRaw && unitKey(parsed.unitRaw) !== unitKey(row.unit)) return ["unit_mismatch", `"${clip(shown)}" is in ${parsed.unitRaw}, but ${row.fact_id} is in ${row.unit}`]
	return null
}

/** Whether a candidate fill site reads as what fill wrote there or as the entry's row ("1,237 million" is neither 1,237 nor F2). */
const fillSiteFits = (rows) => (entry, tail) => {
	const [row, site, own] = [rows.get(entry.fact_id), parseNumeral(tail, 0), parseNumeral(entry.rendered, 0)]
	if (!row || row.kind === "quote" || !site || !own) return true
	if (sameValue(site.value, own.value) && unitKey(site.unitRaw ?? "") === unitKey(own.unitRaw ?? "")) return true
	return factProblem(row, tail.slice(0, Math.max(entry.rendered.length, site.span[1]))) === null
}

const withoutFooter = (node) => proseText({ children: node.children.filter((child) => child.tag !== "footer") })

/** One row per active value row, as `fact export --csv` writes it. */
export function exportRows(ledger) {
	return (ledger?.rows ?? []).filter((row) => row.status === "active" && row.kind !== "quote" && row.value !== null).map((row) => ({ fact_id: row.fact_id, label: row.label, plot_value: row.value, unit: row.unit ?? "" }))
}

function readCsv(path) {
	if (!existsSync(path)) return null
	const lines = readFileSync(path, "utf8").split(/\r?\n/).filter((line) => line.trim() !== "")
	const cells = (line) => line.split(",").map((cell) => cell.trim().replace(/^"(.*)"$/, "$1"))
	const head = cells(lines[0] ?? "")
	const [id, value, unit] = ["fact_id", "plot_value", "unit"].map((name) => head.indexOf(name))
	if (id < 0 || value < 0 || unit < 0 || lines.length < 2) return null
	return lines.slice(1).map((line) => cells(line)).map((c) => ({ fact_id: c[id], plot_value: c[value], unit: c[unit] ?? "" }))
}

const walk = (node) => node.children.filter((child) => child.tag !== "#text").flatMap((child) => [child, ...walk(child)])

/** SVG text nodes of a chart: data labels, or ticks with their declared grid. */
function svgLabels(raw) {
	return walk(parseHtml(raw)).filter((node) => node.tag === "text").map((node) => {
		let tick = null
		for (let cur = node.parent; cur && !tick; cur = cur.parent) if (cur.tag === "g" && /(?:^|\s)ticks(?:\s|$)/.test(cur.attrs.class ?? "")) tick = cur.attrs
		return { text: proseText(node), tick }
	})
}

function onGrid(value, tick) {
	const [step, min, max] = [tick["data-tick-step"], tick["data-tick-min"], tick["data-tick-max"]]
	if (![value, step, min, max].every((v) => DECIMAL.test(String(v ?? ""))) || /^-?0+(?:\.0+)?$/.test(step)) return false
	const offset = sub(fromDecimal(value), fromDecimal(min))
	return offset.num >= 0n && sub(fromDecimal(max), fromDecimal(value)).num >= 0n && div(offset, fromDecimal(step)).den === 1n
}

function numerals(text) {
	const out = []
	for (let at = 0, n = parseNumeral(text, 0); n; at = n.span[1], n = parseNumeral(text, at)) out.push(n.value)
	return out
}

function chartFigures(ctx) {
	const charts = new Map()
	for (const fig of ctx.all.filter((node) => node.tag === "figure")) {
		const inner = ctx.util.descendants(fig)
		const labels = inner.filter((node) => node.tag === "svg").flatMap((svg) => svgLabels(svg.raw ?? ""))
		const marked = fig.attrs["data-chart-source"] !== undefined || ctx.util.classTokens(fig).includes("chart")
		if (marked || inner.some((node) => node.tag === "img" && ctx.util.classTokens(node).includes("chart")) || labels.some((label) => /\d/.test(label.text))) charts.set(fig, labels)
	}
	return charts
}

function chartProblem(ctx, fig, labels, ledger) {
	const source = fig.attrs["data-chart-source"]
	if (!source) return "chart figure has no data-chart-source"
	const csv = readCsv(resolve(ctx.baseDir ?? ".", source))
	if (!csv) return `chart data ${source} is missing or lacks fact_id, plot_value, unit columns`
	const exported = new Map(exportRows(ledger).map((row) => [row.fact_id, row]))
	const drift = csv.find((row) => exported.get(row.fact_id)?.plot_value !== row.plot_value || exported.get(row.fact_id)?.unit !== row.unit)
	if (drift) return `chart data row ${drift.fact_id} differs from the ledger export`
	const plotted = (value) => csv.some((row) => sameValue(row.plot_value, value))
	for (const label of labels) {
		const bad = numerals(label.text).find((value) => (label.tick ? !onGrid(value, label.tick) : !plotted(value)))
		if (bad !== undefined) return `${label.tick ? "tick" : "label"} "${label.text}" is not ${label.tick ? "on the declared tick grid" : `a plot_value of ${source}`}`
	}
	const caption = ctx.util.descendants(fig).find((node) => node.tag === "figcaption")
	const stray = numerals(caption ? STRUCTURAL.reduce((text, re) => text.replace(re, " "), proseText(caption)) : "").find((value) => !plotted(value))
	return stray === undefined ? null : `caption numeral ${stray} is not a plot_value of ${source}`
}

/**
 * @param {object} ctx buildContext(...) from gates-static.mjs
 * @param {{ rows: object[] }} ledger
 * @param {{ fact_id: string, rendered: string, selector?: string }[] | null} fillMap Markdown fill map, or null
 * @param {string | null} sourcesDir directory of <S-id>/{text.txt, meta.json} snapshots
 * @param {{ recompute?: (ledger: object, row: object) => { ok: boolean }, asOf?: string | null }} options
 */
export function valueChecks(ctx, ledger, fillMap, sourcesDir, options = {}) {
	const out = []
	const flag = (code, node, message) => out.push(ctx.defect(code, node, message))
	const rows = new Map((ledger?.rows ?? []).map((row) => [row.fact_id, row]))
	const cited = new Map()
	const check = (id, node, problemOf) => {
		const row = rows.get(id)
		if (!row) return flag("unresolved_placeholder", node, `${id} names no ledger row`)
		if (!cited.has(id)) cited.set(id, node)
		const problem = problemOf(row)
		if (problem) flag(problem[0], node, problem[1])
	}
	for (const node of ctx.all.filter((cur) => cur.attrs["data-fact"] !== undefined)) {
		const selector = node.attrs["data-quote-sel"] ?? "full"
		check(node.attrs["data-fact"], node, (row) => (row.kind === "quote" ? quoteProblem(row, withoutFooter(node), selector) : factProblem(row, proseText(node), node.attrs)))
	}
	const docText = bare(proseText(ctx.body))
	for (const entry of fillMap ?? []) {
		check(entry.fact_id, ctx.body, (row) => {
			const problem = row.kind === "quote" ? quoteProblem(row, entry.rendered, entry.selector ?? "full") : factProblem(row, entry.rendered)
			if (problem || docText.includes(bare(entry.rendered))) return problem
			return [row.kind === "quote" ? "quote_not_verbatim" : "value_mismatch", `filled text "${clip(entry.rendered)}" of ${row.fact_id} is no longer in the report`]
		})
	}
	rowChecks(ctx, ledger, rows, cited, options, flag)
	for (const tr of ctx.all.filter((node) => node.tag === "tr" && node.attrs["data-row-kind"] !== "comparison")) {
		const groups = new Set(ctx.util.descendants(tr).map((node) => rows.get(node.attrs["data-fact"])?.observation_id).filter(Boolean))
		if (groups.size > 1) flag("join_integrity_fail", tr, `one table row joins observations ${[...groups].join(", ")}`)
	}
	const meta = sourceChecks(ctx, rows, cited, sourcesDir, flag)
	claimChecks(ctx, rows, (row) => provenance(sourcesDir, meta, row), flag)
	const charts = chartFigures(ctx)
	for (const { node, scope } of ctx.elements) {
		const kind = ctx.kindOf(scope)
		if ((node.tag === "q" || node.tag === "blockquote") && node.attrs["data-fact"] === undefined && kind !== "sources" && kind !== "toc") flag("quote_unbound", node, `<${node.tag}> with no Q row: "${clip(proseText(node))}"`)
	}
	traceChecks(ctx, charts, fillMap, flag, fillSiteFits(rows))
	for (const [fig, labels] of charts) {
		const problem = chartProblem(ctx, fig, labels, ledger)
		if (problem) flag("chart_value_untraceable", fig, problem)
	}
	return out
}

function rowChecks(ctx, ledger, rows, cited, options, flag) {
	// An as-of of "latest ..." or "... per snapshot" names no fixed revision, so quote_stale_version is skipped.
	const asOf = options.asOf && !/^latest\b|per snapshot/i.test(options.asOf) ? options.asOf : null
	for (const [id, node] of cited) {
		const row = rows.get(id)
		if (row.fuzzy === true) flag("quote_fuzzy_match", node, `${id} was registered from a similarity match on an OCR-noisy snapshot`)
		const revision = typeof row.revision === "string" ? row.revision : (row.revision?.id ?? row.revision?.tag ?? null)
		if (asOf && revision && !asOf.includes(revision)) flag("quote_stale_version", node, `${id} is from revision ${revision}; the brief targets "${asOf}"`)
		if ((row.kind === "derived" || row.kind === "converted") && options.recompute?.(ledger, row)?.ok === false) flag("value_mismatch", node, `${id} does not recompute from its operands`)
		const window = row.snapshot_window
		if (window && typeof window === "object" && window.start && window.end) {
			const [start, end] = [Date.parse(window.start), Date.parse(window.end)]
			const outside = (row.operands ?? []).find((op) => !(Date.parse(rows.get(op)?.observed_at) >= start && Date.parse(rows.get(op)?.observed_at) < end))
			if (outside) flag("snapshot_mismatch", node, `operand ${outside} of ${id} was observed outside ${window.start} to ${window.end}`)
		}
	}
}

/** meta.json kind of the snapshot holding the row's own locator artifact; undefined when the artifact is absent or escapes sources/<source_id>/. */
function provenance(sourcesDir, meta, row) {
	const artifact = row.locator?.artifact
	if (!sourcesDir || typeof row.source_id !== "string" || typeof artifact !== "string") return undefined
	const dir = resolve(sourcesDir, row.source_id)
	const path = resolve(dir, artifact)
	return path.startsWith(`${dir}${sep}`) && existsSync(path) ? meta.get(row.source_id)?.kind : undefined
}

function sourceChecks(ctx, rows, cited, sourcesDir, flag) {
	const ids = new Set([...cited.keys()].map((id) => rows.get(id)?.source_id).filter(Boolean))
	for (const match of proseText(ctx.body).matchAll(/\[S(\d+)\]/g)) ids.add(`S${match[1]}`)
	const meta = new Map()
	for (const id of sourcesDir ? ids : []) {
		const [metaPath, textPath] = [join(sourcesDir, id, "meta.json"), join(sourcesDir, id, "text.txt")]
		if (!existsSync(metaPath) || !existsSync(textPath)) continue
		meta.set(id, JSON.parse(readFileSync(metaPath, "utf8")))
		const actual = sha256Of(readFileSync(textPath))
		if (meta.get(id).sha256 !== actual) flag("snapshot_hash_mismatch", ctx.body, `${id}/text.txt changed after its snapshot was pinned`)
	}
	return meta
}
