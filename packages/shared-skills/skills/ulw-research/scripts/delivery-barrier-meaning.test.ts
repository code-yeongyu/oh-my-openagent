import { expect, test } from "bun:test"
import { readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { sha256Of } from "./cli-support.mjs"
import { MEANING_RECORD, writeFidelityRecord } from "./fidelity-records.mjs"
import { delivered, expectRefused, fullyRecorded, LOCKED_BRIEF, meaningFile, type Recorded } from "./tests/delivery-barrier-session.ts"

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
		await expectRefused(session, { code: "fidelity_unresolved", codes: [code], path: session.recordPath.meaning })
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

test("#given an edition meaning record but no fidelity record #when the fidelity gate is skipped with a reason #then delivery still refuses", async () => {
	const { dir, path, invoke } = await delivered()
	writeFileSync(join(dir, "brief.md"), LOCKED_BRIEF)
	writeFidelityRecord(meaningFile(dir, "html"), "meaning", { artifact_sha256: sha256Of(readFileSync(path)), report: path, defects: [] })
	await invoke(["gate", "fidelity", "not_run", "--reason", "This harness has no verifier"])
	const result = await invoke(["verify"])
	expect(result.exitCode).toBe(1)
	expect(JSON.stringify(result.json.problems)).toContain("fidelity gate not run")
})

/** Deliver a second edition with byte-different text and its own clean fidelity record. */
async function secondEdition(session: Recorded, format: string, text: string) {
	const path = join(session.dir, `second.${format}`)
	const record = join(session.dir, "second-fidelity.json")
	writeFileSync(path, text)
	writeFidelityRecord(record, "fidelity", { artifact_sha256: sha256Of(text), report: path, defects: [] })
	await session.invoke(["set", format, "delivered", "--path", path, "--verified-by", record])
	const meaning = meaningFile(session.dir, format)
	const writeMeaning = (fields: Record<string, unknown> = {}) => writeFidelityRecord(meaning, "meaning", { artifact_sha256: sha256Of(text), report: path, defects: [], ...fields })
	const problems = async () => (await session.invoke(["verify"])).json.problems
	return { path, meaning, writeMeaning, problems }
}

for (const [format, text] of [["md", "Report in Markdown."], ["post", "Report in a post."]]) {
	test(`#given html and ${format} delivered, each with its own meaning record #when verified and finished #then delivery passes`, async () => {
		const session = await fullyRecorded()
		const second = await secondEdition(session, format, text)
		second.writeMeaning()
		expect((await session.outcomes()).map((result) => result.exitCode)).toEqual([0, 0])
	})

	test(`#given html and ${format} delivered but only html has a meaning record #when verified #then only ${format} refuses: meaning gate not run`, async () => {
		const session = await fullyRecorded()
		const second = await secondEdition(session, format, text)
		expect(await second.problems()).toEqual([expect.objectContaining({ code: "edition_unverified", format, path: second.meaning, message: expect.stringContaining(`meaning gate not run; run fact pairs and fact meaning-check --edition ${format}`) })])
	})

	test(`#given the ${format} meaning record is for other bytes #when verified #then only ${format} refuses: a different edition`, async () => {
		const session = await fullyRecorded()
		const second = await secondEdition(session, format, text)
		second.writeMeaning({ artifact_sha256: sha256Of("an earlier draft") })
		expect(await second.problems()).toEqual([expect.objectContaining({ code: "edition_unverified", format, path: second.meaning, message: expect.stringContaining("is for a different edition") })])
	})

	test(`#given the ${format} meaning record carries a confirmed drift #when verified #then only that record blocks`, async () => {
		const session = await fullyRecorded()
		const second = await secondEdition(session, format, text)
		second.writeMeaning({ defects: [{ code: "meaning_drift_confirmed", severity: "major", message: "drift" }] })
		expect(await second.problems()).toEqual([expect.objectContaining({ code: "fidelity_unresolved", format, codes: ["meaning_drift_confirmed"], path: second.meaning })])
	})

	test(`#given one legacy session meaning record checked on html and ${format} delivered #when verified #then ${format} refuses: a different edition`, async () => {
		const session = await fullyRecorded()
		unlinkSync(session.recordPath.meaning)
		writeFidelityRecord(join(session.dir, MEANING_RECORD), "meaning", { artifact_sha256: sha256Of(readFileSync(session.path)), report: session.path, defects: [] })
		const second = await secondEdition(session, format, text)
		expect(await second.problems()).toEqual([expect.objectContaining({ code: "edition_unverified", format, path: join(session.dir, MEANING_RECORD), message: expect.stringContaining("is for a different edition") })])
	})
}

test("#given a single edition and only the legacy session meaning record for its bytes #when verified and finished #then delivery passes", async () => {
	const session = await fullyRecorded()
	unlinkSync(session.recordPath.meaning)
	writeFidelityRecord(join(session.dir, MEANING_RECORD), "meaning", { artifact_sha256: sha256Of(readFileSync(session.path)), report: session.path, defects: [] })
	expect((await session.outcomes()).map((result) => result.exitCode)).toEqual([0, 0])
})

test("#given a pdf rendered from the html source #when only the html edition has a meaning record #then the pdf shares it and delivery passes", async () => {
	const session = await fullyRecorded()
	const pdf = join(session.dir, "report.pdf")
	writeFileSync(pdf, "%PDF-1.7 rendered")
	await session.invoke(["set", "pdf", "delivered", "--path", pdf, "--rendered-from", session.path, "--verified-by", session.record])
	expect((await session.outcomes()).map((result) => result.exitCode)).toEqual([0, 0])
})

test("#given html and a byte-identical md copy at another path #when only the html edition has a meaning record #then the md binds to it by bytes and delivery passes", async () => {
	const session = await fullyRecorded()
	const second = await secondEdition(session, "md", readFileSync(session.path, "utf8"))
	expect(await second.problems()).toEqual([])
	expect((await session.outcomes()).map((result) => result.exitCode)).toEqual([0, 0])
})

// Reader runs on the same bytes are ordered by their records' written_at, never by file name.
const EARLIER = new Date("2026-01-01T10:00:00.000Z")
const LATER = new Date("2026-01-01T11:00:00.000Z")
const DRIFT = [{ code: "meaning_drift_confirmed", severity: "major", message: "drift" }]

/** Write a meaning record for the delivered html bytes at an explicit time. */
const meaningAt = (session: Recorded, path: string, at: Date, defects: Record<string, unknown>[] = []) =>
	writeFidelityRecord(path, "meaning", { artifact_sha256: sha256Of(readFileSync(session.path)), report: session.path, defects }, at)

/** Deliver a pdf rendered from the html source; it has no meaning record of its own. */
const deliverPdf = async (session: Recorded) => {
	const pdf = join(session.dir, "report.pdf")
	writeFileSync(pdf, "%PDF-1.7 rendered")
	await session.invoke(["set", "pdf", "delivered", "--path", pdf, "--rendered-from", session.path, "--verified-by", session.record])
}

test("#given a clean own record written after a legacy record confirming drift on the same bytes #when verified and finished #then the newer clean run passes", async () => {
	const session = await fullyRecorded()
	meaningAt(session, join(session.dir, MEANING_RECORD), EARLIER, DRIFT)
	meaningAt(session, session.recordPath.meaning, LATER)
	expect((await session.outcomes()).map((result) => result.exitCode)).toEqual([0, 0])
})

test("#given a legacy record confirming drift written after a clean own record on the same bytes #when verified and finished #then the newer drift refuses", async () => {
	const session = await fullyRecorded()
	meaningAt(session, session.recordPath.meaning, EARLIER)
	meaningAt(session, join(session.dir, MEANING_RECORD), LATER, DRIFT)
	await expectRefused(session, { code: "fidelity_unresolved", codes: ["meaning_drift_confirmed"], path: join(session.dir, MEANING_RECORD) })
})

test("#given a clean own record and a legacy drift record written at the same time on the same bytes #when verified and finished #then the more severe verdict refuses", async () => {
	const session = await fullyRecorded()
	meaningAt(session, session.recordPath.meaning, LATER)
	meaningAt(session, join(session.dir, MEANING_RECORD), LATER, DRIFT)
	await expectRefused(session, { code: "fidelity_unresolved", codes: ["meaning_drift_confirmed"], path: join(session.dir, MEANING_RECORD) })
})

test("#given two edition records for the same bytes, the alphabetically-first clean and older #when a pdf of those bytes is verified and finished #then the newer drift refuses", async () => {
	const session = await fullyRecorded()
	await deliverPdf(session)
	meaningAt(session, meaningFile(session.dir, "html"), EARLIER)
	meaningAt(session, meaningFile(session.dir, "post"), LATER, DRIFT)
	await expectRefused(session, { code: "fidelity_unresolved", codes: ["meaning_drift_confirmed"], path: meaningFile(session.dir, "post") })
})

test("#given two edition records for the same bytes, the alphabetically-first confirming drift and older #when verified and finished #then the newer clean run passes", async () => {
	const session = await fullyRecorded()
	await deliverPdf(session)
	meaningAt(session, meaningFile(session.dir, "html"), EARLIER, DRIFT)
	meaningAt(session, meaningFile(session.dir, "post"), LATER)
	expect((await session.outcomes()).map((result) => result.exitCode)).toEqual([0, 0])
})
