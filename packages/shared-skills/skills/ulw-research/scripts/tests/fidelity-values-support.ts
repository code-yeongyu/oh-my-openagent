/// <reference types="bun-types" />
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { valueChecks } from "../fidelity-values.mjs"
import { buildContext } from "../gates-static.mjs"
import { parseHtml } from "../html-lite.mjs"

export type Defect = { code: string; severity: string; selector: string; line: number; message: string; hint: string }
export type Row = Record<string, unknown> & { fact_id: string }
type Ledger = { schemaVersion: number; rows: Row[]; events: unknown[] }
type FillEntry = { fact_id: string; rendered: string; selector?: string }
type Options = { ledger?: Ledger; fillMap?: FillEntry[] | null; sourcesDir?: string | null; baseDir?: string; recompute?: (ledger: object, row: object) => { ok: boolean }; asOf?: string }

const FIX = join(import.meta.dir, "fixtures", "fidelity")
export const SOURCES = join(FIX, "sources")
export const LEDGER: Ledger = JSON.parse(readFileSync(join(FIX, "ledger-verify.json"), "utf8"))

export function ledgerWith(id: string, patch: Record<string, unknown>): Ledger {
	const copy = structuredClone(LEDGER)
	copy.rows = copy.rows.map((row) => (row.fact_id === id ? { ...row, ...patch } : row))
	return copy
}

export function run(body: string, options: Options = {}): Defect[] {
	const html = /<h2/.test(body) ? body : `<h2>Findings</h2>\n${body}`
	const ctx = buildContext(parseHtml(html), { baseDir: options.baseDir ?? FIX })
	const sourcesDir = options.sourcesDir === undefined ? SOURCES : options.sourcesDir
	return valueChecks(ctx, options.ledger ?? LEDGER, options.fillMap ?? null, sourcesDir, options) as Defect[]
}
