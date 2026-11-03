import { describe, expect, test } from "bun:test"

import { LEDGER_SCHEMA_VERSION, ROW_DEFAULTS, validateLedger } from "./fact-ledger-schema.mjs"

function measuredRow(factId: string, label: string) {
	return {
		...structuredClone(ROW_DEFAULTS),
		fact_id: factId,
		kind: "measured",
		value: "320",
		unit: "m",
		raw: "320 m",
		quote: "The span is 320 m.",
		value_span: [12, 15],
		source_id: "S1",
		locator: { artifact: "sources/S1/text.txt", line: 3, char_start: 40, char_end: 62 },
		snapshot_sha256: "a".repeat(64),
		extracted_by: "fact add --find",
		observed_at: "2026-10-23T08:00:00Z",
		label,
		exact: { num: "320", den: "1" },
	}
}

function ledgerOf(...rows: object[]) {
	return { schemaVersion: LEDGER_SCHEMA_VERSION, rows, events: [] }
}

describe("validateLedger (schema module)", () => {
	test("given a complete measured row, when validated, then there are no errors", () => {
		expect(validateLedger(ledgerOf(measuredRow("F1", "span")))).toEqual([])
	})

	test("given two rows with one label, when validated, then the duplicate label is reported", () => {
		const errors = validateLedger(ledgerOf(measuredRow("F1", "span"), measuredRow("F2", "span")))
		expect(errors.some((e: string) => e.includes("duplicate label"))).toBe(true)
	})

	test("given an assumed row without rationale, when validated, then rationale is required", () => {
		const errors = validateLedger(ledgerOf({ ...measuredRow("F1", "span"), kind: "assumed" }))
		expect(errors.some((e: string) => e.includes("rationale"))).toBe(true)
	})
})
