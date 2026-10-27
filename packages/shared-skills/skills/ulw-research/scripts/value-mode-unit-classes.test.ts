import { describe, expect, test } from "bun:test"

import { valueChecks } from "./fidelity-values.mjs"
import { buildContext } from "./gates-static.mjs"
import { parseHtml } from "./html-lite.mjs"
import { escapeHtml } from "./placeholder.mjs"
import { F1, codes, filled, prose } from "./tests/value-mode-support"
import { dimensionOf, normalizeUnit } from "./units.mjs"

// One table per class of value-mode unit reading; every row is { input, expected } and a run lists every row that
// disagrees. Korean text is written as \u escapes (romanized in the comments).
type Verdict = "pass" | "unit_mismatch" | "unit_unbound"
const verdictOf = (found: string[]): Verdict => (found.includes("unit_mismatch") ? "unit_mismatch" : found.includes("unit_unbound") ? "unit_unbound" : "pass")

// Hand-written oracle: every alias units.mjs accepts, by canonical token (internal scale tokens such as e3 omitted).
const ALIASES: [string, string[]][] = [
	["mm", ["mm", "millimeter", "millimeters", "millimetre", "millimetres", "\uBC00\uB9AC\uBBF8\uD130"]],
	["cm", ["cm", "centimeter", "centimeters", "centimetre", "centimetres", "\uC13C\uD2F0\uBBF8\uD130"]],
	["m", ["m", "meter", "meters", "metre", "metres", "\uBBF8\uD130"]],
	["km", ["km", "kilometer", "kilometers", "kilometre", "kilometres", "\uD0AC\uB85C\uBBF8\uD130"]],
	["g", ["g", "gram", "grams", "\uADF8\uB7A8"]],
	["kg", ["kg", "kilogram", "kilograms", "\uD0AC\uB85C\uADF8\uB7A8"]],
	["t", ["t", "ton", "tons", "tonne", "tonnes", "\uD1A4"]],
	["ms", ["ms", "millisecond", "milliseconds", "\uBC00\uB9AC\uCD08"]],
	["s", ["s", "sec", "secs", "second", "seconds", "\uCD08"]],
	["min", ["min", "mins", "minute", "minutes", "\uBD84"]],
	["h", ["h", "hr", "hrs", "hour", "hours", "\uC2DC\uAC04"]],
	["B", ["B", "byte", "bytes", "\uBC14\uC774\uD2B8"]],
	["KB", ["KB", "\uD0AC\uB85C\uBC14\uC774\uD2B8"]],
	["MB", ["MB", "\uBA54\uAC00\uBC14\uC774\uD2B8"]],
	["GB", ["GB", "\uAE30\uAC00\uBC14\uC774\uD2B8"]],
	["TB", ["TB", "\uD14C\uB77C\uBC14\uC774\uD2B8"]],
	["C", ["C", "\u00B0C", "\u2103", "celsius", "\uC12D\uC528"]],
	["F", ["F", "\u00B0F", "\u2109", "fahrenheit", "\uD654\uC528"]],
	["%", ["%", "percent", "\uD37C\uC13C\uD2B8", "\uD504\uB85C"]],
	["\u2030", ["\u2030", "permille", "\uD37C\uBC00"]],
	["%p", ["%p", "pp", "%pt", "percentage point", "percentage points", "percent point", "percent points", "% point", "% points", "\uD37C\uC13C\uD2B8\uD3EC\uC778\uD2B8", "%\uD3EC\uC778\uD2B8"]],
	["x", ["x", "\u00D7", "times", "\uBC30"]],
	["e3", ["k", "thousand", "\uCC9C"]],
	["e4", ["\uB9CC"]],
	["e6", ["M", "million", "\uBC31\uB9CC"]],
	["e8", ["\uC5B5"]],
	["e9", ["bn", "billion", "\uC2ED\uC5B5"]],
	["e12", ["trillion", "\uC870"]],
	["person", ["person", "persons", "people", "\uBA85"]],
	["case", ["case", "cases", "\uAC74"]],
	["KRW", ["KRW", "\uC6D0", "\u20A9", "won"]],
	["KRW-e3", ["\uCC9C\uC6D0"]],
	["KRW-e4", ["\uB9CC\uC6D0"]],
	["KRW-e8", ["\uC5B5\uC6D0"]],
	["KRW-e12", ["\uC870\uC6D0"]],
	["USD", ["USD", "$", "US$", "dollar", "dollars", "\uB2EC\uB7EC"]],
	["EUR", ["EUR", "\u20AC", "euro", "euros", "\uC720\uB85C"]],
	["JPY", ["JPY", "\u00A5", "yen", "\uC5D4"]],
	["GBP", ["GBP", "\u00A3", "pound", "pounds", "\uD30C\uC6B4\uB4DC"]],
]
// i, ga, eun, neun, eul, reul, ui, gwa, wa, ro, euro, e, eseo, do, man, buteo, kkaji.
const PARTICLES = ["\uC774", "\uAC00", "\uC740", "\uB294", "\uC744", "\uB97C", "\uC758", "\uACFC", "\uC640", "\uB85C", "\uC73C\uB85C", "\uC5D0", "\uC5D0\uC11C", "\uB3C4", "\uB9CC", "\uBD80\uD130", "\uAE4C\uC9C0"]
// chogwa, isang, miman, iha, jeongdo, garyang, jjeum: written glued after a unit.
const GLUED_QUALIFIERS = ["\uCD08\uACFC", "\uC774\uC0C1", "\uBBF8\uB9CC", "\uC774\uD558", "\uC815\uB3C4", "\uAC00\uB7C9", "\uCBE4"]
// The same plus gwaban (majority) and yak (about): whole words standing alone after the value.
const QUALIFIER_WORDS = [...GLUED_QUALIFIERS, "\uACFC\uBC18", "\uC57D"]
const CHOGWA = "\uCD08\uACFC"
const ORDINARY = new Set(["won", "second", "pound", "pounds"])

