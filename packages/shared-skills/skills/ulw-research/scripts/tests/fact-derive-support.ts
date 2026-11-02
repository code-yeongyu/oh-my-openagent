import { describe, expect, onTestFinished, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { recompute } from "../fact-derive.mjs"
import { derive } from "./derive-clock"
import { addRow, emptyLedger, readLedger, writeLedger } from "../fact-ledger.mjs"


const HASH = "a".repeat(64)

const EOK_WON = "\uC5B5\uC6D0"


type Row = Record<string, unknown>

type Ledger = { schemaVersion: number; rows: Row[]; events: unknown[] }


function measured(factId: string, value: string, unit: string, extra: Row = {}): Row {
	return {
		fact_id: factId,
		kind: "measured",
		value,
		unit,
		raw: `${value} ${unit}`,
		quote: `The figure is ${value} ${unit}.`,
		source_id: "S1",
		locator: { artifact: "sources/S1/text.txt", char_start: 0, char_end: 20 },
		snapshot_sha256: HASH,
		extracted_by: "fact add --find",
		observed_at: "2026-10-23T08:00:00Z",
		label: factId.toLowerCase(),
		...extra,
	}
}


function ledgerOf(rows: Row[]): Ledger {
	const ledger = emptyLedger() as Ledger
	for (const row of rows) addRow(ledger, row)
	return ledger
}


function fixture(): Ledger {
	return ledgerOf([
		measured("F5", "100", EOK_WON, { population: "all" }),
		measured("F6", "200", EOK_WON, { population: "all" }),
		measured("F7", "200", EOK_WON, { population: "subset" }),
		measured("F8", "15", "%"),
		measured("F9", "20", "%"),
		measured("F12", "320", "m"),
		measured("F19", "100", "case", { valid_at: "2025-Q3", entity: "acme" }),
		measured("F20", "112", "case", { valid_at: "2026-Q3", entity: "acme" }),
		measured("F30", "3.2", "m"),
	])
}


function rowOf(result: { row?: Row; error?: string; detail?: string }): Row {
	if (!result.row) throw new Error(`expected a row, got ${result.error}: ${result.detail}`)
	return result.row
}
export { HASH, EOK_WON, Row, Ledger, measured, ledgerOf, fixture, rowOf }
