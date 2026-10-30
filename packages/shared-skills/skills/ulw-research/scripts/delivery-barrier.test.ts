import { describe, expect, onTestFinished, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { sha256Of } from "./cli-support.mjs"
import { DEFECT_CODES } from "./contracts.mjs"
import { fidelityProblems, FIDELITY_RECORDS, RECORD_ENVELOPE, writeFidelityRecord } from "./fidelity-records.mjs"
import { BLOCKER, delivered, expectRefused, fullyRecorded } from "./tests/delivery-barrier-session.ts"

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

test("#given the record table #when every row is read #then each row has every rule column and an arranged session path", async () => {
	const { recordPath } = await fullyRecorded()
	expect(Object.keys(recordPath).sort()).toEqual(FIDELITY_RECORDS.map((entry) => entry.kind).sort())
	for (const entry of FIDELITY_RECORDS) {
		for (const column of ["targets", "requiredWhen", "remedy", "blocking"] as const) expect(typeof entry[column], `${entry.kind}.${column}`).toBe("function")
		expect(RECORD_ENVELOPE).toContain(entry.bindsTo)
	}
})

// The table is the barrier's spec: every row gets the same six cases.
for (const entry of FIDELITY_RECORDS) {
	describe(`record row ${entry.kind}`, () => {
		test("#given the record is missing while required #when verified and finished #then delivery refuses", async () => {
			const session = await fullyRecorded()
			unlinkSync(session.recordPath[entry.kind])
			await expectRefused(session, { code: "edition_unverified", path: session.recordPath[entry.kind] })
		})

		test("#given the record is missing and the row names none #when verified and finished #then delivery refuses: the step was not run", async () => {
			const session = await fullyRecorded()
			unlinkSync(session.recordPath[entry.kind])
			await session.invoke(["set", "html", "delivered", "--path", session.path])
			await expectRefused(session, { code: "edition_unverified", message: expect.stringContaining(`${entry.step} not run`) })
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

test("#given a row whose --verified-by record is gone #when verified and finished #then delivery refuses: the record is missing", async () => {
	const session = await fullyRecorded()
	unlinkSync(session.record)
	await expectRefused(session, { code: "edition_unverified", format: "html", path: session.record, message: `html: fidelity record ${session.record} is missing` })
})

test("#given a record kind outside the table or a malformed envelope #when written #then the writer refuses", () => {
	const dir = mkdtempSync(join(tmpdir(), "delivery-barrier-writer-"))
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
	const fields = { artifact_sha256: sha256Of("x"), report: join(dir, "report.html"), defects: [] }
	expect(() => writeFidelityRecord(join(dir, "a.json"), "not_a_record_kind", fields)).toThrow("unknown fidelity record kind")
	expect(() => writeFidelityRecord(join(dir, "b.json"), "meaning", { ...fields, artifact_sha256: "draft" })).toThrow("malformed")
	expect(() => writeFidelityRecord(join(dir, "c.json"), "meaning", { ...fields, gatesRun: [] })).toThrow("unknown field")
})

test("#given an unattached session fidelity blocker and a clean attached record #when verified and finished #then the session blocker refuses", async () => {
	const session = await fullyRecorded()
	const other = join(session.dir, "other.json")
	writeFidelityRecord(other, "fidelity", { artifact_sha256: sha256Of(readFileSync(session.path)), report: session.path, defects: [] })
	await session.invoke(["set", "html", "delivered", "--path", session.path, "--verified-by", other])
	session.write("fidelity", { defects: [{ code: BLOCKER }] })
	await expectRefused(session, { code: "fidelity_unresolved", codes: [BLOCKER], path: session.record })
})

for (const [name, alias] of [
	["a dot segment", (dir: string) => `${dir}/./fidelity-defects.json`],
	["a directory link", (dir: string) => {
		const link = join(dirname(dir), "alias")
		symlinkSync(dir, link, "junction")
		return join(link, "fidelity-defects.json")
	}],
] as const) {
	test(`#given two target paths reaching one blocking record through ${name} #when the barrier runs #then it reports the blocker once`, async () => {
		const session = await fullyRecorded()
		session.write("fidelity", { defects: [{ code: BLOCKER }] })
		const manifest = JSON.parse(readFileSync(join(session.dir, "outcome.json"), "utf8"))
		manifest.deliverables.push({ ...manifest.deliverables[0], format: "md", verifiedBy: alias(session.dir) })
		expect(fidelityProblems(session.dir, manifest).filter((problem) => problem.code === "fidelity_unresolved")).toHaveLength(1)
	})
}
