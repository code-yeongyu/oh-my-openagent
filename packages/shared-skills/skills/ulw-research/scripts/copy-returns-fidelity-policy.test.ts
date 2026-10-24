import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { FILL_INPUT_FORMAT_RULES, FILL_INPUT_FORMATS } from "./fact-commands-fill.mjs"
import { KIND_RULES } from "./fact-ledger-kinds.mjs"
import { FILL_FORMATS } from "./fact-fill.mjs"
import { meaningCheckEnabled as briefMeaningCheckEnabled } from "./fidelity-brief.mjs"
import { FIDELITY_VALUE_RULES, meaningCheckEnabled, parseSourceFloor, policyErrors, SOURCE_FLOOR_RULES, sourceInsideFloor } from "./fidelity-policy.mjs"
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
		for (const floor of ["pointed only: S4, https://a.example/x", "pointed only: S4", "standard", "primary only", "classes: a.example", "not a floor"]) {
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
