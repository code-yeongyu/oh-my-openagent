import { describe, expect, test } from "bun:test"

import { TRANSITIONS, addRow, emptyLedger, nextId, retractRow, supersedeRow, transitionError, validateLedger } from "./fact-ledger.mjs"

// Property-style checks of references/fact-ledger-grammar.md: every ledger the writers build is
// valid, and every single-invariant break the validator rejects is also refused by the writers.

type Row = { fact_id: string; status: string; kind: string; label: string; operands: string[]; derived_from: string[] }
type LedgerEvent = { fact_id: string; from: string; to: string; replacement?: string | null; reason?: string }
type Ledger = { rows: Row[]; events: LedgerEvent[] }

function measured(label: string) {
	return {
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
	}
}

function quoteRow(label: string) {
	return { ...measured(label), kind: "quote", value: null, unit: null, value_span: null }
}

function derivedRow(label: string, from: string[], kind = "derived") {
	return {
		kind,
		value: "2",
		raw: "2",
		quote: "",
		extracted_by: "fact derive",
		observed_at: "2026-10-23T08:00:00Z",
		label,
		operation: kind === "converted" ? "convert" : "expr",
		operands: [...from],
		derived_from: [...from],
		factor: kind === "converted" ? "1000" : null,
		exact: { num: "2", den: "1" },
		formula: from.join(" + "), render: "2", precision: { places: 0, sigfigs: 1 },
		compatibility: kind === "converted" ? "checked" : "unchecked",
		context: kind === "converted" ? { target: "km" } : null,
	}
}

