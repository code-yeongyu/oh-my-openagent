import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { FILL_INPUT_FORMAT_RULES, FILL_INPUT_FORMATS } from "./fact-commands-fill.mjs"
import { KIND_RULES } from "./fact-ledger-kinds.mjs"
import { FILL_FORMATS } from "./fact-fill.mjs"
import { meaningCheckEnabled as briefMeaningCheckEnabled } from "./fidelity-brief.mjs"
import { FIDELITY_VALUE_RULES, meaningCheckEnabled, parseSourceFloor, policyErrors, SOURCE_FLOOR_RULES, sourceInsideFloor } from "./fidelity-policy.mjs"

type PolicyRow = { fact_id: string; kind: string; status: string; source_id: string | null; operands: string[]; derived_from: string[] }
const policyRow = (fact_id: string, kind: string, source_id: string | null, operands: string[] = []): PolicyRow => ({ fact_id, kind, status: "active", source_id, operands, derived_from: [] })

/** policyErrors over one placeholder per row id under a parsed floor, as code and message pairs. */
function floorRefusals(rows: PolicyRow[], ids: string[], floor: ReturnType<typeof parseSourceFloor>) {
	const found = ids.map((id, index) => ({ token: `{{${id}}}`, start: index, parsed: { id } }))
	const refused = policyErrors(ids.map((id) => `{{${id}}}`).join(""), found, { rows }, tmpdir(), { derivedNone: false, floor })
	return refused.errors.map((error: { code: string; message: string }) => [error.code, error.message])
}

const referenceValues = async (field: string) => {
	const row = (await Bun.file(REFERENCE).text()).split("\n").find((line) => line.startsWith(`| \`${field}\` |`)) ?? ""
	return [...(row.split("|")[2] ?? "").matchAll(/`([^`]+)`/gu)].map((match) => match[1])
}
import { pointedFlag } from "./source-commands.mjs"

const REFERENCE = join(import.meta.dir, "..", "references", "deliverable-phase.md")

function briefWithFloor(floor: string) {
	const dir = mkdtempSync(join(tmpdir(), "policy-registry-"))
	const lines = ["as of: latest at run start, 2026-10-23", "meaning check: on", `source floor: ${floor}`, "derived numbers: allowed", "languages: report en; sources en; quotes original", "identifier classes: none", "fallback: block-quote"]
	writeFileSync(join(dir, "brief.md"), `## Fidelity\n${lines.map((line) => `${line} (answered_by: default)`).join("\n")}\n`)
	return dir
}

const floorOf = (text: string) => {
	const parsed = parseSourceFloor(text)
	if (parsed === null) throw new Error(`parseSourceFloor(${text}) read no floor`)
	return parsed
}

const derivedRefusal = (kind: string) => {
	const row = { fact_id: "F1", kind, status: "active", source_id: null, operands: [], derived_from: [] }
	const found = [{ token: "{{F1}}", start: 0, parsed: { id: "F1" } }]
	const refused = policyErrors("{{F1}}", found, { rows: [row] }, tmpdir(), { derivedNone: true, floor: null })
	return refused.errors.some((error: { code: string }) => error.code === "derived_not_allowed")
}

