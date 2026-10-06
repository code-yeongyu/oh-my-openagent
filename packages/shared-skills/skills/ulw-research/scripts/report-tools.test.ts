import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"

import { COMMANDS, run } from "./report-tools.mjs"

const SCRIPT = join(import.meta.dir, "report-tools.mjs")
const FIXTURES = join(import.meta.dir, "tests", "fixtures")

function sessionDir() {
	const root = mkdtempSync(join(tmpdir(), "report-tools-cli-"))
	const dir = join(root, "20260101-120000")
	mkdirSync(dir)
	return dir
}

function nodeWithoutBun(args: string[]) {
	const nodePath = Bun.which("node")
	if (nodePath === null) throw new Error("node not found on PATH")
	const path = (process.env.PATH ?? "").split(delimiter).filter((entry) => !entry.includes(".bun")).join(delimiter)
	return Bun.spawnSync({ cmd: [nodePath, SCRIPT, ...args], env: { ...process.env, PATH: path } })
}

function defectsFile(dir: string, name: string, codes: string[]) {
	const file = join(dir, name)
	writeFileSync(file, JSON.stringify(codes.map((code) => ({ code, message: code }))))
	return file
}

describe("help and usage", () => {
	test("#given --help --json #when run #then it lists exactly the command matrix", async () => {
		const result = await run(["--help", "--json"])
		expect(result.json.commands).toEqual([...COMMANDS])
		expect(COMMANDS).toEqual(["check", "layout-probe", "repair decide", "outcome init", "outcome set", "outcome gate", "outcome render", "outcome state", "outcome verify", "outcome finish", "outcome briefing", "format-extract"])
	})

	test("#given no arguments under node #when spawned #then it exits 2 with a usage line on stderr", () => {
		const proc = nodeWithoutBun([])
		expect(proc.exitCode).toBe(2)
		expect(proc.stderr.toString()).toContain("usage")
	})

	test("#given a missing report file #when checked #then it exits 2 naming the path", () => {
		const proc = nodeWithoutBun(["check", "missing-report.html", "--design-spec", "missing-spec.md"])
		expect(proc.exitCode).toBe(2)
		expect(proc.stderr.toString()).toContain("missing-spec.md")
	})
})

describe("check", () => {
	test("#given the bad fixture under node #when checked #then it exits 1 with blockers in stdout JSON", () => {
		const proc = nodeWithoutBun(["check", join(FIXTURES, "bad-report.html"), "--design-spec", join(FIXTURES, "design-spec.md")])
		expect(proc.exitCode).toBe(1)
		const parsed = JSON.parse(proc.stdout.toString())
		expect(parsed.command).toBe("check")
		expect(parsed.counts.blocker).toBeGreaterThanOrEqual(1)
		expect(parsed.layout).toBe("not_run")
	})

	test("#given the good fixture #when checked #then it passes with exit 0", () => {
		const proc = nodeWithoutBun(["check", join(FIXTURES, "good-report.html"), "--design-spec", join(FIXTURES, "design-spec.md")])
		expect(proc.exitCode).toBe(0)
		expect(JSON.parse(proc.stdout.toString()).status).toBe("pass")
	})

	test("#given a layout probe file #when checked #then layout gates run and the layout field is set", async () => {
		const result = await run(["check", join(FIXTURES, "good-report.html"), "--design-spec", join(FIXTURES, "design-spec.md"), "--layout", join(FIXTURES, "boxes.json")])
		expect(result.json.gatesRun).toContain("layout")
		expect(["pass", "fail"]).toContain(result.json.layout)
	})
})

