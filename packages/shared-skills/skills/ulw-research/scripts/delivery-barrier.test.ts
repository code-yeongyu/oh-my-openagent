import { describe, expect, onTestFinished, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { sha256Of } from "./cli-support.mjs"
import { DEFECT_CODES } from "./contracts.mjs"
import { FIDELITY_RECORDS, MEANING_RECORD, RECORD_ENVELOPE, writeFidelityRecord } from "./fidelity-records.mjs"
import { blocksDelivery } from "./gates-fidelity.mjs"
import { run } from "./report-tools.mjs"

async function delivered(format = "html", codes: string[] | null = null) {
	const root = mkdtempSync(join(tmpdir(), "delivery-barrier-"))
	onTestFinished(() => rmSync(root, { recursive: true, force: true }))
	const dir = join(root, "20260101-120000")
	mkdirSync(dir)
	const path = join(dir, `report.${format}`)
	const record = join(dir, "fidelity-defects.json")
	writeFileSync(path, "<p>Report</p>")
	if (codes !== null) writeFidelityRecord(record, "fidelity", { artifact_sha256: sha256Of(readFileSync(path)), report: path, defects: codes.map((code) => ({ code, severity: "minor", message: code })) })
	const invoke = (args: string[]) => run(["outcome", ...args, "--session-dir", dir])
	await invoke(["init", "--promised", format])
	expect((await invoke(["set", format, "delivered", "--path", path, ...(codes === null ? [] : ["--verified-by", record])])).exitCode).toBe(0)
	return { dir, path, record, invoke }
}

// Enumerate the source registry, not a second list of today's fidelity codes.
for (const [code, entry] of Object.entries(DEFECT_CODES)) {
	if (!entry.integrity && entry.severity === "minor") continue
	test(`#given registry blocker ${code} #when verified and finished #then delivery refuses despite a demoted row`, async () => {
		const { dir, invoke } = await delivered("html", [code])
		for (const command of ["verify", "finish"]) {
			const result = await invoke([command])
			expect(result.exitCode).toBe(1)
			expect(result.json.problems).toContainEqual(expect.objectContaining({ code: "fidelity_unresolved", codes: [code] }))
		}
		expect(JSON.parse(readFileSync(join(dir, "outcome.json"), "utf8")).finishedAt).toBeNull()
	})
}

test("#given an unknown defect code #when verified or finished #then delivery refuses with its reason", async () => {
	const { invoke } = await delivered("html", ["future_fidelity_defect"])
	for (const command of ["verify", "finish"]) {
		const result = await invoke([command])
		expect(result.exitCode).toBe(1)
		expect(JSON.stringify(result.json.problems)).toContain("unknown defect code future_fidelity_defect")
	}
})

test("#given a registry non-blocker #when verified and finished #then delivery passes", async () => {
	const entry = Object.entries(DEFECT_CODES).find(([, value]) => !value.integrity && value.severity === "minor")
	if (!entry) throw new Error("registry must have a non-blocking entry")
	const { invoke } = await delivered("html", [entry[0]])
	expect((await invoke(["verify"])).exitCode).toBe(0)
	expect((await invoke(["finish"])).exitCode).toBe(0)
})

for (const format of ["html", "pdf", "docx"]) {
	test(`#given delivered ${format} without any ledger or gate record #when verified and finished #then both refuse`, async () => {
		const { invoke } = await delivered(format)
		for (const command of ["verify", "finish"]) {
			const result = await invoke([command])
			expect(result.exitCode).toBe(1)
			expect(JSON.stringify(result.json.problems)).toContain("fidelity gate not run")
		}
	})
}

test("#given a missing gate #when explicitly skipped with a reason #then the logged choice permits delivery", async () => {
	const { dir, invoke } = await delivered()
	const now = "2026-01-01T12:01:00.000Z"
	await invoke(["gate", "fidelity", "not_run", "--reason", "No factual content in this edition", "--now", now])
	const manifest = JSON.parse(readFileSync(join(dir, "outcome.json"), "utf8"))
	expect(manifest.gateHistory).toContainEqual({ gate: "fidelity", status: "not_run", reason: "No factual content in this edition", at: now })
	expect((await invoke(["verify"])).exitCode).toBe(0)
	expect((await invoke(["finish"])).exitCode).toBe(0)
	await invoke(["gate", "fidelity", "pass"])
	expect((await invoke(["verify"])).exitCode).toBe(1)
})

test("#given a missing gate #when skipped without a meaningful reason #then the command refuses", async () => {
	const { invoke } = await delivered()
	for (const reason of [[], ["--reason", "   "]]) {
		await expect(invoke(["gate", "fidelity", "not_run", ...reason])).rejects.toThrow("reason")
	}
})

test("#given a fact ledger and an unverified edition #when the gate is skipped with a reason #then delivery still refuses", async () => {
	const { dir, invoke } = await delivered()
	writeFileSync(join(dir, "fact-ledger.json"), JSON.stringify({ version: 1, facts: [] }))
	await invoke(["gate", "fidelity", "not_run", "--reason", "This harness has no verifier"])
	for (const command of ["verify", "finish"]) {
		const result = await invoke([command])
		expect(result.exitCode).toBe(1)
		expect(JSON.stringify(result.json.problems)).toContain("fidelity gate not run")
	}
})

test("#given a stale fidelity record nobody attached #when the gate is skipped with a reason #then delivery still refuses", async () => {
	const { dir, path, invoke } = await delivered()
	writeFidelityRecord(join(dir, "fidelity-defects.json"), "fidelity", { artifact_sha256: "0".repeat(64), report: path, defects: [] })
	await invoke(["gate", "fidelity", "not_run", "--reason", "This harness has no verifier"])
	for (const command of ["verify", "finish"]) {
		const result = await invoke([command])
		expect(result.exitCode).toBe(1)
		expect(JSON.stringify(result.json.problems)).toContain("fidelity gate not run")
	}
})

test("#given an explicit skip and an existing blocker #when verified #then the skip cannot release the blocker", async () => {
	const { invoke } = await delivered("html", ["claim_status_invalid"])
	await invoke(["gate", "fidelity", "not_run", "--reason", "Unsupported edition"])
	expect((await invoke(["verify"])).exitCode).toBe(1)
})

const LOCKED_BRIEF = readFileSync(join(import.meta.dir, "tests", "fixtures", "fidelity-brief-locked.md"), "utf8")
const BLOCKER = Object.keys(DEFECT_CODES).find((code) => blocksDelivery({ code })) as string

/**
 * A delivered html edition whose locked brief requires every table record, each present, fresh for
 * the delivered bytes, and clean. recordPath is where the session keeps each row's record; a table
 * row with no entry here fails the coverage test below, so a new row brings its own cases.
 */
async function fullyRecorded(brief = LOCKED_BRIEF) {
	const session = await delivered("html", [])
	writeFileSync(join(session.dir, "brief.md"), brief)
	const recordPath: Record<string, string> = { fidelity: session.record, meaning: join(session.dir, MEANING_RECORD) }
	const write = (kind: string, fields: Record<string, unknown> = {}) =>
		writeFidelityRecord(recordPath[kind], kind, { artifact_sha256: sha256Of(readFileSync(session.path)), report: session.path, defects: [], ...fields })
	write("meaning")
	const outcomes = async () => Promise.all(["verify", "finish"].map((command) => session.invoke([command])))
	return { ...session, recordPath, write, outcomes }
}

async function expectRefused(session: Awaited<ReturnType<typeof fullyRecorded>>, problem: Record<string, unknown>) {
	for (const result of await session.outcomes()) {
		expect(result.exitCode).toBe(1)
		expect(result.json.problems).toContainEqual(expect.objectContaining(problem))
	}
}

test("#given the record table #when every row is read #then each row has every rule column and an arranged session path", async () => {
	const { recordPath } = await fullyRecorded()
	expect(Object.keys(recordPath).sort()).toEqual(FIDELITY_RECORDS.map((entry) => entry.kind).sort())
	for (const entry of FIDELITY_RECORDS) {
		for (const column of ["targets", "requiredWhen", "remedy", "blocking"] as const) expect(typeof entry[column], `${entry.kind}.${column}`).toBe("function")
		expect(RECORD_ENVELOPE).toContain(entry.bindsTo)
	}
})

// The table is the barrier's spec: every row gets the same five cases.
for (const entry of FIDELITY_RECORDS) {
	describe(`record row ${entry.kind}`, () => {
		test("#given the record is missing while required #when verified and finished #then delivery refuses", async () => {
			const session = await fullyRecorded()
			unlinkSync(session.recordPath[entry.kind])
			await expectRefused(session, { code: "edition_unverified", path: session.recordPath[entry.kind] })
		})

		test("#given the record is for other bytes #when verified and finished #then delivery refuses: a different edition", async () => {
			const session = await fullyRecorded()
			session.write(entry.kind, { artifact_sha256: sha256Of("an earlier draft") })
			await expectRefused(session, { code: "edition_unverified", path: session.recordPath[entry.kind], message: expect.stringContaining("is for a different edition") })
		})

		test("#given a fresh record with a blocking defect #when verified and finished #then delivery refuses", async () => {
			const session = await fullyRecorded()
			session.write(entry.kind, { defects: [{ code: BLOCKER, severity: "minor", message: BLOCKER }] })
			await expectRefused(session, { code: "fidelity_unresolved", codes: [BLOCKER], path: session.recordPath[entry.kind] })
		})

		test("#given a fresh clean record #when verified and finished #then delivery passes", async () => {
			const session = await fullyRecorded()
			expect((await session.outcomes()).map((result) => result.exitCode)).toEqual([0, 0])
		})

		for (const [name, mutate] of [
			["a missing envelope field", (record: Record<string, unknown>) => delete record.written_at],
			["an unknown field", (record: Record<string, unknown>) => Object.assign(record, { verified_elsewhere: true })],
			["another record kind", (record: Record<string, unknown>) => Object.assign(record, { record_kind: "not_a_record_kind" })],
		] as const) {
			test(`#given a record with ${name} #when verified and finished #then delivery refuses it as malformed`, async () => {
				const session = await fullyRecorded()
				const path = session.recordPath[entry.kind]
				const record = JSON.parse(readFileSync(path, "utf8"))
				mutate(record)
				writeFileSync(path, JSON.stringify(record))
				await expectRefused(session, { code: "edition_unverified", path, message: expect.stringContaining("is malformed") })
			})
		}
	})
}

test("#given a record kind outside the table or a malformed envelope #when written #then the writer refuses", () => {
	const dir = mkdtempSync(join(tmpdir(), "delivery-barrier-writer-"))
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
	const fields = { artifact_sha256: sha256Of("x"), report: join(dir, "report.html"), defects: [] }
	expect(() => writeFidelityRecord(join(dir, "a.json"), "not_a_record_kind", fields)).toThrow("unknown fidelity record kind")
	expect(() => writeFidelityRecord(join(dir, "b.json"), "meaning", { ...fields, artifact_sha256: "draft" })).toThrow("malformed")
	expect(() => writeFidelityRecord(join(dir, "c.json"), "meaning", { ...fields, gatesRun: [] })).toThrow("unknown field")
})

/** A delivered, fidelity-verified html edition in a session whose locked brief sets `meaning check`. */
async function meaningSession(meaning: "on" | "off", codes: string[] | null) {
	const session = await fullyRecorded(LOCKED_BRIEF.replace("meaning check: on", `meaning check: ${meaning}`))
	if (codes === null) unlinkSync(session.recordPath.meaning)
	else session.write("meaning", { defects: codes.map((code) => ({ code, severity: "major", message: code })) })
	return session
}

for (const code of ["meaning_drift_confirmed", "meaning_unverified"]) {
	test(`#given a meaning record with ${code} #when verified and finished #then delivery refuses`, async () => {
		const session = await meaningSession("on", [code])
		await expectRefused(session, { code: "fidelity_unresolved", codes: [code], path: join(session.dir, MEANING_RECORD) })
	})
}

test("#given the brief says meaning check on and the meaning step was skipped #when verified and finished #then delivery refuses: meaning gate not run", async () => {
	const session = await meaningSession("on", null)
	await expectRefused(session, { message: expect.stringContaining("meaning gate not run") })
})

test("#given a malformed ## Fidelity block that tries to turn meaning check off #when no meaning record exists #then delivery refuses: meaning gate not run", async () => {
	const malformed = LOCKED_BRIEF.replace("meaning check: on (answered_by: default)", "meaning check: on (answered_by: default)\nmeaning check: off (answered_by: user)")
	const session = await fullyRecorded(malformed)
	unlinkSync(session.recordPath.meaning)
	await expectRefused(session, { message: expect.stringContaining("meaning gate not run") })
})

test("#given the brief says meaning check off and no meaning record #when verified and finished #then delivery passes", async () => {
	const session = await meaningSession("off", null)
	expect((await session.outcomes()).map((result) => result.exitCode)).toEqual([0, 0])
})

test("#given a clean meaning record (warn only) under meaning check on #when verified #then delivery passes", async () => {
	const { invoke } = await meaningSession("on", ["meaning_drift_warn"])
	expect((await invoke(["verify"])).exitCode).toBe(0)
})

test("#given meaning check on, no fidelity evidence, and an explicit fidelity not_run #when verified #then the logged exemption covers the meaning step too", async () => {
	const { dir, invoke } = await delivered()
	writeFileSync(join(dir, "brief.md"), LOCKED_BRIEF)
	await invoke(["gate", "fidelity", "not_run", "--reason", "No factual content in this edition"])
	expect((await invoke(["verify"])).exitCode).toBe(0)
})