describe("fidelity-policy registry: copies must not return", () => {
	test("#given every ledger kind #when derived numbers none refuses #then policyErrors agrees with FIDELITY_VALUE_RULES and assumed is refused", () => {
		const kinds = Object.keys(KIND_RULES)
		for (const kind of kinds) expect({ kind, refused: derivedRefusal(kind) }).toEqual({ kind, refused: FIDELITY_VALUE_RULES.derivedRefused(kind) })
		for (const kind of FIDELITY_VALUE_RULES.derivedKinds) expect(kinds).toContain(kind)
		expect(FIDELITY_VALUE_RULES.derivedRefused("assumed")).toBe(true)
	})

	test("#given each source floor form #when parsed #then the rule matches the registry and an unknown form is a usage error", () => {
		expect(parseSourceFloor("standard")).toBeNull()
		expect(parseSourceFloor("Primary Only")).toEqual({ kind: "primary" })
		expect(parseSourceFloor("pointed only: S4, https://a.example/x")).toEqual({ kind: "pointed", list: ["S4", "https://a.example/x"] })
		expect(parseSourceFloor("classes: example.com, gov.uk")).toEqual({ kind: "classes", list: ["example.com", "gov.uk"] })
		for (const rule of SOURCE_FLOOR_RULES) expect(Object.isFrozen(rule)).toBe(true)
		expect(() => parseSourceFloor("only nice sources")).toThrow(/source floor/)
	})

	test("#given pointed and classes floors #when evaluated #then ids, urls, hosts, and suffixes match and notexample.com does not", () => {
		const pointed = floorOf("pointed only: S4, https://a.example/x")
		expect(sourceInsideFloor(pointed, "S4", { url: null })).toBe(true)
		expect(sourceInsideFloor(pointed, "S9", { url: "https://a.example/x" })).toBe(true)
		expect(sourceInsideFloor(pointed, "S9", { url: "https://a.example/y" })).toBe(false)
		const classes = floorOf("classes: example.com")
		for (const [url, inside] of [["https://example.com/a", true], ["https://docs.example.com/a", true], ["https://notexample.com/a", false], [null, false]] as const) {
			expect({ url, inside: sourceInsideFloor(classes, "S1", { url }) }).toEqual({ url, inside })
		}
		expect(sourceInsideFloor({ kind: "primary" }, "S1", { provenance: "primary" })).toBe(true)
		expect(sourceInsideFloor({ kind: "primary" }, "S1", { provenance: "secondary" })).toBe(false)
	})

	test("#given a brief floor #when pointedFlag reads it #then it agrees with parseSourceFloor for every form", () => {
		const url = "https://a.example/x"
		for (const floor of ["pointed only: S4, https://a.example/x", "pointed only: S4", "standard", "primary only", "classes: a.example"]) {
			const dir = briefWithFloor(floor)
			try {
				const rule = (() => {
					try {
						return parseSourceFloor(floor)
					} catch {
						return null
					}
				})()
				expect({ floor, flag: pointedFlag(dir, url) }).toEqual({ floor, flag: rule?.kind === "pointed" && rule.list.includes(url) })
			} finally {
				rmSync(dir, { recursive: true, force: true })
			}
		}
	})

	test("#given a malformed or pending floor #when pointedFlag reads it #then malformed is a usage error and pending is not pointed", () => {
		const malformed = briefWithFloor("not a floor")
		const pending = mkdtempSync(join(tmpdir(), "policy-registry-"))
		writeFileSync(join(pending, "brief.md"), "## Fidelity\nsource floor: pending (answered_by: pending)\n")
		try {
			expect(() => pointedFlag(malformed, "https://a.example/x")).toThrow(/source floor "not a floor"/)
			expect(pointedFlag(pending, "https://a.example/x")).toBe(false)
		} finally {
			for (const dir of [malformed, pending]) rmSync(dir, { recursive: true, force: true })
		}
	})

	test("#given derived numbers and fallback values #when read #then only their table values pass, any case, and anything else names field and value", () => {
		expect(["none", "None", " none "].map((value) => FIDELITY_VALUE_RULES.derivedNone(value))).toEqual([true, true, true])
		expect(["allowed", "Allowed"].map((value) => FIDELITY_VALUE_RULES.derivedNone(value))).toEqual([false, false])
		for (const value of ["nope", "no", "n/a", "none.", "measured only"]) expect(() => FIDELITY_VALUE_RULES.derivedNone(value)).toThrow(`derived numbers "${value}" is not allowed, none`)
		expect(["block-quote", "Omit"].map((value) => FIDELITY_VALUE_RULES.fallback(value))).toEqual(["quote", "omit"])
		for (const value of ["drop", "omit sentence", "quote"]) expect(() => FIDELITY_VALUE_RULES.fallback(value)).toThrow(`fallback "${value}" is not block-quote, omit`)
	})

	test("#given the deliverable reference #when its derived numbers and fallback rows are read #then they name exactly the registry tables", async () => {
		for (const [field, table] of Object.entries(FIDELITY_VALUE_RULES.tables)) expect({ field, values: await referenceValues(field) }).toEqual({ field, values: Object.keys(table) })
		expect(Object.keys(FIDELITY_VALUE_RULES.tables)).toEqual(["derived numbers", "fallback"])
	})

	test("#given sourceless rows #when judged under a strict floor and under standard #then strict refuses each, a derived row over one included, and standard refuses none", () => {
		const rows = [policyRow("F1", "measured", "S1"), policyRow("A1", "assumed", null), policyRow("D1", "derived", null, ["F1", "A1"]), policyRow("D2", "derived", null, ["F9"])]
		const ids = ["F1", "A1", "D1", "D2"]
		expect(floorRefusals(rows, ids, floorOf("pointed only: S1"))).toEqual([
			["source_outside_floor", "A1 rests on no source, outside the source floor"],
			["source_outside_floor", "D1 rests on no source, outside the source floor"],
			["source_outside_floor", "D2 rests on no source, outside the source floor"],
		])
		expect(floorRefusals(rows, ids, parseSourceFloor("standard"))).toEqual([])
	})

	test("#given the meaning check value rule #when read through the policy or the brief #then both are the same function", () => {
		expect(meaningCheckEnabled).toBe(briefMeaningCheckEnabled)
		for (const value of ["on", "off", "Off", "on; force strong: money", "offline"]) {
			expect({ value, on: FIDELITY_VALUE_RULES.meaningCheck(value) }).toEqual({ value, on: meaningCheckEnabled({ fields: { "meaning check": value } }) })
		}
	})

	test("#given the fill input vocabulary #when derived #then every input maps to a FILL_FORMATS member and every output format is reachable", () => {
		const target = (format: string) => (FILL_INPUT_FORMAT_RULES.aliases as Record<string, string>)[format] ?? format
		for (const format of FILL_INPUT_FORMATS) expect(FILL_FORMATS as readonly string[]).toContain(target(format))
		for (const format of FILL_FORMATS) expect(FILL_INPUT_FORMATS as readonly string[]).toContain(format)
		for (const format of Object.values(FILL_INPUT_FORMAT_RULES.extensions)) expect(FILL_INPUT_FORMATS as readonly string[]).toContain(format)
		expect(FILL_INPUT_FORMAT_RULES.aliases).toEqual({ tex: "md" })
	})

	test("#given the deliverable reference #when its source floor row is read #then it names exactly the SOURCE_FLOOR_RULES forms", async () => {
		const row = (await Bun.file(REFERENCE).text()).split("\n").find((line) => line.startsWith("| `source floor` |")) ?? ""
		const values = row.split("|")[2] ?? ""
		const forms = [...values.matchAll(/`([^`]+)`/gu)].map((match) => match[1])
		expect(forms).toEqual(SOURCE_FLOOR_RULES.map((rule) => rule.form))
	})
})