describe("outcome", () => {
	test("#given a promised pdf and docx #when verified before and after setting them #then verify fails then passes", async () => {
		// given
		const dir = sessionDir()
		const pdf = join(dir, "report.pdf")
		writeFileSync(pdf, "x")
		await run(["outcome", "init", "--session-dir", dir, "--promised", "pdf,docx", "--lane", "no-format"])
		// when
		const before = await run(["outcome", "verify", "--session-dir", dir])
		await run(["outcome", "set", "pdf", "delivered", "--path", pdf, "--session-dir", dir])
		await run(["outcome", "set", "docx", "skipped", "--reason", "no editing audience", "--session-dir", dir])
		await run(["outcome", "gate", "static", "pass", "--session-dir", dir])
		const after = await run(["outcome", "verify", "--session-dir", dir])
		// then
		expect(before.exitCode).toBe(1)
		expect(after.exitCode).toBe(0)
		const manifest = JSON.parse(readFileSync(join(dir, "outcome.json"), "utf8"))
		expect(manifest.deliverables.find((row: { format: string }) => row.format === "pdf").path).toBe(pdf)
		expect(manifest.gates.static).toBe("pass")
	})

	test("#given a ledger and a fixed now #when the briefing is asked as JSON #then counts come from the ledger and the dir stamp", async () => {
		const dir = sessionDir()
		await run(["outcome", "init", "--session-dir", dir, "--promised", "html"])
		writeFileSync(join(dir, "sources-ledger.md"), ["[S1] https://a.example/x", "[S2] https://b.example/y", "[Source 3] https://a.example/z"].join("\n"))
		const start = new Date(2026, 0, 1, 12, 0, 0)
		const now = new Date(start.getTime() + 61 * 60_000).toISOString()
		const result = await run(["outcome", "briefing", "--json", "--session-dir", dir, "--now", now])
		expect(result.json.sources).toBe(3)
		expect(result.json.domains).toBe(2)
		expect(result.json.minutes).toBe(61)
	})
})

describe("repair decide", () => {
	test("#given three minor code sets with the same measure #when decided in turn #then the third call stops on plateau", async () => {
		const dir = sessionDir()
		const state = join(dir, "repair-state.json")
		const reasons = []
		for (const [index, code] of ["heading_generic", "heading_too_long", "en_dash_in_prose"].entries()) {
			const result = await run(["repair", "decide", "--state", state, "--defects", defectsFile(dir, `d${index}.json`, [code]), "--artifact-bytes", "4096", "--renders", "1", "--max-attempts", "5"])
			reasons.push(result.json.decision.reason)
		}
		expect(reasons.at(-1)).toBe("plateau")
	})

	test("#given the same defects twice #when decided #then the second call stops on oscillation", async () => {
		const dir = sessionDir()
		const state = join(dir, "repair-state.json")
		const file = defectsFile(dir, "d.json", ["heading_generic"])
		await run(["repair", "decide", "--state", state, "--defects", file, "--artifact-bytes", "4096", "--renders", "1"])
		const second = await run(["repair", "decide", "--state", state, "--defects", file, "--artifact-bytes", "4096", "--renders", "1"])
		expect(second.json.decision.reason).toBe("oscillation")
		expect(second.json.decision.action).toBe("deliver")
	})

	test("#given no artifact proof #when a stop condition holds #then delivery is blocked (fail closed)", async () => {
		const dir = sessionDir()
		const state = join(dir, "repair-state.json")
		const file = defectsFile(dir, "d.json", ["heading_generic"])
		await run(["repair", "decide", "--state", state, "--defects", file])
		const second = await run(["repair", "decide", "--state", state, "--defects", file])
		expect(second.json.decision.action).toBe("block")
		expect(second.exitCode).toBe(1)
	})
})

describe("layout-probe", () => {
	test("#given --json #when run #then the source is an async IIFE", async () => {
		const result = await run(["layout-probe", "--json", "--cap", "20"])
		expect(result.json.source.startsWith("(async () => {")).toBe(true)
		expect(result.json.source).toContain("const CAP = 20;")
	})
})