const element = (unit: string) => `<data class="fact" value="320" data-fact="F1" data-unit="${escapeHtml(unit)}" data-fact-mode="value">320</data>`
/** valueChecks over a Findings section holding one value-mode element of a row in `unit`. */
function readHtml(html: string, unit: string): Verdict {
	const ledger = { rows: [{ ...F1, unit, raw: `320 ${unit}` }] }
	return verdictOf((valueChecks(buildContext(parseHtml(`<h2>Findings</h2>${html}`), {}), ledger, null, null) as { code: string }[]).map((d) => d.code))
}
/** The same element with `after` written right after it. */
const readAfter = (after: string, unit: string) => readHtml(`<p>Up to ${element(unit)}${escapeHtml(after)} [S4].</p>`, unit)

type Case = { input: string; unit: string; expected: Verdict }
function tokenizationCases(): Case[] {
	const cases: Case[] = []
	for (const [token, aliases] of ALIASES) {
		const other = dimensionOf(token) === "length" ? "KRW" : "m"
		for (const alias of aliases) {
			const suffixes = [...["", ...PARTICLES].flatMap((p) => [` ${alias}${p}`, `${alias}${p}`]), ...GLUED_QUALIFIERS.map((q) => ` ${alias}${q}`)]
			for (const input of suffixes) {
				const qualifier = input.trim() === CHOGWA
				cases.push({ input, unit: token, expected: qualifier ? "unit_unbound" : "pass" })
				cases.push({ input, unit: other, expected: qualifier || ORDINARY.has(alias) ? "unit_unbound" : "unit_mismatch" })
			}
		}
	}
	for (const word of QUALIFIER_WORDS) cases.push({ input: ` ${word}`, unit: "m", expected: "unit_unbound" }, { input: ` m ${word}`, unit: "m", expected: "pass" }, { input: ` mm ${word}`, unit: "m", expected: "unit_mismatch" })
	// English words that collide with unit aliases or read like them; "3 bun-ui 1" is a fraction, not minutes.
	const words: [string, string, Verdict][] = [
		[" in total", "m", "unit_unbound"], [" a year", "m", "unit_unbound"], [" or more", "m", "unit_unbound"], [" or less", "m", "unit_unbound"],
		[" min", "min", "pass"], [" min", "m", "unit_mismatch"], [" sec", "s", "pass"], [" sec", "m", "unit_mismatch"], [" SEC filings", "m", "unit_unbound"],
		[" second", "m", "unit_unbound"], [" second", "s", "pass"], [" won awards", "person", "unit_unbound"], [" won", "KRW", "pass"],
		[" pound", "m", "unit_unbound"], [" times", "x", "pass"], [" times", "m", "unit_mismatch"],
		["\uBD84\uC758 1", "%", "unit_unbound"], ["\uBD84\uC758 1", "min", "unit_unbound"], [" (m)", "m", "pass"], [" (mm)", "m", "unit_mismatch"], [" (approx.)", "m", "unit_unbound"],
	]
	for (const [input, unit, expected] of words) cases.push({ input, unit, expected })
	return cases
}

