import { expect, test } from "bun:test"
import { recompute } from "../fact-derive.mjs"
import { derive } from "./derive-clock"
import { addRow, emptyLedger, retractRow, validateLedger } from "../fact-ledger.mjs"
import { canonicalUnit } from "../unit-rules.mjs"
import { convertFactor } from "../units.mjs"


type Row = Record<string, unknown>

type Book = { schemaVersion: number; rows: Row[]; events: unknown[] }

const now = "2026-10-23T08:00:00Z"

function book(values: string[] = ["1", "3"], units: Array<string | null> = ["m", "m"], extras: Row[] = []): Book {
	const ledger = emptyLedger() as Book
	values.forEach((value, i) => addRow(ledger, {
		kind: "measured", value, unit: units[i], raw: value, quote: value, source_id: "S1",
		locator: { artifact: "sources/S1/text.txt", char_start: 0, char_end: 1 },
		snapshot_sha256: "a".repeat(64), extracted_by: "test", observed_at: now, label: `f${i + 1}`,
		...extras[i],
	}))
	return ledger
}

function row(ledger: Book, spec: Row): Row {
	const result = derive(ledger, { ...spec, now })
	if (!("row" in result)) throw Error(JSON.stringify(result))
	return result.row as Row
}

const sum = { op: "sum", operands: ["F1", "F2"], unit: "m" }

function refused(ledger: Book, spec: unknown) {
	const before = structuredClone(ledger)
	const result = derive(ledger, spec)
	expect(result).toMatchObject({ error: "incompatible_operands" })
	expect(ledger).toEqual(before)
	return result
}
export { Row, Book, now, book, row, sum, refused }
