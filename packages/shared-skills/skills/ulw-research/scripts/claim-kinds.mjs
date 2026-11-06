// claim-kinds.mjs - the claim kinds a report sentence can carry, as one table, CLAIM_KINDS.
//
// A claim kind is structural: the writer marks it in the placeholder ({{V:F12:label}}), fill
// emits it as the data-claim-kind attribute on the element it renders, and the fidelity gate
// (fidelity-claims.mjs) checks that every marked element cites a row the kind accepts. An
// unmarked element is a plain fact or quote and is checked only by the value and quote checks.
// The one lexical piece is `unmarked`: first-person run and check patterns that raise a minor warning
// when a sentence reads like the kind but carries no mark; they never raise a major. The table in
// references/fidelity-claim-kinds.md is rendered from CLAIM_KINDS (`node claim-kinds.mjs --render-doc`).
// Pure; node: builtins only. Korean phrases are \u escapes.

import { isCliEntry } from "./entry-guard.mjs"

export const CLAIM_ATTRIBUTE = "data-claim-kind"

const kind = (entry) => Object.freeze({ ...entry, rowKinds: Object.freeze(entry.rowKinds), sourceKinds: entry.sourceKinds && Object.freeze(entry.sourceKinds), unmarked: entry.unmarked && Object.freeze({ ...entry.unmarked, patterns: Object.freeze(entry.unmarked.patterns) }) })

// Korean pieces as \u escapes: WE_SUBJECT = uri|jeohui as a standalone subject word (+ ga|neun, or " tim-i"),
// WE_RUN = silhaeng-haet/hayeo/hae | dol-lyeot/lyeo, DIRECT = jikjeop, RUN = silhaeng | dol-li/ryeo/ryeot/rin/ril,
// SUBJECT = a word ending in the particle ga|i|eun|neun|kkeseo (a third party ran it, not us).
const KO_WE_SUBJECT = "(?:^|[\\s,.;!?(])(?:\uC6B0\uB9AC|\uC800\uD76C)(?:[\uAC00\uB294]|\\s+\uD300\uC774)\\s+"
const KO_WE_RUN = "(?:\uC2E4\uD589(?:\uD588|\uD558\uC5EC|\uD574)|\uB3CC[\uB838\uB824])"
const KO_RUN = "(?:\uC2E4\uD589|\uB3CC[\uB9AC\uB824\uB838\uB9B0\uB9B4])"
const KO_SUBJECT = "[^\\s,.;!?]*(?:[\uAC00\uC774\uC740\uB294]|\uAED8\uC11C)(?=\\s)"