describe("class 1: the unit token written after a value", () => {
	test("#given every alias with every particle and qualifier, and the colliding words #when read #then each row gets its expected verdict", () => {
		const cases = tokenizationCases()
		for (const [token, aliases] of ALIASES) for (const alias of aliases) expect([alias, normalizeUnit(alias)]).toEqual([alias, token])
		const wrong = cases.map((row) => ({ ...row, actual: readAfter(row.input, row.unit) })).filter((row) => row.actual !== row.expected)
		expect(cases.length).toBeGreaterThan(9000)
		expect(wrong).toEqual([])
	}, 120000)
})

type Form = { name: string; format: "html" | "md"; body: string; at: (unit: string) => string; units: [same: string, known: string, unknown: string] }
const m3: [string, string, string] = ["m", "mm", "ft"]
const P = "{{F1:span_len:value}}"
const head = (th: string) => `<h2>Findings</h2><table><thead><tr><th>${th}</th></tr></thead><tbody><tr><td>${P}</td></tr></tbody></table>`
const FORMS: Form[] = [
	{ name: "glued", format: "html", body: prose(P, "m"), at: (u) => `</data>${u} [S4]`, units: m3 },
	{ name: "spaced", format: "html", body: prose(P, " m"), at: (u) => `</data> ${u} [S4]`, units: m3 },
	...["b", "span", "em", "code"].map((tag): Form => ({ name: `wrapped in ${tag}`, format: "html", body: prose(P, ` <${tag}>m</${tag}>`), at: (u) => `</data> <${tag}>${u}</${tag}>`, units: m3 })),
	{ name: "parenthesized", format: "html", body: prose(P, " (m)"), at: (u) => `</data> (${u})`, units: m3 },
	{ name: "after a line break", format: "html", body: prose(P, "\nm"), at: (u) => `</data>\n${u} [S4]`, units: m3 },
	{ name: "after a br", format: "html", body: prose(P, "<br>m"), at: (u) => `</data><br>${u} [S4]`, units: m3 },
	{ name: "header-bound column", format: "html", body: head("Span (m)"), at: (u) => `<th>Span${u ? ` (${u})` : ""}</th>`, units: m3 },
	{ name: "currency sign before", format: "html", body: prose("${{F23:price:value}}", ""), at: (u) => `Up to ${u}<data`, units: ["$", "\u20AC", "Rs"] },
	...([["glued", "m"], ["spaced", " m"], ["parenthesized", " (m)"], ["after a line break", "\nm"]] as const).map(([name, tail]): Form => ({ name: `md ${name}`, format: "md", body: `## Findings\n\nUp to ${P}${tail} [S4].`, at: (u) => `320${tail.replace("m", u)} [S4]`, units: m3 })),
]

