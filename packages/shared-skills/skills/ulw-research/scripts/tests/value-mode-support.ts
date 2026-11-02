import { expect, onTestFinished } from "bun:test"
import { copyFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { run } from "../report-tools.mjs"

// Shared by the value-mode unit tests: the verify fixture ledger plus value rows, and one fill -> verify session.
export type Row = Record<string, unknown> & { fact_id: string }
export type VerifyResult = { exitCode: number; json: { defects: { code: string; severity: string }[] } }
export const FIX = join(import.meta.dir, "fixtures")
const BASE: { rows: Row[] } = JSON.parse(readFileSync(join(FIX, "fidelity", "ledger-verify.json"), "utf8"))
export const F1 = BASE.rows.find((r) => r.fact_id === "F1") as Row
const extra = (fact_id: string, label: string, raw: string, value: string, unit: string, num: string, den = "1"): Row => ({ ...F1, fact_id, label, raw, value, unit, exact: { num, den } })
// Korean units and particles as \u escapes: pp (peosenteu pointeu), eok won, myeong, geon, dalleo, particles ro/euro/ui/ida.
export const LEDGER = {
	...BASE,
	rows: [
		...BASE.rows,
		extra("F20", "gap_pp", "3.2%p", "3.2", "%p", "16", "5"),
		extra("F21", "rev_eok", "3,234 KRW-e8", "3234", "KRW-e8", "3234"),
		extra("F22", "staff", "5\uBA85", "5", "person", "5"),
		extra("F23", "price", "$12", "12", "USD", "12"),
		extra("F24", "deck_len", "1.2 km", "1.2", "km", "6", "5"),
	],
}

/** Fill `body` in a fresh session; verify re-checks the edition, write replaces its text (the fill map stays). */
export async function filled(body: string, format = "html", ledger: { rows: Row[] } = LEDGER) {
	const dir = mkdtempSync(join(tmpdir(), "value-mode-unit-"))
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
	writeFileSync(join(dir, "fact-ledger.json"), JSON.stringify(ledger))
	copyFileSync(join(FIX, "fidelity-brief-locked.md"), join(dir, "brief.md"))
	cpSync(join(FIX, "fidelity", "sources"), join(dir, "sources"), { recursive: true })
	const source = join(dir, `report.src.${format}`)
	const report = join(dir, `report.${format}`)
	writeFileSync(source, body)
	const result = await run(["fact", "fill", source, "--out", report, "--session-dir", dir])
	expect(result.exitCode).toBe(0)
	const verify = async () => (await run(["fact", "verify", report, "--session-dir", dir])) as VerifyResult
	const edit = (from: string, to: string) => writeFileSync(report, readFileSync(report, "utf8").replace(from, to))
	const text = readFileSync(report, "utf8")
	const write = (next: string) => writeFileSync(report, next)
	return { verify, edit, text, write }
}

export const codes = (result: VerifyResult) => result.json.defects.map((d) => d.code)
export const prose = (pointer: string, tail: string) => `<h2>Findings</h2><p>Up to ${pointer}${tail} [S4].</p>`
