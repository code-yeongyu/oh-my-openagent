import { describe, expect, onTestFinished, test } from "bun:test"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
	LEDGER_FILENAME,
	LEDGER_SCHEMA_VERSION,
	addRow,
	emptyLedger,
	nextId,
	readLedger,
	renderLedgerMarkdown,
	retractRow,
	supersedeRow,
	validateLedger,
	writeLedger,
} from "./fact-ledger.mjs"

const HASH = "a".repeat(64)

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "ulw-ledger-"))
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
	return dir
}

function measured(label: string, value = "320") {
	return {
		kind: "measured",
		value,
		unit: "m",
		raw: `${value} m`,
		quote: `The span is ${value} m.`,
		value_span: [12, 12 + value.length],
		source_id: "S1",
		locator: { artifact: "sources/S1/text.txt", line: 3, char_start: 40, char_end: 62 },
		snapshot_sha256: HASH,
		extracted_by: "fact add --find",
		observed_at: "2026-10-23T08:00:00Z",
		label,
	}
}

function quoteRow(label: string) {
	return { ...measured(label), kind: "quote", value: null, unit: null, value_span: null }
}

function ledgerWith(...rows: object[]) {
	const ledger = emptyLedger()
	for (const row of rows) addRow(ledger, row)
	return ledger
}

describe("validateLedger", () => {
	test("accepts a ledger built by addRow", () => {
		expect(validateLedger(ledgerWith(measured("span"), quoteRow("claim")))).toEqual([])
	})

	test("rejects a row missing label", () => {
		const ledger = ledgerWith(measured("span"))
		delete (ledger.rows[0] as Record<string, unknown>).label
		expect(validateLedger(ledger).some((e: string) => e.includes("label"))).toBe(true)
	})

	test("rejects a duplicate label", () => {
		const ledger = ledgerWith(measured("span"))
		ledger.rows.push({ ...ledger.rows[0], fact_id: "F2" })
		expect(validateLedger(ledger).some((e: string) => e.includes("duplicate label"))).toBe(true)
	})

	test("rejects an assumed row without rationale", () => {
		const ledger = ledgerWith(measured("span"))
		ledger.rows[0].kind = "assumed"
		expect(validateLedger(ledger).some((e: string) => e.includes("rationale"))).toBe(true)
	})

	test("rejects a value row with a non-decimal value", () => {
		const ledger = ledgerWith(measured("span"))
		ledger.rows[0].value = "320m"
		expect(validateLedger(ledger).some((e: string) => e.includes("value"))).toBe(true)
	})

	test("rejects an exact with a non-string num", () => {
		const ledger = ledgerWith(measured("span"))
		ledger.rows[0].exact = { num: 1, den: "3" }
		expect(validateLedger(ledger).some((e: string) => e.includes("exact"))).toBe(true)
	})

	test("rejects operands and derived_from ids with no ledger row", () => {
		const ledger = ledgerWith(measured("span"))
		ledger.rows.push({ ...ledger.rows[0], fact_id: "F2", kind: "derived", label: "ratio", operation: "ratio", operands: ["F9"], derived_from: ["F1", "Q7"] })
		const errors = validateLedger(ledger)
		expect(errors.some((e: string) => e.includes("operands") && e.includes("F9"))).toBe(true)
		expect(errors.some((e: string) => e.includes("derived_from") && e.includes("Q7"))).toBe(true)
		expect(errors.some((e: string) => e.includes("F1"))).toBe(false)
	})

	test("a bare row with only fact_id returns at least three errors", () => {
		expect(validateLedger({ rows: [{ fact_id: "F1" }] }).length).toBeGreaterThanOrEqual(3)
	})
})

describe("ids and status", () => {
	test("nextId sequences F1, F2 then Q1, and a derived row gets F3", () => {
		const ledger = emptyLedger()
		expect(addRow(ledger, measured("a")).fact_id).toBe("F1")
		expect(addRow(ledger, measured("b")).fact_id).toBe("F2")
		expect(addRow(ledger, quoteRow("c")).fact_id).toBe("Q1")
		expect(nextId(ledger, "derived")).toBe("F3")
		const derived = addRow(ledger, {
			kind: "derived",
			value: "0.333",
			unit: null,
			raw: "0.333",
			quote: "",
			extracted_by: "fact derive",
			observed_at: "2026-10-23T08:00:00Z",
			label: "ratio",
			operation: "ratio",
			operands: ["F1", "F2"],
			derived_from: ["F1", "F2"],
			exact: { num: "1", den: "3" },
			formula: "F1 / F2", render: "0.333", precision: { places: 3, sigfigs: 3 }, compatibility: "checked",
		})
		expect(derived.fact_id).toBe("F3")
		expect(nextId(ledger, "quote")).toBe("Q2")
	})

	test("measured rows store exact from their decimal", () => {
		const ledger = ledgerWith(measured("span", "12.50"))
		expect(ledger.rows[0].exact).toEqual({ num: "25", den: "2" })
	})

	test("retractRow keeps the row with status retracted", () => {
		const ledger = ledgerWith(measured("a"), measured("b"))
		retractRow(ledger, "F1", "wrong page")
		expect(ledger.rows).toHaveLength(2)
		expect(ledger.rows[0].status).toBe("retracted")
		expect(ledger.events[0]).toMatchObject({ fact_id: "F1", to: "retracted", reason: "wrong page" })
		expect(validateLedger(ledger)).toEqual([])
		expect(() => retractRow(ledger, "F9", "x")).toThrow()
	})

	test("supersedeRow points at the replacement", () => {
		const ledger = ledgerWith(measured("a"), measured("b"))
		supersedeRow(ledger, "F1", "F2", "newer filing")
		expect(ledger.rows[0].status).toBe("superseded")
		expect(ledger.events[0]).toMatchObject({ fact_id: "F1", replacement: "F2" })
		expect(validateLedger(ledger)).toEqual([])
	})

	test("supersedeRow refuses a replacement that is not active", () => {
		const ledger = ledgerWith(measured("a"), measured("b"))
		retractRow(ledger, "F2", "wrong page")
		expect(() => supersedeRow(ledger, "F1", "F2", "newer filing")).toThrow(/F2 is retracted/)
		expect(ledger.rows[0].status).toBe("active")
		expect(ledger.events).toHaveLength(1)
	})

	test("supersedeRow without a replacement throws and points at retract", () => {
		const ledger = ledgerWith(measured("a"))
		expect(() => supersedeRow(ledger, "F1", null, "newer filing")).toThrow(/supersede F1 needs a replacement row; use retract/)
		expect(ledger.rows[0].status).toBe("active")
		expect(ledger.events).toHaveLength(0)
	})
})