/** mulberry32: a fixed seed gives the same ledger on every run. */
function prng(seed: number) {
	let state = seed >>> 0
	return () => {
		state = (state + 0x6d2b79f5) >>> 0
		let t = state
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

function pick<T>(random: () => number, list: T[]): T {
	return list[Math.floor(random() * list.length)]
}

const ids = (ledger: Ledger, keep: (row: Row) => boolean) => ledger.rows.filter(keep).map((row) => row.fact_id)

/** Writes the writers must refuse on any ledger; each returns nothing and must throw. */
function illegalWrites(ledger: Ledger, random: () => number): (() => unknown)[] {
	const active = ids(ledger, (row) => row.status === "active")
	const ended = ids(ledger, (row) => row.status !== "active")
	const writes: (() => unknown)[] = [() => addRow(ledger, derivedRow("dangling", ["F999"])), () => addRow(ledger, measured(pick(random, ledger.rows).label))]
	if (active.length > 0) {
		const id = pick(random, active)
		writes.push(() => supersedeRow(ledger, id, id, "self"), () => supersedeRow(ledger, id, null, "none"), () => retractRow(ledger, id, ""))
		if (ended.length > 0) writes.push(() => supersedeRow(ledger, id, pick(random, ended), "to an ended row"))
	}
	if (ended.length > 0) writes.push(() => retractRow(ledger, pick(random, ended), "again"))
	return writes
}

/** Random addRow / retractRow / supersedeRow sequences from an empty ledger, with refused writes mixed in. */
function randomLedger(seed: number) {
	const random = prng(seed)
	const ledger: Ledger = emptyLedger()
	const steps = 4 + Math.floor(random() * 14)
	for (let step = 0; step < steps; step += 1) {
		const active = ids(ledger, (row) => row.status === "active")
		const values = ids(ledger, (row) => row.fact_id.startsWith("F"))
		const roll = random()
		if (roll < 0.3 || values.length < 2) addRow(ledger, measured(`m${step}`))
		else if (roll < 0.4) addRow(ledger, quoteRow(`q${step}`))
		else if (roll < 0.6) {
			const kind = pick(random, ["derived", "converted"])
			const from = kind === "converted" ? [pick(random, values)] : [...new Set([pick(random, values), pick(random, values)])]
			addRow(ledger, derivedRow(`d${step}`, from, kind))
		}
		else if (roll < 0.8 && active.length > 0) retractRow(ledger, pick(random, active), "wrong page")
		else if (active.length > 1) {
			const id = pick(random, active)
			supersedeRow(ledger, id, pick(random, active.filter((other: string) => other !== id)), "newer filing")
		}
		const before = JSON.stringify(ledger)
		const write = pick(random, illegalWrites(ledger, random))
		expect(write).toThrow()
		expect(JSON.stringify(ledger)).toBe(before)
	}
	return ledger
}

const LEDGERS = Array.from({ length: 200 }, (_, index) => randomLedger(index + 1))

describe("every ledger the writers build is valid", () => {
	test("200 seeded random write sequences all validate, and refused writes leave the ledger unchanged", () => {
		for (const ledger of LEDGERS) expect(validateLedger(ledger)).toEqual([])
		const events = LEDGERS.flatMap((ledger) => ledger.events)
		expect(events.some((event) => event.to === "superseded")).toBe(true)
		expect(events.some((event) => event.to === "retracted")).toBe(true)
		expect(LEDGERS.some((ledger) => ledger.rows.some((row) => row.kind === "converted"))).toBe(true)
	})
})

type Break = { name: string; mutate: (ledger: Ledger) => string | null; rejects: RegExp; write: (ledger: Ledger) => unknown; refuses: RegExp }

const firstEvent = (ledger: Ledger, to?: string) => ledger.events.find((event) => to === undefined || event.to === to) as LedgerEvent
const firstRow = (ledger: Ledger, keep: (row: Row) => boolean) => ledger.rows.find(keep) as Row
const activeId = (ledger: Ledger) => firstRow(ledger, (row) => row.status === "active")?.fact_id

const BREAKS: Break[] = [
	{ name: "superseded event with a null replacement", mutate: (l) => { const e = firstEvent(l, "superseded"); if (!e || !activeId(l)) return null; e.replacement = null; return e.fact_id }, rejects: /needs a replacement row/, write: (l) => supersedeRow(l, activeId(l), null, "x"), refuses: /needs a replacement row/ },
	{ name: "self replacement", mutate: (l) => { const e = firstEvent(l, "superseded"); if (!e || !activeId(l)) return null; e.replacement = e.fact_id; return e.fact_id }, rejects: /cannot be its own replacement/, write: (l) => supersedeRow(l, activeId(l), activeId(l), "x"), refuses: /cannot be its own replacement/ },
	{ name: "duplicate transition", mutate: (l) => { const e = firstEvent(l); if (!e) return null; l.events.push({ ...e }); return e.fact_id }, rejects: /but the event moves it from active/, write: (l) => retractRow(l, firstEvent(l).fact_id, "x"), refuses: /cannot move from (retracted|superseded)/ },
	{ name: "from mismatch", mutate: (l) => { const e = firstEvent(l); if (!e) return null; e.from = e.to; return e.fact_id }, rejects: /is active, but the event moves it from/, write: (l) => supersedeRow(l, firstEvent(l).fact_id, activeId(l) ?? "F1", "x"), refuses: /cannot move from|own replacement/ },
	{ name: "active row with events", mutate: (l) => { const r = firstRow(l, (row) => row.status !== "active"); if (!r) return null; r.status = "active"; return r.fact_id }, rejects: /has status active but its last event moves it to/, write: (l) => { const r = firstRow(l, (row) => row.status !== "active"); const problem = transitionError(new Map([[r.fact_id, r.status]]), { fact_id: r.fact_id, from: r.status, to: "active", replacement: null, reason: "x" }); if (problem) throw new Error(problem) }, refuses: /cannot move from (retracted|superseded) to active/ },
	{ name: "non-active row without events", mutate: (l) => { const e = firstEvent(l); if (!e) return null; l.events = l.events.filter((event) => event.fact_id !== e.fact_id); return e.fact_id }, rejects: /but has no status event/, write: (l) => addRow(l, { ...measured("fresh"), status: "retracted" }), refuses: /but has no status event/ },
	{ name: "dangling operand", mutate: (l) => { const r = firstRow(l, (row) => row.operands.length > 0); if (!r) return null; r.operands[0] = "F999"; return r.fact_id }, rejects: /references F999, which has no ledger row/, write: (l) => addRow(l, derivedRow("fresh", ["F999"])), refuses: /references F999, which has no ledger row/ },
	{ name: "self derived_from", mutate: (l) => { const r = firstRow(l, (row) => row.derived_from.length > 0); if (!r) return null; r.derived_from.push(r.fact_id); return r.fact_id }, rejects: /references itself/, write: (l) => addRow(l, { ...derivedRow("fresh", []), derived_from: [nextId(l, "derived")] }), refuses: /references itself/ },
	{ name: "cyclic derived_from", mutate: (l) => { const r = firstRow(l, (row) => row.derived_from.length > 0); if (!r) return null; firstRow(l, (row) => row.fact_id === r.derived_from[0]).derived_from.push(r.fact_id); return r.fact_id }, rejects: /derives from itself through/, write: (l) => addRow(l, derivedRow("fresh", [`F${l.rows.length + 5}`])), refuses: /which has no ledger row/ },
	{ name: "duplicate label", mutate: (l) => { if (l.rows.length < 2) return null; l.rows[1].label = l.rows[0].label; return l.rows[1].fact_id }, rejects: /has duplicate label/, write: (l) => addRow(l, measured(l.rows[0].label)), refuses: /has duplicate label/ },
]

describe("every single-invariant break is rejected by the validator and refused by the writers", () => {
	for (const broken of BREAKS) {
		test(broken.name, () => {
			let applied = 0
			for (const valid of LEDGERS) {
				const ledger = structuredClone(valid)
				const factId = broken.mutate(ledger)
				if (factId === null) continue
				applied += 1
				const errors = validateLedger(ledger)
				expect(errors.some((error: string) => broken.rejects.test(error) && error.includes(factId))).toBe(true)
				const untouched = structuredClone(valid)
				expect(() => broken.write(untouched)).toThrow(broken.refuses)
				expect(untouched).toEqual(valid)
			}
			expect(applied).toBeGreaterThan(10)
		})
	}

	test("no transition leads back to active", () => {
		for (const targets of Object.values(TRANSITIONS)) expect(targets).not.toContain("active")
	})
})

function twoRows() {
	const ledger = emptyLedger()
	addRow(ledger, measured("a"))
	addRow(ledger, measured("b"))
	return ledger
}

describe("validateLedger is as strict as the writers (review r5 MEDIUM)", () => {
	test("a superseded event with a null replacement is rejected", () => {
		const ledger = twoRows()
		supersedeRow(ledger, "F1", "F2", "newer filing")
		ledger.events[0].replacement = null
		expect(validateLedger(ledger).some((e: string) => e.includes("F1") && e.includes("replacement"))).toBe(true)
	})

	test("a row superseded by itself is rejected", () => {
		const ledger = twoRows()
		supersedeRow(ledger, "F1", "F2", "newer filing")
		ledger.events[0].replacement = "F1"
		expect(validateLedger(ledger).some((e: string) => e.includes("F1") && e.includes("replacement"))).toBe(true)
	})

	test("two events that both move F1 from active to retracted are rejected", () => {
		const ledger = twoRows()
		retractRow(ledger, "F1", "wrong page")
		ledger.events.push({ ...ledger.events[0] })
		expect(validateLedger(ledger).some((e: string) => e.includes("events[1]") && e.includes("F1"))).toBe(true)
	})
})