describe("class 2: a unit hand-edited after fill", () => {
	test("#given every form a bound unit takes #when it is kept, changed to a known or unknown unit, or deleted, with and without data-fact-mode #then each row gets its expected verdict", async () => {
		const rows: { form: string; edit: string; attr: string; expected: Verdict; actual?: Verdict; exit?: number }[] = []
		for (const form of FORMS) {
			const { verify, text, write } = await filled(form.body, form.format)
			const [same, known, unknown] = form.units
			expect(text).toContain(form.at(same))
			for (const [edit, unit, expected] of [["kept", same, "pass"], ["known", known, "unit_mismatch"], ["unknown", unknown, "unit_mismatch"], ["deleted", "", "unit_mismatch"]] as const) {
				for (const attr of form.format === "html" ? ["kept", "deleted"] : ["n/a"]) {
					const edited = text.replace(form.at(same), form.at(unit))
					write(attr === "deleted" ? edited.replace(' data-fact-mode="value"', "") : edited)
					const result = await verify()
					rows.push({ form: form.name, edit, attr, expected, actual: verdictOf(codes(result)), exit: result.exitCode })
				}
			}
		}
		for (const [name, body, edit, expected] of [["no unit at fill", prose(P, " long"), ["</data> long", "</data> long"], "unit_unbound"], ["no unit at fill, mm added", prose(P, " long"), ["</data> long", "</data> mm long"], "unit_mismatch"], ["unknown unit at fill", prose(P, " ft"), ["</data> ft", "</data> ft"], "unit_unbound"], ["unknown unit at fill, m written", prose(P, " ft"), ["</data> ft", "</data> m"], "pass"]] as const) {
			const { verify, text, write } = await filled(body)
			write(text.replace(edit[0], edit[1]))
			const result = await verify()
			rows.push({ form: name, edit: "as named", attr: "kept", expected, actual: verdictOf(codes(result)), exit: result.exitCode })
		}
		const wrong = rows.filter((row) => row.actual !== row.expected || row.exit !== (row.expected === "unit_mismatch" ? 1 : 0))
		expect(rows.length).toBe(FORMS.filter((f) => f.format === "html").length * 8 + FORMS.filter((f) => f.format === "md").length * 4 + 4)
		expect(wrong).toEqual([])
	}, 120000)
})

// Class 3: unit prefix shadowing. Every pair of aliases of different units where one (spaces removed) starts the other
// ("%" / "%p", "m" / "mm" / "min", "k" / "km", "M" / "MB", cheon / cheon-won, peosenteu / peosenteu pointeu) and every alias that
// starts a qualifier word (cho / chogwa). The longer unit is read whole, never as its prefix.
const squashed = (alias: string) => alias.replace(/\s+/g, "")
const LETTERS = /^[A-Za-z]+$/
const scaleOf = (unit: string) => /-(e\d+)$/.exec(unit)?.[1] ?? null
type Pair = { short: string; shortUnit: string; long: string; longUnit: string }
function prefixPairs(): Pair[] {
	const all = ALIASES.flatMap(([token, aliases]) => aliases.map((alias) => ({ alias, token })))
	const longer = (short: string, long: string) => squashed(long) !== squashed(short) && squashed(long).startsWith(squashed(short))
	return all.flatMap((s) => all.filter((l) => l.token !== s.token && longer(s.alias, l.alias)).map((l) => ({ short: s.alias, shortUnit: s.token, long: l.alias, longUnit: l.token })))
}
function prefixCases(): Case[] {
	const cases: Case[] = []
	const add = (input: string, unit: string, expected: Verdict) => cases.push({ input, unit, expected })
	for (const { short, shortUnit, long, longUnit } of prefixPairs()) {
		// A scale word alone agrees with a scaled currency row (the currency may be a sign, "$12 million"): cheon under a cheon-won row.
		const scaleOnly = dimensionOf(shortUnit) === "scale" && scaleOf(longUnit) === shortUnit
		for (const gap of ["", " "]) {
			add(`${gap}${short}`, shortUnit, "pass")
			add(`${gap}${long}`, shortUnit, "unit_mismatch")
			add(`${gap}${short}`, longUnit, scaleOnly ? "pass" : "unit_mismatch")
			add(`${gap}${long}`, longUnit, "pass")
		}
		if (/\s/.test(long)) continue
		// Split at the prefix: English words stay apart ("m in" is m, then in); a symbol or Hangul joins ("% p", cheon won).
		const rest = squashed(long).slice(squashed(short).length)
		const english = LETTERS.test(short) && LETTERS.test(rest)
		add(` ${short} ${rest}`, shortUnit, english ? "pass" : "unit_mismatch")
		add(` ${short} ${rest}`, longUnit, english ? "unit_mismatch" : "pass")
	}
	for (const [token, aliases] of ALIASES) for (const alias of aliases) for (const word of [...QUALIFIER_WORDS, "\uB0B4\uC678", "\uAE4C\uC9C0"]) {
		if (word !== alias && word.startsWith(alias)) for (const gap of ["", " "]) add(`${gap}${word}`, token, "unit_unbound")
	}
	return cases
}