describe("read and write", () => {
	test("write then read round-trips byte-identically", () => {
		const dir = tempDir()
		const ledger = ledgerWith(measured("span"), quoteRow("claim"))
		writeLedger(dir, ledger)
		const first = readFileSync(join(dir, LEDGER_FILENAME), "utf8")
		const loaded = readLedger(dir)
		expect(loaded).toEqual(ledger)
		writeLedger(dir, loaded)
		expect(readFileSync(join(dir, LEDGER_FILENAME), "utf8")).toBe(first)
		expect(readdirSync(dir)).toEqual([LEDGER_FILENAME])
		expect(loaded.schemaVersion).toBe(LEDGER_SCHEMA_VERSION)
	})

	test("a derived row with an exact rational round-trips and validates", () => {
		const dir = tempDir()
		const ledger = ledgerWith(measured("a"), measured("b"))
		addRow(ledger, {
			kind: "derived",
			value: "0.333",
			raw: "0.333",
			quote: "",
			extracted_by: "fact derive",
			observed_at: "2026-10-23T08:00:00Z",
			label: "third",
			operation: "ratio",
			operands: ["F1", "F2"],
			derived_from: ["F1", "F2"],
			exact: { num: "1", den: "3" },
			formula: "F1 / F2", render: "0.333", precision: { places: 3, sigfigs: 3 }, compatibility: "checked",
		})
		writeLedger(dir, ledger)
		const loaded = readLedger(dir)
		expect(loaded.rows[2].exact).toEqual({ num: "1", den: "3" })
		expect(loaded.rows[2].value).toBe("0.333")
		expect(validateLedger(loaded)).toEqual([])
	})

	test("readLedger of a missing file is an empty ledger; writeLedger refuses an invalid one", () => {
		const dir = tempDir()
		expect(readLedger(dir)).toEqual(emptyLedger())
		const ledger = ledgerWith(measured("a"))
		ledger.rows[0].value = "abc"
		expect(() => writeLedger(dir, ledger)).toThrow()
		expect(readdirSync(dir)).toEqual([])
	})

	test("renderLedgerMarkdown lists every row", () => {
		const text = renderLedgerMarkdown(ledgerWith(measured("span"), quoteRow("claim")))
		expect(text).toContain("| F1 | measured | span |")
		expect(text).toContain("| Q1 | quote | claim |")
	})
})

describe("validateLedger checks events against rows", () => {
	test("a retracted event that carries a replacement is an error", () => {
		const ledger = ledgerWith(measured("a"), measured("b"))
		retractRow(ledger, "F1", "wrong page")
		ledger.events[0].replacement = "F2"
		expect(validateLedger(ledger).some((e: string) => /F1 is retracted but names replacement F2/.test(e))).toBe(true)
	})

	test("the last event for a fact must match its row status", () => {
		const ledger = ledgerWith(measured("a"), measured("b"))
		retractRow(ledger, "F1", "wrong page")
		ledger.rows[0].status = "active"
		expect(validateLedger(ledger).some((e: string) => /F1 has status active but its last event moves it to retracted/.test(e))).toBe(true)
	})

	test("a non-active row with no event is an error", () => {
		const ledger = ledgerWith(measured("a"))
		ledger.rows[0].status = "superseded"
		expect(validateLedger(ledger).some((e: string) => /F1 is superseded but has no status event/.test(e))).toBe(true)
	})

	test("an event with an invalid from or to status is an error naming the fact", () => {
		const ledger = ledgerWith(measured("a"))
		retractRow(ledger, "F1", "wrong page")
		ledger.events[0].from = "gone"
		const errors = validateLedger(ledger)
		expect(errors.some((e: string) => /events\[0\]: F1 is active, but the event moves it from gone/.test(e))).toBe(true)
		ledger.events[0].from = "active"
		ledger.events[0].to = "active"
		expect(validateLedger(ledger).some((e: string) => /events\[0\]: F1 cannot move from active to active/.test(e))).toBe(true)
	})
})