describe("manifest bookkeeping", () => {
	test("#given a session manifest #when repair decides deliver-on-exhaustion #then outcome.json carries the repair summary and the residual defects", async () => {
		// given
		const dir = sessionDir()
		await run(["outcome", "init", "--session-dir", dir, "--promised", "html"])
		const state = join(dir, "repair-state.json")
		const file = defectsFile(dir, "d.json", ["heading_generic"])
		const proof = ["--artifact-bytes", "4096", "--renders", "1", "--session-dir", dir]
		// when
		await run(["repair", "decide", "--state", state, "--defects", file, ...proof])
		await run(["repair", "decide", "--state", state, "--defects", file, ...proof])
		// then
		const manifest = JSON.parse(readFileSync(join(dir, "outcome.json"), "utf8"))
		expect(manifest.repair).toEqual({ attempts: 2, action: "deliver", reason: "oscillation" })
		expect(manifest.residualDefects.map((d: { code: string }) => d.code)).toEqual(["heading_generic"])
		const briefing = await run(["outcome", "briefing", "--json", "--session-dir", dir])
		expect(briefing.json.residualDefects).toBe(1)
		expect(briefing.json.repair).toEqual({ attempts: 2, action: "deliver", reason: "oscillation" })
	})

	test("#given a clean repair decision #when recorded #then residual defects are emptied", async () => {
		const dir = sessionDir()
		await run(["outcome", "init", "--session-dir", dir, "--promised", "html"])
		const state = join(dir, "repair-state.json")
		await run(["repair", "decide", "--state", state, "--defects", defectsFile(dir, "a.json", ["heading_generic"]), "--session-dir", dir])
		await run(["repair", "decide", "--state", state, "--defects", defectsFile(dir, "b.json", []), "--session-dir", dir])
		const manifest = JSON.parse(readFileSync(join(dir, "outcome.json"), "utf8"))
		expect(manifest.residualDefects).toEqual([])
		expect(manifest.repair.reason).toBe("clean")
	})

	test("#given a ledger and a fixed now #when the run is finished #then finishedAt, elapsedMinutes and source counts are stamped and still validate", async () => {
		const dir = sessionDir()
		const pdf = join(dir, "report.pdf")
		writeFileSync(pdf, "x")
		await run(["outcome", "init", "--session-dir", dir, "--promised", "pdf"])
		await run(["outcome", "set", "pdf", "delivered", "--path", pdf, "--session-dir", dir])
		writeFileSync(join(dir, "sources-ledger.md"), ["[S1] https://a.example/x", "[S2] https://b.example/y"].join("\n"))
		const now = new Date(new Date(2026, 0, 1, 12, 0, 0).getTime() + 30 * 60_000).toISOString()
		const result = await run(["outcome", "finish", "--session-dir", dir, "--now", now])
		const manifest = JSON.parse(readFileSync(join(dir, "outcome.json"), "utf8"))
		expect(result.exitCode).toBe(0)
		expect(manifest.finishedAt).toBe(now)
		expect(manifest.elapsedMinutes).toBe(30)
		expect(manifest.sources).toEqual({ total: 2, domains: 2 })
		expect((await run(["outcome", "verify", "--session-dir", dir])).exitCode).toBe(0)
	})
})

describe("format-extract exit codes", () => {
	test("#given a pdf reference under node #when extracted #then it exits 2 with the unsupported message", () => {
		const dir = sessionDir()
		const pdf = join(dir, "reference.pdf")
		writeFileSync(pdf, "%PDF-1.7")
		const proc = nodeWithoutBun(["format-extract", pdf, "--out", join(dir, "design-spec.md")])
		expect(proc.exitCode).toBe(2)
		expect(proc.stderr.toString()).toContain("unsupported")
	})

	test("#given an unreachable url #when extracted #then it exits 2", () => {
		const dir = sessionDir()
		const proc = nodeWithoutBun(["format-extract", "http://127.0.0.1:9/report.html", "--from-url", "--out", join(dir, "design-spec.md")])
		expect(proc.exitCode).toBe(2)
	})
})