// An ordinary word that is also a unit ("pounds", "won", "second") is read when a sign or header binds a unit of its kind.
const SIGNED: [html: string, unit: string, expected: Verdict][] = [
	["<p>Up to ${V} pounds [S4].</p>", "USD", "unit_mismatch"], ["<p>Up to ${V} pound [S4].</p>", "USD", "unit_mismatch"], ["<p>Up to ${V} won [S4].</p>", "USD", "unit_mismatch"],
	["<p>Up to \u20AC{V} pounds [S4].</p>", "EUR", "unit_mismatch"], ["<p>Up to \u20A9{V} pounds [S4].</p>", "KRW", "unit_mismatch"], ["<p>Up to \u00A3{V} pounds [S4].</p>", "GBP", "pass"],
	["<p>Up to ${V} SEC filings [S4].</p>", "USD", "pass"], ["<p>Up to ${V} second [S4].</p>", "USD", "pass"], ["<p>Up to {V} pounds [S4].</p>", "USD", "unit_unbound"],
	["<table><thead><tr><th>Cost ($)</th></tr></thead><tbody><tr><td>{V} pounds</td></tr></tbody></table>", "USD", "unit_mismatch"],
	["<table><thead><tr><th>Time (min)</th></tr></thead><tbody><tr><td>{V} second</td></tr></tbody></table>", "min", "unit_mismatch"],
	["<table><thead><tr><th>Span (m)</th></tr></thead><tbody><tr><td>{V} second</td></tr></tbody></table>", "m", "pass"],
]

describe("class 3: a longer unit that starts with a shorter one", () => {
	test("#given every prefix pair of aliases, spaced, glued and split, and the signed ordinary words #when read #then each row gets its expected verdict", () => {
		const pairs = prefixPairs().map((p) => `${p.short}/${p.long}`)
		for (const pair of ["%/%p", "%/%\uD3EC\uC778\uD2B8", "\uD37C\uC13C\uD2B8/\uD37C\uC13C\uD2B8\uD3EC\uC778\uD2B8", "percent/percent points", "m/mm", "m/min", "k/km", "M/MB", "\uCC9C/\uCC9C\uC6D0"]) expect(pairs).toContain(pair)
		const rows = [...prefixCases().map((row) => ({ ...row, actual: readAfter(row.input, row.unit) })), ...SIGNED.map(([html, unit, expected]) => ({ input: html, unit, expected, actual: readHtml(html.replace("{V}", element(unit)), unit) }))]
		expect(rows.filter((row) => row.actual !== row.expected)).toEqual([])
	}, 120000)
})
