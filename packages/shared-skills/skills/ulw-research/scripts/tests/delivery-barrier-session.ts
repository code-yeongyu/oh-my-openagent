// Shared sessions for the delivery barrier tests (../delivery-barrier.test.ts and
// ../delivery-barrier-meaning.test.ts): a delivered edition, a fully recorded session, and the refusal
// assertion both files use.
import { expect, onTestFinished } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { sha256Of } from "../cli-support.mjs"
import { DEFECT_CODES } from "../contracts.mjs"
import { writeFidelityRecord } from "../fidelity-records.mjs"
import { blocksDelivery } from "../gates-fidelity.mjs"
import { run } from "../report-tools.mjs"

export async function delivered(format = "html", codes: string[] | null = null) {
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

export const LOCKED_BRIEF = readFileSync(join(import.meta.dir, "fixtures", "fidelity-brief-locked.md"), "utf8")
export const BLOCKER = Object.keys(DEFECT_CODES).find((code) => blocksDelivery({ code })) as string

/** The meaning record of one delivered edition, by its outcome format. */
export const meaningFile = (dir: string, format: string) => join(dir, `fidelity-meaning-defects.${format}.json`)

/**
 * A delivered html edition whose locked brief requires every table record, each present, fresh for
 * the delivered bytes, and clean. recordPath is where the session keeps each row's record; a table
 * row with no entry here fails the coverage test, so a new row brings its own cases.
 */
export async function fullyRecorded(brief = LOCKED_BRIEF) {
	const session = await delivered("html", [])
	writeFileSync(join(session.dir, "brief.md"), brief)
	const recordPath: Record<string, string> = { fidelity: session.record, meaning: meaningFile(session.dir, "html") }
	const write = (kind: string, fields: Record<string, unknown> = {}) =>
		writeFidelityRecord(recordPath[kind], kind, { artifact_sha256: sha256Of(readFileSync(session.path)), report: session.path, defects: [], ...fields })
	write("meaning")
	const outcomes = async () => Promise.all(["verify", "finish"].map((command) => session.invoke([command])))
	return { ...session, recordPath, write, outcomes }
}

export type Recorded = Awaited<ReturnType<typeof fullyRecorded>>

export async function expectRefused(session: Recorded, problem: Record<string, unknown>) {
	for (const result of await session.outcomes()) {
		expect(result.exitCode).toBe(1)
		expect(result.json.problems).toContainEqual(expect.objectContaining(problem))
	}
}