// One cue list; the rule text below is built from it. A check verb fires only in first person with
// a result object (a result noun or a digit) in its clause, and never when that clause names a document.
// The document guard ends where the clause ends (a comma, a semicolon, "as", a relative pronoun; in Korean a
// comma, a semicolon, cheoreom, deusi, gati), and a document word followed by a number is a locator ("page 3").
const EN_RUN = ["ran", "run", "re-ran", "re-run", "executed", "verified by"]
const EN_CHECK = ["verified", "checked", "confirmed", "measured", "tested", "double-checked", "cross-checked"]
const EN_RESULT = ["value", "values", "result", "results", "figure", "figures", "number", "numbers", "total", "totals", "count", "counts", "measurement", "measurements", "reading", "readings", "output", "outputs", "span", "length", "rate", "rates", "latency", "throughput", "score", "scores", "benchmark", "benchmarks", "metric", "metrics", "data", "estimate", "estimates", "speed", "duration", "size", "ratio", "growth"]
const EN_DOCUMENT = ["report", "reports", "filing", "filings", "document", "documents", "paper", "papers", "article", "articles", "publication", "statement", "disclosure", "website", "page", "docs", "documentation"]
// KO_CHECK = hwagin, geomjeung, cheukjeong, jeomgeom (+ haet/hayeot/hayeo/hae/han); KO_RESULT = gyeolgwa, gap, suchi, gil-i, hapgye,
// biyul, sokdo, jipyo, deiteo; KO_DOCUMENT = bogoseo, munseo, gongsi, nonmun, gisa, jaryo.
const KO_CHECK = ["\uD655\uC778", "\uAC80\uC99D", "\uCE21\uC815", "\uC810\uAC80"]
const KO_DONE = ["\uD588", "\uD558\uC600", "\uD558\uC5EC", "\uD574", "\uD55C"]
const KO_RESULT = ["\uACB0\uACFC", "\uAC12", "\uC218\uCE58", "\uAE38\uC774", "\uD569\uACC4", "\uBE44\uC728", "\uC18D\uB3C4", "\uC9C0\uD45C", "\uB370\uC774\uD130"]
const KO_DOCUMENT = ["\uBCF4\uACE0\uC11C", "\uBB38\uC11C", "\uACF5\uC2DC", "\uB17C\uBB38", "\uAE30\uC0AC", "\uC790\uB8CC"]
const any = (words) => words.map((word) => word.replace(/-/g, "-?").replace(/ /g, "\\s+")).join("|")
const EN_WE = "(?:\\b[Ww]e|\\bI)(?:'ve|'d)?\\s+(?:(?:have|had|also|then|first|just|again|independently|manually|directly)\\s+)*"
const CLAUSE = "(?:[^.;!?]|\\.\\d)*?"
const EN_BOUNDARY = ["as", "which", "who", "whom", "whose", "where"]
const KO_BOUNDARY = ["\uCC98\uB7FC", "\uB4EF\uC774", "\uAC19\uC774"]
const EN_GUARD = `(?:(?!,|\\b(?:${any(EN_BOUNDARY)})\\b)[^.;!?]|\\.\\d)*?`
const KO_GUARD = `(?:(?!,|${any(KO_BOUNDARY)})[^.;!?]|\\.\\d)*?`
const EN_OBJECT = `(?=${CLAUSE}(?:\\b(?:${any(EN_RESULT)})\\b|\\d))(?!${EN_GUARD}\\b(?:${any(EN_DOCUMENT)})\\b(?!\\s*\\d))`
const KO_OBJECT = `(?=${CLAUSE}(?:${any(KO_RESULT)}|\\d))(?!${KO_GUARD}(?:${any(KO_DOCUMENT)})(?!\\s*\\d))`
const escapes = (text) => text.replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`)
const list = (words) => escapes(words.join(", "))

/**
 * kind -> { prefix: placeholder prefix (null = the default form), placeholder: an example,
 *   rowKinds: ledger row kinds it accepts, sourceKinds: meta.json kinds the snapshot holding the
 *   cited row's own locator artifact must have (null = any), defect: code when a marked fact cites a
 *   row it refuses, note: the rule's limits, unmarked: { code, rule, patterns } for an unmarked
 *   sentence that reads like the kind (a minor warning only), or null }.
 */
export const CLAIM_KINDS = Object.freeze({
	fact: kind({
		prefix: null,
		placeholder: "{{F12:label}}",
		rowKinds: ["measured", "converted", "derived"],
		sourceKinds: null,
		defect: "claim_kind_mismatch",
		note: "Accepts exactly what an unmarked numeral accepts, so marking fact is never stricter than not marking. Neither accepts an `assumed` row: an unmarked assumption reads as a fact, so it needs its `{{A:F12:label}}` mark (`claim_kind_mismatch` otherwise).",
		unmarked: null,
	}),
	quote: kind({ prefix: null, placeholder: "{{Q7:label}}", rowKinds: ["quote"], sourceKinds: null, defect: "claim_kind_mismatch", note: "", unmarked: null }),
	verified: kind({
		prefix: "V",
		placeholder: "{{V:F12:label}}",
		rowKinds: ["measured", "quote"],
		sourceKinds: ["command"],
		defect: "unsupported_verification",
		note: "The cited row itself must have a locator artifact inside `sources/<source_id>/` whose `meta.json` kind is `command`; another command row in the sentence never counts. Whether it is the right command for the claim is the meaning verifier's call (minor), not this gate's.",
		unmarked: {
			code: "verification_claim_unmarked",
			rule: `a first-person run: we/I (have) ${list(EN_RUN)} (not ran out of), or by running after we/our in the sentence; a first-person check: we/I (have) ${list(EN_CHECK)} (not checked in/into/out) with a result object in the clause (${list(EN_RESULT)}, or a digit) and no document named before the clause ends (${list(EN_DOCUMENT)}; a comma, a semicolon, or ${list(EN_BOUNDARY)} ends it, and a document word followed by a number is a locator); \\uC6B0\\uB9AC or \\uC800\\uD76C as the subject word (+ \\uAC00, \\uB294, or \\uD300\\uC774), then \\uC2E4\\uD589\\uD588, \\uC2E4\\uD589\\uD558\\uC5EC, \\uC2E4\\uD589\\uD574, \\uB3CC\\uB838, or \\uB3CC\\uB824 in the clause with no third-party subject between, or then ${list(KO_CHECK)} + ${list(KO_DONE)} with a result object in the clause (${list(KO_RESULT)}, or a digit) and no document before the clause ends (${list(KO_DOCUMENT)}; a comma, a semicolon, or ${list(KO_BOUNDARY)} ends it, and a document word followed by a number is a locator); \\uC9C1\\uC811 with no third-party subject, then \\uC2E4\\uD589 or \\uB3CC\\uB9AC in the clause; a curly apostrophe reads as a straight one`,
			patterns: [
				new RegExp(`${EN_WE}(?:${any(EN_RUN)})\\b(?!\\s+out\\s+of\\b)`),
				new RegExp(`${EN_WE}(?:${any(EN_CHECK)})\\b(?!\\s+(?:in|into|out)\\b)${EN_OBJECT}`),
				/\b(?:[Ww]e|[Oo]ur)\b.*?\bby\s+running\b/,
				new RegExp(`${KO_WE_SUBJECT}(?:(?!${KO_SUBJECT})[^\\s,.;!?]+\\s+)*?${KO_WE_RUN}`),
				new RegExp(`${KO_WE_SUBJECT}${KO_OBJECT}(?:(?!${KO_SUBJECT})[^\\s,.;!?]+\\s+)*?(?:${any(KO_CHECK)})(?:${any(KO_DONE)})`),
				new RegExp(`(?:^|[,.;!?])\\s*(?:(?!${KO_SUBJECT})[^\\s,.;!?]+\\s+)*\uC9C1\uC811\\s*(?:[^\\s,.;!?]+\\s*)??${KO_RUN}`),
			],
		},
	}),
	derived: kind({ prefix: "D", placeholder: "{{D:F12:label}}", rowKinds: ["derived", "converted"], sourceKinds: null, defect: "claim_kind_mismatch", note: "", unmarked: null }),
	assumed: kind({
		prefix: "A",
		placeholder: "{{A:F12:label}}",
		rowKinds: ["assumed"],
		sourceKinds: null,
		defect: "claim_kind_mismatch",
		note: "Numeric assumptions only (an assumed ledger row carries a decimal value); a qualitative assumption stays prose.",
		unmarked: null,
	}),
})

/** Whether a row satisfies a claim kind, given the meta.json kind of the snapshot holding its own locator artifact. */
export function claimSatisfied(name, row, sourceKind) {
	const entry = CLAIM_KINDS[name]
	return Boolean(entry && row && entry.rowKinds.includes(row.kind) && (entry.sourceKinds === null || entry.sourceKinds.includes(sourceKind)))
}

/** The kind an unmarked element citing `row` must be marked with (an assumed row needs `assumed`), or null when unmarked is fine. */
export function unmarkedRequires(row) {
	if (!row || ["fact", "quote"].some((name) => CLAIM_KINDS[name].rowKinds.includes(row.kind))) return null
	return Object.keys(CLAIM_KINDS).find((name) => CLAIM_KINDS[name].rowKinds.includes(row.kind)) ?? null
}

/** The kinds whose unmarked patterns match the sentence. */
export function unmarkedKinds(text) {
	return Object.entries(CLAIM_KINDS)
		.filter(([, entry]) => entry.unmarked?.patterns.some((re) => re.test(String(text).replace(/\u2019/g, "'"))))
		.map(([name]) => name)
}

export const CLAIM_TABLE_BEGIN = "<!-- claim-kinds:begin (rendered from CLAIM_KINDS; do not edit by hand) -->"
export const CLAIM_TABLE_END = "<!-- claim-kinds:end -->"

const code = (text) => `\`${text}\``

/** The Markdown table of references/fidelity-claim-kinds.md. */
export function renderClaimKindTable() {
	const head = ["| Kind | Placeholder | Attribute fill emits | Accepted row kinds | Required source kind | Defect when unsatisfied | Unmarked warning | Notes |", "|---|---|---|---|---|---|---|---|"]
	const lines = Object.entries(CLAIM_KINDS).map(([name, entry]) => {
		const attribute = entry.prefix === null ? `none (or ${code(`${CLAIM_ATTRIBUTE}="${name}"`)})` : code(`${CLAIM_ATTRIBUTE}="${name}"`)
		const source = entry.sourceKinds === null ? "any" : entry.sourceKinds.map(code).join(", ")
		const warn = entry.unmarked ? `${code(entry.unmarked.code)} on ${entry.unmarked.rule}` : "none"
		return `| ${code(name)} | ${code(entry.placeholder)} | ${attribute} | ${entry.rowKinds.map(code).join(", ")} | ${source} | ${code(entry.defect)} | ${warn} | ${entry.note || "-"} |`
	})
	return `${[...head, ...lines].join("\n")}\n`
}

if (isCliEntry(import.meta.url)) {
	if (process.argv[2] === "--render-doc" && process.argv.length === 3) process.stdout.write(renderClaimKindTable())
	else {
		process.stderr.write("usage: node claim-kinds.mjs --render-doc\n")
		process.exitCode = 2
	}
}
