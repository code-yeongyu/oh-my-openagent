import { describe, expect, onTestFinished, test } from "bun:test"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"

import { PROMOTION } from "./fact-commands-meaning.mjs"
import { writeFidelityRecord } from "./fidelity-records.mjs"
import { PAIR_KINDS } from "./fact-pairs.mjs"
import { VERDICT_SCHEMA } from "./meaning-check.mjs"
import { POLISH_MARKUP_REASON } from "./polish-apply.mjs"
import { COMMANDS, run } from "./report-tools.mjs"

const SCRIPT = join(import.meta.dir, "report-tools.mjs")
const FIXTURES = join(import.meta.dir, "tests", "fixtures")

function sessionDir() {
	const root = mkdtempSync(join(tmpdir(), "report-tools-cli-"))
	onTestFinished(() => rmSync(root, { recursive: true, force: true }))
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
		expect(COMMANDS).toEqual(["check", "layout-probe", "repair decide", "outcome init", "outcome set", "outcome gate", "outcome render", "outcome state", "outcome verify", "outcome finish", "outcome briefing", "format-extract", "fact add", "fact quote", "fact retract", "fact export", "fact fill", "fact verify", "fact derive", "source snapshot", "claims index"])
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
		await run(["outcome", "gate", "fidelity", "not_run", "--reason", "Fixture has no factual content", "--session-dir", dir])
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
		await run(["outcome", "gate", "fidelity", "not_run", "--reason", "Fixture has no factual content", "--session-dir", dir])
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

const FIDELITY = join(FIXTURES, "fidelity")
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex")

type CliRow = { fact_id: string; kind: string; value: string | null }
type CliJson = { data: { row: CliRow; context: { match: string } }; defects: { code: string }[] }

function nodeJson(args: string[]) {
	const proc = nodeWithoutBun(args)
	const stdout = proc.stdout.toString()
	let json = {} as CliJson
	try {
		json = JSON.parse(stdout) as CliJson
	} catch {}
	return { code: proc.exitCode, json, stdout, stderr: proc.stderr.toString() }
}

/** A session with the locked brief, S4 snapshotted, F1 (span), Q1 (completion), and F<n> (span in mm). */
function fidelitySession() {
	const dir = sessionDir()
	copyFileSync(join(FIXTURES, "fidelity-brief-locked.md"), join(dir, "brief.md"))
	const s = ["--session-dir", dir]
	const snap = nodeJson(["source", "snapshot", "--id", "S4", "--html", join(FIDELITY, "sources", "S4.html"), ...s])
	const add = nodeJson(["fact", "add", "--source", "S4", "--find", "Span length", "--label", "span_len", "--json", ...s])
	const quote = nodeJson(["fact", "quote", "--source", "S4", "--match", "no earlier than 2027", "--label", "completion", "--json", ...s])
	const derive = nodeJson(["fact", "derive", "--op", "convert", "F1", "--to", "mm", "--label", "span_mm", "--json", ...s])
	const mm = derive.json.data?.row?.fact_id
	const source = [
		'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Bridge</title></head><body><h1>Bridge</h1>',
		"<h2>Findings</h2>",
		"<p>The span length is {{F1:span_len}} [S4].</p>",
		`<p>In millimetres the span is {{${mm}:span_mm}} [S4].</p>`,
		"<p>The operator wrote {{Q1:completion}} [S4].</p>",
		"<h2>How this report was made</h2><p>Collected from one cited public page [S4].</p>",
		'<h2>Sources</h2><ol><li id="s4">[S4] Bridge page, retrieved 2026-10-01.</li></ol></body></html>',
	].join("\n")
	writeFileSync(join(dir, "report.src.html"), source)
	return { dir, s, snap, add, quote, derive, mm }
}

function verify(dir: string, report: string, extra: string[] = []) {
	return nodeJson(["fact", "verify", join(dir, report), "--sources", join(dir, "sources"), "--brief", join(dir, "brief.md"), "--session-dir", dir, ...extra])
}

const codesOf = (json: { defects?: { code: string }[] }) => (json.defects ?? []).map((d) => d.code)

describe("fact, source, and claims under node", () => {
	test("#given a fresh session #when snapshot, add, quote, derive, fill, and verify run #then the filled report verifies clean", () => {
		// given
		const { dir, s, snap, add, quote, derive, mm } = fidelitySession()
		// when
		const filled = nodeJson(["fact", "fill", join(dir, "report.src.html"), "--out", join(dir, "report.html"), ...s])
		const checked = verify(dir, "report.html")
		// then
		expect(snap.code).toBe(0)
		expect(add.code).toBe(0)
		expect(add.json.data.row.value).toBe("320")
		expect(add.json.data.context.match).toBe("320 m")
		expect(quote.code).toBe(0)
		expect(quote.json.data.row.fact_id).toBe("Q1")
		expect(derive.code).toBe(0)
		expect(mm).toBe("F2")
		expect(filled.code).toBe(0)
		expect(readFileSync(join(dir, "report.html"), "utf8")).toContain("320,000 mm (320 m)")
		expect(checked.code).toBe(0)
		expect(checked.json.defects).toEqual([])
		const record = JSON.parse(readFileSync(join(dir, "fidelity-defects.json"), "utf8"))
		expect(record.artifact_sha256).toBe(sha256(join(dir, "report.html")))
	})

	test("#given a filled report #when a value is hand-edited or a number typed #then verify exits 1 with the code", () => {
		const { dir, s } = fidelitySession()
		nodeJson(["fact", "fill", join(dir, "report.src.html"), "--out", join(dir, "report.html"), ...s])
		const html = readFileSync(join(dir, "report.html"), "utf8")
		writeFileSync(join(dir, "unit.html"), html.replace("320 m", "320 mm"))
		writeFileSync(join(dir, "typed.html"), html.replace("<h2>How", "<p>Revenue grew 12% [S4].</p>\n<h2>How"))
		const unit = verify(dir, "unit.html")
		const typed = verify(dir, "typed.html")
		expect(unit.code).toBe(1)
		expect(codesOf(unit.json)).toContain("unit_mismatch")
		expect(typed.code).toBe(1)
		expect(codesOf(typed.json)).toContain("untraceable_number")
	})

	test("#given an anchor that is not in the source #when fact add runs #then it exits 1 with fact_not_located and writes no row", () => {
		const { dir, s } = fidelitySession()
		const proc = nodeJson(["fact", "add", "--source", "S4", "--find", "nope", "--label", "x", ...s])
		expect(proc.code).toBe(1)
		expect(proc.stdout).toContain("fact_not_located")
		expect(JSON.parse(readFileSync(join(dir, "fact-ledger.json"), "utf8")).rows.map((r: { fact_id: string }) => r.fact_id)).toEqual(["F1", "Q1", "F2"])
	})

	test("#given a snapshotted source #when snapshotted again with the same or different content #then same is a no-op and different exits 1", () => {
		const { dir, s } = fidelitySession()
		writeFileSync(join(dir, "other.txt"), "Span length: 999 m\n")
		expect(nodeJson(["source", "snapshot", "--id", "S4", "--html", join(FIDELITY, "sources", "S4.html"), ...s]).code).toBe(0)
		expect(nodeJson(["source", "snapshot", "--id", "S4", "--text", join(dir, "other.txt"), ...s]).code).toBe(1)
	})

	test("#given an assumed value with and without a rationale #when added #then the row is kind assumed, and no rationale exits 2", () => {
		const { s } = fidelitySession()
		const added = nodeJson(["fact", "add", "--assumed", "12", "--unit", "%", "--rationale", "planning share chosen by the requester", "--label", "share_assumed", "--json", ...s])
		expect(added.code).toBe(0)
		expect(added.json.data.row.kind).toBe("assumed")
		expect(nodeJson(["fact", "add", "--assumed", "12", "--label", "x", ...s]).code).toBe(2)
	})

	test("#given the fixture claim graph #when claims index runs #then claims.json lists its claims", () => {
		const dir = sessionDir()
		const proc = nodeJson(["claims", "index", join(FIDELITY, "claim-graph.md"), "--out", join(dir, "claims.json")])
		expect(proc.code).toBe(0)
		expect(JSON.parse(readFileSync(join(dir, "claims.json"), "utf8")).claims.length).toBeGreaterThan(0)
	})

	test("#given a ledger #when exported as csv #then rows carry fact_id and plot_value and stderr has the coverage line", () => {
		const { s } = fidelitySession()
		const proc = nodeJson(["fact", "export", "--csv", ...s])
		expect(proc.code).toBe(0)
		expect(proc.stdout.split("\n")[0]).toContain("fact_id")
		expect(proc.stdout).toContain("F2")
		expect(proc.stderr).toContain("1 of 1 sources snapshotted")
	})
})

type Pair = { pair_id: string; kind: string; fact_ids?: string[]; sentence: string; quote?: string }

/** A filled session plus the pair artifact `fact pairs` wrote for it. */
function pairedSession() {
	const session = fidelitySession()
	const { dir, s } = session
	nodeJson(["fact", "fill", join(dir, "report.src.html"), "--out", join(dir, "report.html"), ...s])
	const pairs = nodeJson(["fact", "pairs", join(dir, "report.html"), "--ledger", join(dir, "fact-ledger.json"), "--out", join(dir, "pairs.json"), ...s])
	return { ...session, pairs }
}

function verdicts(dir: string, name: string, tier: string, list: object[]) {
	const file = join(dir, name)
	writeFileSync(file, JSON.stringify({ model_tier: tier, verdicts: list }))
	return file
}

const calibrationRows = (dir: string) =>
	readFileSync(join(dir, "fidelity-calibration.jsonl"), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line))
		.filter((row) => row.header !== true && row.run !== true)

const runLines = (dir: string) =>
	readFileSync(join(dir, "fidelity-calibration.jsonl"), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line))
		.filter((row) => row.run === true)

describe("meaning verifier under node", () => {
	test("#given the filled fixture #when fact pairs runs #then pairs.json holds one quote pair per cited ledger quote", () => {
		const { dir, pairs } = pairedSession()
		const written = JSON.parse(readFileSync(join(dir, "pairs.json"), "utf8"))
		expect(pairs.code).toBe(0)
		expect(written.skipped).toBe(false)
		expect(written.pairs.map((p: Pair) => [p.pair_id, p.kind, p.fact_ids])).toEqual([
			["P1", "quote", ["F1"]],
			["P2", "quote", ["Q1"]],
		])
		expect(written.pairs_sha256).toMatch(/^[0-9a-f]{64}$/)
		expect(Object.keys(written.counts).filter((key) => key !== "total" && key !== "force_strong")).toEqual([...PAIR_KINDS])
		expect(written.verdict_schema).toEqual(JSON.parse(JSON.stringify(VERDICT_SCHEMA)))
	})

	test("#given cheap and strong verdicts agreeing on hedge_dropped #when meaning-check runs #then it exits 1 with one confirmed defect and one calibration line", () => {
		const { dir, s } = pairedSession()
		const drift = { pair_id: "P2", verdict: "drift", drift_kind: "hedge_dropped", fragment: "no earlier than 2027", source_fragment: "we estimate", explanation: "The estimate reads as a fact." }
		const cheap = verdicts(dir, "cheap.json", "cheap", [drift, { pair_id: "P1", verdict: "ok" }])
		const strong = verdicts(dir, "strong.json", "strong", [drift])
		const checked = nodeJson(["fact", "meaning-check", "--pairs", join(dir, "pairs.json"), "--verdicts", cheap, "--verdicts", strong, ...s])
		const record = JSON.parse(readFileSync(join(dir, "fidelity-meaning-defects.json"), "utf8"))
		expect(checked.code).toBe(1)
		expect(codesOf(checked.json)).toEqual(["meaning_drift_confirmed"])
		expect(codesOf(record)).toEqual(["meaning_drift_confirmed"])
		expect(calibrationRows(dir)).toHaveLength(1)
		expect(calibrationRows(dir)[0]).toMatchObject({ pair_id: "P2", drift_kind: "hedge_dropped", confirmed: true, disputed: false })
		const header = JSON.parse(readFileSync(join(dir, "fidelity-calibration.jsonl"), "utf8").split("\n")[0])
		expect(header.promotion).toEqual({ ...PROMOTION })
		const again = nodeJson(["fact", "meaning-check", "--pairs", join(dir, "pairs.json"), "--verdicts", cheap, "--verdicts", strong, ...s])
		expect(again.code).toBe(1)
		expect(calibrationRows(dir)).toHaveLength(1)
	})

	test("#given a dispute on the confirmed pair #when meaning-check runs #then the defect stays and the calibration line is disputed", () => {
		const { dir, s } = pairedSession()
		const drift = { pair_id: "P2", verdict: "drift", drift_kind: "hedge_dropped", fragment: "no earlier than 2027", source_fragment: "we estimate" }
		const files = ["--verdicts", verdicts(dir, "cheap.json", "cheap", [drift, { pair_id: "P1", verdict: "ok" }]), "--verdicts", verdicts(dir, "strong.json", "strong", [drift])]
		const checked = nodeJson(["fact", "meaning-check", "--pairs", join(dir, "pairs.json"), ...files, "--dispute", "P2", "--reason", "the operator states it", ...s])
		expect(checked.code).toBe(1)
		expect(codesOf(checked.json)).toEqual(["meaning_drift_confirmed"])
		expect(calibrationRows(dir)[0]).toMatchObject({ pair_id: "P2", disputed: true, reason: "the operator states it" })
	})

	test("#given a dropped verdict and an unread pair #when meaning-check runs #then both pairs are meaning_unverified and it exits 1", () => {
		const { dir, s } = pairedSession()
		const cheap = verdicts(dir, "cheap.json", "cheap", [{ pair_id: "P2", verdict: "drift", drift_kind: "hedge_dropped", fragment: "certainly by 2027", source_fragment: "we estimate" }])
		const checked = nodeJson(["fact", "meaning-check", "--pairs", join(dir, "pairs.json"), "--verdicts", cheap, ...s])
		const summary = JSON.parse(checked.stderr.trim().split("\n").at(-1) ?? "{}")
		expect(checked.code).toBe(1)
		expect(checked.json.status).toBe("fail")
		expect(codesOf(checked.json)).toEqual(["meaning_unverified", "meaning_unverified"])
		expect(checked.json.unverified.map((gap: { pair_id: string }) => gap.pair_id)).toEqual(["P1", "P2"])
		expect(summary).toMatchObject({ command: "fact meaning-check", defects: 2, dropped: 1, unverified: 2 })
	})

	test("#given an unreadable verdict file or a malformed pairs file #when meaning-check runs #then it exits 2", () => {
		const { dir, s } = pairedSession()
		const broken = join(dir, "broken.json")
		writeFileSync(broken, "{ not json")
		expect(nodeJson(["fact", "meaning-check", "--pairs", join(dir, "pairs.json"), "--verdicts", broken, ...s]).code).toBe(2)
		const ok = verdicts(dir, "cheap.json", "cheap", [])
		for (const body of ["{}", "null", '{ "pairs": "P1" }']) {
			writeFileSync(join(dir, "bad-pairs.json"), body)
			expect(nodeJson(["fact", "meaning-check", "--pairs", join(dir, "bad-pairs.json"), "--verdicts", ok, ...s]).code, body).toBe(2)
		}
	})

	test("#given a confirmed run then a dispute on the same inputs #when meaning-check reruns #then the log still holds one run with the dispute", () => {
		const { dir, s } = pairedSession()
		const drift = { pair_id: "P2", verdict: "drift", drift_kind: "hedge_dropped", fragment: "no earlier than 2027", source_fragment: "we estimate" }
		const files = ["--verdicts", verdicts(dir, "cheap.json", "cheap", [drift, { pair_id: "P1", verdict: "ok" }]), "--verdicts", verdicts(dir, "strong.json", "strong", [drift])]
		const first = nodeJson(["fact", "meaning-check", "--pairs", join(dir, "pairs.json"), ...files, ...s])
		const disputed = nodeJson(["fact", "meaning-check", "--pairs", join(dir, "pairs.json"), ...files, "--dispute", "P2", "--reason", "the operator states it", ...s])
		expect(disputed.code).toBe(1)
		expect(disputed.json.run_id).toBe(first.json.run_id)
		expect(disputed.json.promotion_eligibility).toMatchObject({ runs: 1, confirmed: 1, disputed_confirmed: 1, disputed_to_confirmed: 1 })
		expect(calibrationRows(dir)).toEqual([expect.objectContaining({ pair_id: "P2", disputed: true, reason: "the operator states it" })])
		const plain = nodeJson(["fact", "meaning-check", "--pairs", join(dir, "pairs.json"), ...files, ...s])
		expect(plain.json.promotion_eligibility).toMatchObject({ runs: 1, disputed_confirmed: 1 })
	})

	test("#given a run with no flagged pair #when meaning-check runs #then the run is still logged and counted", () => {
		const { dir, s } = pairedSession()
		const ok = (pair_id: string) => ({ pair_id, verdict: "ok" })
		const files = ["--verdicts", verdicts(dir, "cheap.json", "cheap", [ok("P1"), ok("P2")]), "--verdicts", verdicts(dir, "strong.json", "strong", [ok("P1"), ok("P2")])]
		const checked = nodeJson(["fact", "meaning-check", "--pairs", join(dir, "pairs.json"), ...files, ...s])
		expect(checked.code).toBe(0)
		expect(calibrationRows(dir)).toEqual([])
		expect(runLines(dir)).toEqual([expect.objectContaining({ run_id: checked.json.run_id, flagged: 0 })])
		expect(checked.json.promotion_eligibility.runs).toBe(1)
	})

	test("#given a corrupt calibration log #when meaning-check runs #then it exits 2 naming the file and line", () => {
		const { dir, s } = pairedSession()
		writeFileSync(join(dir, "fidelity-calibration.jsonl"), "{ not json\n")
		const checked = nodeJson(["fact", "meaning-check", "--pairs", join(dir, "pairs.json"), "--verdicts", verdicts(dir, "cheap.json", "cheap", []), ...s])
		expect(checked.code).toBe(2)
		expect(checked.stderr).toContain(`${join(dir, "fidelity-calibration.jsonl")}:1`)
	})

	test("#given a skipped pairs file #when meaning-check runs #then it is accepted only when the locked brief says off", () => {
		const { dir, s } = fidelitySession()
		const skip = join(dir, "skip.json")
		writeFileSync(skip, JSON.stringify({ schemaVersion: 1, skipped: true, pairs: [] }))
		const check = () => nodeJson(["fact", "meaning-check", "--pairs", skip, "--verdicts", verdicts(dir, "cheap.json", "cheap", []), ...s])
		const on = check()
		expect(on.code).toBe(1)
		expect(on.json.error).toBe("meaning_check_required")
		writeFileSync(join(dir, "brief.md"), "# Brief\n")
		expect(check().json.error).toBe("fidelity_interview_incomplete")
		expect(check().code).toBe(1)
		writeFileSync(join(dir, "brief.md"), readFileSync(join(FIXTURES, "fidelity-brief-locked.md"), "utf8").replace("meaning check: on", "meaning check: off"))
		const off = check()
		expect(off.code).toBe(0)
		expect(off.json.status).toBe("skipped")
	})

	test("#given a brief with meaning check off #when fact pairs runs #then it exits 0 and writes skipped", () => {
		const { dir, s } = fidelitySession()
		const brief = readFileSync(join(dir, "brief.md"), "utf8").replace("meaning check: on", "meaning check: off")
		writeFileSync(join(dir, "brief.md"), brief)
		nodeJson(["fact", "fill", join(dir, "report.src.html"), "--out", join(dir, "report.html"), ...s])
		const pairs = nodeJson(["fact", "pairs", join(dir, "report.html"), "--out", join(dir, "pairs.json"), ...s])
		expect(pairs.code).toBe(0)
		expect(JSON.parse(readFileSync(join(dir, "pairs.json"), "utf8"))).toMatchObject({ skipped: true })
	})
})

type PolishJson = { data: { out: string; applied: number; rejected: number; unlocated: number }; defects: { code: string; index: number; reason?: string }[] }

/** A filled session whose first finding names an acquirer and a target around F1. */
function polishSession() {
	const session = fidelitySession()
	const { dir, s } = session
	const source = readFileSync(join(dir, "report.src.html"), "utf8").replace("<p>The span length is", "<p>Acme acquired Bolt before the span length reached")
	writeFileSync(join(dir, "report.src.html"), source)
	nodeJson(["fact", "fill", join(dir, "report.src.html"), "--out", join(dir, "report.html"), ...s])
	return session
}

function polishApply(dir: string, edits: string) {
	const args = ["fact", "polish-apply", join(dir, "report.html"), "--edits", edits, "--ledger", join(dir, "fact-ledger.json"), "--out", join(dir, "report.polished.html"), "--session-dir", dir]
	const proc = nodeJson(args)
	return { ...proc, json: proc.json as unknown as PolishJson }
}

describe("polish wiring under node", () => {
	test("#given the fixture edits #when fact polish-apply runs #then it exits 0, applies the wording edit, and rejects the numeral edit", () => {
		const { dir } = polishSession()
		const applied = polishApply(dir, join(FIDELITY, "polish-edits.json"))
		const polished = readFileSync(join(dir, "report.polished.html"), "utf8")
		expect(applied.code).toBe(0)
		expect(applied.json.data).toMatchObject({ applied: 1, rejected: 1, unlocated: 0 })
		expect(applied.json.defects.map((d) => [d.code, d.index])).toEqual([["polish_edit_rejected", 1]])
		expect(polished).toContain("Collected from a single cited public page")
		expect(polished).toContain("retrieved 2026-10-01")
		expect(polished).not.toContain("2026-10-02")
	})

	test("#given an edit that adds an attribute #when polish-apply and polish-diff run #then apply refuses it as markup changed and diff exits 1", () => {
		const { dir } = polishSession()
		const html = readFileSync(join(dir, "report.html"), "utf8")
		const edits = join(dir, "attribute.json")
		writeFileSync(edits, JSON.stringify([{ before: "<h2>Findings</h2>", after: '<h2 id="findings">Findings</h2>', reason: "anchor" }]))
		const applied = polishApply(dir, edits)
		expect(applied.code).toBe(0)
		expect(applied.json.data).toMatchObject({ applied: 0, rejected: 1, unlocated: 0 })
		expect(applied.json.defects.map((d) => [d.code, d.index])).toEqual([["polish_edit_rejected", 0]])
		expect(applied.json.defects[0]?.reason).toContain("markup changed")
		expect(readFileSync(join(dir, "report.polished.html"), "utf8")).toBe(html)
		writeFileSync(join(dir, "attribute.html"), html.replace("<h2>Findings</h2>", '<h2 id="findings">Findings</h2>'))
		const diffed = nodeJson(["fact", "polish-diff", "--before", join(dir, "report.html"), "--after", join(dir, "attribute.html"), "--ledger", join(dir, "fact-ledger.json"), "--session-dir", dir])
		expect(diffed.code).toBe(1)
		expect(codesOf(diffed.json)).toContain("polish_diff_fail")
		expect(JSON.stringify(diffed.json)).toContain("markup changed")
	})

	test("#given an edit whose before holds & #when fact polish-apply runs #then it prints polish-apply's own markup reason verbatim for that edit", () => {
		const { dir } = polishSession()
		const before = "Acme & Bolt"
		const edits = join(dir, "ampersand.json")
		writeFileSync(edits, JSON.stringify([{ before, after: "Acme and Bolt", reason: "ampersand" }]))
		const applied = polishApply(dir, edits)
		const line = `  rejected edit 0 ("${before}"): ${POLISH_MARKUP_REASON}`
		expect(applied.code).toBe(0)
		expect(applied.json.data).toMatchObject({ applied: 0, rejected: 1, unlocated: 0 })
		expect(applied.json.defects.map((d) => [d.code, d.index, d.reason])).toEqual([["polish_edit_rejected", 0, POLISH_MARKUP_REASON]])
		expect(applied.stderr.split("\n")).toContain(line)
	})

	test("#given a polished copy edited by hand #when fact polish-diff runs #then it exits 1 with polish_diff_fail", () => {
		const { dir } = polishSession()
		const html = readFileSync(join(dir, "report.html"), "utf8")
		writeFileSync(join(dir, "hand.html"), html.replace("320 m", "321 m"))
		const diffed = nodeJson(["fact", "polish-diff", "--before", join(dir, "report.html"), "--after", join(dir, "hand.html"), "--ledger", join(dir, "fact-ledger.json"), "--session-dir", dir])
		expect(diffed.code).toBe(1)
		expect(codesOf(diffed.json)).toContain("polish_diff_fail")
	})

	test("#given an accepted subject and object swap #when fact pairs runs with --changed-since #then only that sentence's pair is emitted, with the new text", () => {
		const { dir, s } = polishSession()
		const edits = join(dir, "swap.json")
		writeFileSync(edits, JSON.stringify([{ before: "Acme acquired Bolt", after: "Bolt acquired Acme", reason: "word order" }]))
		const applied = polishApply(dir, edits)
		const map = join(dir, "report.html.fill-map.json")
		const changed = nodeJson(["fact", "pairs", join(dir, "report.polished.html"), "--changed-since", map, "--out", join(dir, "pairs-changed.json"), ...s])
		const written = JSON.parse(readFileSync(join(dir, "pairs-changed.json"), "utf8"))
		expect(applied.json.data).toMatchObject({ applied: 1, rejected: 0 })
		expect(changed.code).toBe(0)
		expect(written.pairs.map((p: Pair) => [p.kind, p.fact_ids])).toEqual([["quote", ["F1"]]])
		expect(written.pairs[0].sentence).toContain("Bolt acquired Acme")
	})
})

describe("markdown editions under node", () => {
	const MD = ["# Bridge", "", "## Findings", "", "The span length is {{F1:span_len}} [S4].", "", "The operator wrote {{Q1:completion}} [S4].", "", "## How this report was made", "", "Collected from one cited public page [S4].", "", "## Sources", "", "1. [S4] Bridge page, retrieved 2026-10-01.", ""].join("\n")

	function mdSession() {
		const session = fidelitySession()
		writeFileSync(join(session.dir, "report.src.md"), MD)
		const filled = nodeJson(["fact", "fill", join(session.dir, "report.src.md"), "--format", "md", "--out", join(session.dir, "report.md"), ...session.s])
		return { ...session, filled }
	}

	test("#given a markdown source #when filled and verified as md #then verify passes and records the md bytes", () => {
		const { dir, filled } = mdSession()
		const checked = verify(dir, "report.md", ["--format", "md"])
		expect(filled.code).toBe(0)
		expect(readFileSync(join(dir, "report.md"), "utf8")).toContain("The span length is 320 m [S4].")
		expect(checked.code).toBe(0)
		expect(checked.json.defects).toEqual([])
		expect(JSON.parse(readFileSync(join(dir, "fidelity-defects.json"), "utf8")).artifact_sha256).toBe(sha256(join(dir, "report.md")))
	})

	test("#given a filled markdown edition #when a value is hand-edited or a number typed #then md verify exits 1 with the code", () => {
		const { dir } = mdSession()
		const md = readFileSync(join(dir, "report.md"), "utf8")
		writeFileSync(join(dir, "typed.md"), md.replace("## How", "Revenue grew 12% [S4].\n\n## How"))
		copyFileSync(join(dir, "report.md.fill-map.json"), join(dir, "typed.md.fill-map.json"))
		const typed = verify(dir, "typed.md", ["--format", "md"])
		expect(typed.code).toBe(1)
		expect(codesOf(typed.json)).toContain("untraceable_number")
	})

	test("#given a filled markdown edition with an unterminated fence #when verified or paired #then both refuse with exit 2", () => {
		const { dir, s } = mdSession()
		writeFileSync(join(dir, "fence.md"), `${readFileSync(join(dir, "report.md"), "utf8")}\n\`\`\`\nunclosed code\n`)
		copyFileSync(join(dir, "report.md.fill-map.json"), join(dir, "fence.md.fill-map.json"))
		const checked = verify(dir, "fence.md", ["--format", "md"])
		expect(checked.code).toBe(2)
		expect(checked.stderr).toContain("unterminated_fence")
		expect(nodeJson(["fact", "pairs", join(dir, "fence.md"), "--out", join(dir, "pairs.json"), ...s]).code).toBe(2)
	})

	test("#given a filled markdown edition #when fact pairs runs on it #then it pairs the same quotes as the html edition", () => {
		const { dir, s } = mdSession()
		const pairs = nodeJson(["fact", "pairs", join(dir, "report.md"), "--out", join(dir, "pairs.json"), ...s])
		expect(pairs.code).toBe(0)
		expect(JSON.parse(readFileSync(join(dir, "pairs.json"), "utf8")).pairs.map((p: Pair) => p.fact_ids)).toEqual([["F1"], ["Q1"]])
	})
})

describe("repair decide with several defect files", () => {
	test("#given two --defects files #when decided #then the attempt signature carries both codes", async () => {
		const dir = sessionDir()
		const state = join(dir, "repair-state.json")
		await run(["repair", "decide", "--state", state, "--defects", defectsFile(dir, "a.json", ["heading_generic"]), "--defects", defectsFile(dir, "b.json", ["untraceable_number"])])
		const signature = JSON.parse(readFileSync(state, "utf8")).attempts[0].signature
		expect(signature).toContain("heading_generic")
		expect(signature).toContain("untraceable_number")
	})
})

describe("fidelity delivery barrier", () => {
	/** The locked brief has meaning check on, so a deliverable session also carries a clean meaning record. */
	const meaningRan = (dir: string) => writeFidelityRecord(join(dir, "fidelity-meaning-defects.json"), "meaning", { artifact_sha256: sha256(join(dir, "report.html")), report: join(dir, "report.html"), defects: [] })

	async function deliveredSession(codes: string[]) {
		const { dir, s } = fidelitySession()
		nodeJson(["fact", "fill", join(dir, "report.src.html"), "--out", join(dir, "report.html"), ...s])
		meaningRan(dir)
		const record = (list: string[]) => writeFidelityRecord(join(dir, "fidelity-defects.json"), "fidelity", { artifact_sha256: sha256(join(dir, "report.html")), report: join(dir, "report.html"), defects: list.map((code) => ({ code, message: code })) })
		record(codes)
		await run(["outcome", "init", "--session-dir", dir, "--promised", "html"])
		await run(["outcome", "set", "html", "delivered", "--path", join(dir, "report.html"), "--verified-by", join(dir, "fidelity-defects.json"), "--session-dir", dir])
		const decide = ["repair", "decide", "--state", join(dir, "repair-state.json"), "--defects", join(dir, "fidelity-defects.json"), "--artifact-bytes", "4096", "--renders", "1", "--session-dir", dir]
		await run(decide)
		const decision = await run(decide)
		return { dir, record, decision }
	}

	test("#given a clean meaning record #when the report is edited and fact verify re-run #then the stale meaning record refuses, and a fresh one passes", async () => {
		// given: meaning check on, readers clean, the edition verified and delivered
		const { dir, s } = pairedSession()
		const report = join(dir, "report.html")
		const clean = [{ pair_id: "P1", verdict: "ok" }, { pair_id: "P2", verdict: "ok" }]
		const readers = () => nodeJson(["fact", "meaning-check", "--pairs", join(dir, "pairs.json"), "--verdicts", verdicts(dir, "cheap.json", "cheap", clean), "--verdicts", verdicts(dir, "strong.json", "strong", clean), ...s])
		expect(readers().code).toBe(0)
		expect(verify(dir, "report.html").code).toBe(0)
		await run(["outcome", "init", "--session-dir", dir, "--promised", "html"])
		await run(["outcome", "set", "html", "delivered", "--path", report, "--verified-by", join(dir, "fidelity-defects.json"), "--session-dir", dir])
		const first = await run(["outcome", "verify", "--session-dir", dir])
		// when: draft 2 (a repair rewrite) is re-verified by fact verify only
		writeFileSync(report, `${readFileSync(report, "utf8")}\n<!-- draft 2 -->\n`)
		expect(verify(dir, "report.html").code).toBe(0)
		const stale = await run(["outcome", "verify", "--session-dir", dir])
		// when: the meaning readers run again on draft 2
		expect(nodeJson(["fact", "pairs", report, "--out", join(dir, "pairs.json"), ...s]).code).toBe(0)
		expect(readers().code).toBe(0)
		const fresh = await run(["outcome", "verify", "--session-dir", dir])
		// then
		expect(first.exitCode).toBe(0)
		expect(stale.exitCode).toBe(1)
		expect(stale.json.problems).toContainEqual(expect.objectContaining({ code: "edition_unverified", path: join(dir, "fidelity-meaning-defects.json"), message: expect.stringContaining("meaning record") }))
		expect(fresh.exitCode).toBe(0)
	})

	test("#given an unregistered appendix value #when verified #then untraceable_number and outcome verify refuses", async () => {
		const { dir, s } = fidelitySession()
		nodeJson(["fact", "fill", join(dir, "report.src.html"), "--out", join(dir, "report.html"), ...s])
		const html = readFileSync(join(dir, "report.html"), "utf8").replace("<h2>How", "<h2>Appendix</h2>\n<p>Revenue grew 12% [S4].</p>\n<h2>How")
		writeFileSync(join(dir, "report.html"), html)
		const checked = verify(dir, "report.html")
		await run(["outcome", "init", "--session-dir", dir, "--promised", "html"])
		await run(["outcome", "set", "html", "delivered", "--path", join(dir, "report.html"), "--verified-by", join(dir, "fidelity-defects.json"), "--session-dir", dir])
		const outcome = await run(["outcome", "verify", "--session-dir", dir])
		expect(codesOf(checked.json)).toContain("untraceable_number")
		expect(outcome.exitCode).toBe(1)
		expect(outcome.json.problems.map((p: { code: string }) => p.code)).toContain("fidelity_unresolved")
	})

	for (const code of ["untraceable_number", "unbound_sentence"]) {
		test(`#given ${code} left after repair delivers on exhaustion #when verified and finished #then both refuse, and an empty record passes`, async () => {
			const { dir, record, decision } = await deliveredSession([code])
			const refused = await run(["outcome", "verify", "--session-dir", dir])
			const finish = await run(["outcome", "finish", "--session-dir", dir])
			record([])
			const passed = await run(["outcome", "verify", "--session-dir", dir])
			const finished = await run(["outcome", "finish", "--session-dir", dir])
			expect(decision.json.decision.action).toBe("deliver")
			expect(refused.exitCode).toBe(1)
			expect(JSON.stringify(refused.json.problems)).toContain(`fidelity_unresolved: ${code}`)
			expect(finish.exitCode).toBe(1)
			expect(passed.exitCode).toBe(0)
			expect(finished.exitCode).toBe(0)
		})
	}

	test("#given a clean main report and an inline edition #when the edition lacks or mismatches its verify record #then edition_unverified, and its own record passes", async () => {
		// given
		const { dir, s } = fidelitySession()
		nodeJson(["fact", "fill", join(dir, "report.src.html"), "--out", join(dir, "report.html"), ...s])
		expect(verify(dir, "report.html").code).toBe(0)
		meaningRan(dir)
		expect(nodeJson(["fact", "fill", join(dir, "report.src.html"), "--inline", "--out", join(dir, "report.inline.html"), ...s]).code).toBe(0)
		await run(["outcome", "init", "--session-dir", dir, "--promised", "html,pdf"])
		await run(["outcome", "set", "html", "delivered", "--path", join(dir, "report.html"), "--verified-by", join(dir, "fidelity-defects.json"), "--session-dir", dir])
		const problems = async () => {
			const result = await run(["outcome", "verify", "--session-dir", dir])
			return { exitCode: result.exitCode, codes: result.json.problems.map((p: { code: string }) => p.code) }
		}
		// when: no --verified-by
		await run(["outcome", "set", "pdf", "delivered", "--path", join(dir, "report.inline.html"), "--session-dir", dir])
		const missing = await problems()
		// when: a record for different bytes
		expect(verify(dir, "report.inline.html", ["--out", join(dir, "fidelity-inline.json")]).code).toBe(0)
		const inline = readFileSync(join(dir, "report.inline.html"), "utf8")
		writeFileSync(join(dir, "report.inline.html"), inline.replace("320,000 mm", "330,000 mm"))
		await run(["outcome", "set", "pdf", "delivered", "--path", join(dir, "report.inline.html"), "--verified-by", join(dir, "fidelity-inline.json"), "--session-dir", dir])
		const altered = await problems()
		// when: restored to the verified bytes
		writeFileSync(join(dir, "report.inline.html"), inline)
		const matched = await problems()
		// then
		expect(missing).toEqual({ exitCode: 1, codes: ["edition_unverified"] })
		expect(altered).toEqual({ exitCode: 1, codes: ["edition_unverified"] })
		expect(matched).toEqual({ exitCode: 0, codes: [] })
	})
})

/** Rewrite one `## Fidelity` field line of the session's brief.md. */
function setField(dir: string, field: string, value: string, answeredBy = "user") {
	const path = join(dir, "brief.md")
	const line = new RegExp(`^${field}: .*$`, "mu")
	writeFileSync(path, readFileSync(path, "utf8").replace(line, `${field}: ${value} (answered_by: ${answeredBy})`))
}

function fillTemplate(dir: string, body: string, extra: string[] = []) {
	const source = ['<!doctype html><html lang="en"><head><meta charset="utf-8"><title>T</title></head><body><h1>T</h1>', "<h2>Findings</h2>", body, "</body></html>"].join("\n")
	writeFileSync(join(dir, "t.src.html"), source)
	return nodeJson(["fact", "fill", join(dir, "t.src.html"), "--out", join(dir, "t.html"), "--session-dir", dir, ...extra])
}

/** Snapshot a one-line text source under `id` with the given provenance (omitted: unknown) and register its span row. */
function textSource(dir: string, id: string, provenance?: string) {
	writeFileSync(join(dir, `${id}.txt`), "Commentary: the span length is 320 m according to this review.\n")
	const prov = provenance === undefined ? [] : ["--provenance", provenance]
	const snap = nodeJson(["source", "snapshot", "--id", id, "--text", join(dir, `${id}.txt`), "--kind", "document", ...prov, "--session-dir", dir])
	const add = nodeJson(["fact", "add", "--source", id, "--find", "span length", "--label", `span_${id.toLowerCase()}`, "--json", "--session-dir", dir])
	return { snap, row: add.json.data?.row }
}

const ledgerRow = (dir: string, id: string) => JSON.parse(readFileSync(join(dir, "fact-ledger.json"), "utf8")).rows.find((r: { fact_id: string }) => r.fact_id === id)

describe("fidelity brief lock and policy under node", () => {
	test("#given a filled session whose brief turns pending #when each reader-facing command runs #then all six exit 1 with only fidelity_interview_incomplete and write nothing", () => {
		// given
		const { dir, s } = pairedSession()
		copyFileSync(join(FIXTURES, "fidelity-brief-pending.md"), join(dir, "brief.md"))
		for (const name of ["fidelity-defects.json", "pairs.json"]) rmSync(join(dir, name), { force: true })
		const drift = verdicts(dir, "cheap.json", "cheap", [])
		writeFileSync(join(dir, "edits.json"), "[]")
		// when
		const runs = {
			fill: nodeJson(["fact", "fill", join(dir, "report.src.html"), "--out", join(dir, "again.html"), ...s]),
			verify: verify(dir, "report.html"),
			pairs: nodeJson(["fact", "pairs", join(dir, "report.html"), "--out", join(dir, "pairs.json"), ...s]),
			meaning: nodeJson(["fact", "meaning-check", "--pairs", join(dir, "absent-pairs.json"), "--verdicts", drift, ...s]),
			polishApply: nodeJson(["fact", "polish-apply", join(dir, "report.html"), "--edits", join(dir, "edits.json"), "--out", join(dir, "polished.html"), ...s]),
			polishDiff: nodeJson(["fact", "polish-diff", "--before", join(dir, "report.html"), "--after", join(dir, "report.html"), "--out", join(dir, "polish.json"), ...s]),
		}
		// then
		for (const [name, result] of Object.entries(runs)) {
			expect({ name, code: result.code, codes: codesOf(result.json) }).toEqual({ name, code: 1, codes: ["fidelity_interview_incomplete"] })
		}
		for (const name of ["again.html", "fidelity-defects.json", "pairs.json", "polished.html", "polish.json", "fidelity-meaning-defects.json"]) expect({ name, exists: existsSync(join(dir, name)) }).toEqual({ name, exists: false })
	})

	test("#given derived numbers none #when a derived or a converted placeholder is filled #then derived_not_allowed, and allowed renders both", () => {
		// given
		const { dir, s, mm } = fidelitySession()
		const expr = nodeJson(["fact", "derive", "--op", "expr", "F1 * 2", "--unit", "m", "--rationale", "two spans", "--label", "two_spans", "--json", ...s])
		const twice = expr.json.data.row.fact_id
		setField(dir, "derived numbers", "none")
		// when
		const derived = fillTemplate(dir, `<p>Two spans are {{${twice}:two_spans}} [S4].</p>`)
		const converted = fillTemplate(dir, `<p>The span is {{${mm}:span_mm}} [S4].</p>`)
		setField(dir, "derived numbers", "allowed")
		const allowed = fillTemplate(dir, `<p>Two spans are {{${twice}:two_spans}} [S4]. The span is {{${mm}:span_mm}} [S4].</p>`)
		// then
		expect(expr.code).toBe(0)
		expect([derived.code, codesOf(derived.json)]).toEqual([1, ["derived_not_allowed"]])
		expect([converted.code, codesOf(converted.json)]).toEqual([1, ["derived_not_allowed"]])
		expect(allowed.code).toBe(0)
		expect(readFileSync(join(dir, "t.html"), "utf8")).toContain("320,000 mm")
	})

	test("#given source floor primary only #when rows from secondary, unknown, and primary sources are filled #then only the primary row renders", () => {
		// given
		const { dir } = fidelitySession()
		const secondary = textSource(dir, "S7", "secondary")
		const unknown = textSource(dir, "S8")
		const primary = textSource(dir, "S6", "primary")
		setField(dir, "source floor", "primary only")
		// when
		const fills = [secondary, unknown, primary].map(({ row }) => fillTemplate(dir, `<p>The span is {{${row.fact_id}:${row.label}}} [S4].</p>`))
		// then
		expect([secondary.snap.json, unknown.snap.json, primary.snap.json].map((json) => (json as unknown as { data: { provenance: string } }).data.provenance)).toEqual(["secondary", "unknown", "primary"])
		expect(fills.map((f) => [f.code, codesOf(f.json)])).toEqual([
			[1, ["source_outside_floor"]],
			[1, ["source_outside_floor"]],
			[0, []],
		])
	})

	test("#given a row registered while source floor is pending #when the floor locks to pointed only S4, then standard #then fill refuses, then renders, and outside_floor caches each result", () => {
		// given
		const { dir } = fidelitySession()
		setField(dir, "source floor", "pending", "pending")
		const { snap, row } = textSource(dir, "S9")
		const body = `<p>The span is {{${row.fact_id}:${row.label}}} [S9].</p>`
		// when
		setField(dir, "source floor", "pointed only: S4")
		const refused = fillTemplate(dir, body)
		const cachedRefused = ledgerRow(dir, row.fact_id).outside_floor
		setField(dir, "source floor", "standard")
		const rendered = fillTemplate(dir, body)
		// then
		expect(snap.code).toBe(0)
		expect(row.outside_floor).toBe(false)
		expect([refused.code, codesOf(refused.json)]).toEqual([1, ["source_outside_floor"]])
		expect(cachedRefused).toBe(true)
		expect(rendered.code).toBe(0)
		expect(ledgerRow(dir, row.fact_id).outside_floor).toBe(false)
	})

	test("#given a markdown translation comment after a quote #when languages is translation beside, then quotes original #then fact pairs emits a translation pair only for the first", () => {
		// given
		const { dir, s } = fidelitySession()
		const md = ["# T", "", "## Findings", "", "The operator wrote {{Q1:completion}} <!-- translates: Q1 --> completion comes in 2027 at the earliest [S4].", ""].join("\n")
		writeFileSync(join(dir, "t.src.md"), md)
		const kinds = () => {
			const filled = nodeJson(["fact", "fill", join(dir, "t.src.md"), "--format", "md", "--out", join(dir, "t.md"), ...s])
			const pairs = nodeJson(["fact", "pairs", join(dir, "t.md"), "--out", join(dir, "pairs.json"), ...s])
			return { fill: filled.code, pairs: pairs.code, kinds: JSON.parse(readFileSync(join(dir, "pairs.json"), "utf8")).pairs.map((p: Pair) => p.kind) }
		}
		// when
		const beside = kinds()
		setField(dir, "languages", "report en; sources en; quotes original")
		const original = kinds()
		// then
		expect(beside).toEqual({ fill: 0, pairs: 0, kinds: ["quote", "translation"] })
		expect(original).toEqual({ fill: 0, pairs: 0, kinds: ["quote"] })
	})

	test("#given a sentence that failed twice #when filled with --replace-failed #then block-quote replaces it and fallback omit removes it", () => {
		// given
		const { dir } = fidelitySession()
		const state = { schemaVersion: 1, failures: { "findings#F1": 2 }, replaced: [] }
		const body = "<p>The span length is {{F1:span_len}} [S4]. The operator wrote {{Q1:completion}} [S4].</p>"
		// when
		writeFileSync(join(dir, "fidelity-state.json"), JSON.stringify(state))
		const quoted = fillTemplate(dir, body, ["--replace-failed"])
		const quotedHtml = readFileSync(join(dir, "t.html"), "utf8")
		setField(dir, "fallback", "omit")
		writeFileSync(join(dir, "fidelity-state.json"), JSON.stringify(state))
		const omitted = fillTemplate(dir, body, ["--replace-failed"])
		const omittedHtml = readFileSync(join(dir, "t.html"), "utf8")
		// then
		expect(quoted.code).toBe(0)
		expect(quotedHtml).toContain("<blockquote")
		expect(omitted.code).toBe(0)
		expect(omittedHtml).not.toContain("<blockquote")
		expect(omittedHtml).not.toContain("The span length is")
		expect(omittedHtml).toContain("The operator wrote")
	})

	test("#given --calibration #when meaning-check flags a pair #then the calibration line goes to that path, not the session default", () => {
		const { dir, s } = pairedSession()
		const drift = { pair_id: "P2", verdict: "drift", drift_kind: "hedge_dropped", fragment: "no earlier than 2027", source_fragment: "we estimate" }
		const log = join(dir, "custom-calibration.jsonl")
		const checked = nodeJson(["fact", "meaning-check", "--pairs", join(dir, "pairs.json"), "--verdicts", verdicts(dir, "cheap.json", "cheap", [drift, { pair_id: "P1", verdict: "ok" }]), "--calibration", log, ...s])
		const rows = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)).filter((row) => row.header !== true && row.run !== true)
		expect(checked.code).toBe(0)
		expect(rows).toHaveLength(1)
		expect(existsSync(join(dir, "fidelity-calibration.jsonl"))).toBe(false)
	})
})

describe("fidelity brief values, sourceless rows, and the brief binding under node", () => {
	test("#given derived numbers or fallback off its table #when fact fill runs #then a usage error names the field and value and nothing is written", () => {
		// given
		const { dir, s } = fidelitySession()
		const twice = nodeJson(["fact", "derive", "--op", "expr", "F1 * 2", "--unit", "m", "--rationale", "two spans", "--label", "two_spans", "--json", ...s]).json.data.row.fact_id
		// when
		setField(dir, "derived numbers", "nope")
		const derived = fillTemplate(dir, `<p>Two spans are {{${twice}:two_spans}} [S4].</p>`)
		setField(dir, "derived numbers", "allowed")
		setField(dir, "fallback", "drop")
		const fallback = fillTemplate(dir, "<p>The span length is {{F1:span_len}} [S4].</p>")
		// then
		expect({ code: derived.code, named: derived.stderr.includes('derived numbers "nope"') }).toEqual({ code: 2, named: true })
		expect({ code: fallback.code, named: fallback.stderr.includes('fallback "drop"') }).toEqual({ code: 2, named: true })
		expect(existsSync(join(dir, "t.html"))).toBe(false)
	})

	test("#given an assumed row #when filled under primary only, then standard #then the sourceless row is source_outside_floor, then renders", () => {
		// given
		const { dir, s } = fidelitySession()
		const assumed = nodeJson(["fact", "add", "--assumed", "12", "--unit", "%", "--rationale", "planning share chosen by the requester", "--label", "share_assumed", "--json", ...s]).json.data.row.fact_id
		const body = `<p>The planning share is {{${assumed}:share_assumed}}.</p>`
		// when
		setField(dir, "source floor", "primary only")
		const refused = fillTemplate(dir, body)
		setField(dir, "source floor", "standard")
		const rendered = fillTemplate(dir, body)
		// then
		expect([refused.code, codesOf(refused.json)]).toEqual([1, ["source_outside_floor"]])
		expect(JSON.stringify(refused.json)).toContain("no source")
		expect(rendered.code).toBe(0)
	})

	test("#given a derived row whose operand rests on a secondary source #when filled under primary only #then source_outside_floor names that source", () => {
		// given
		const { dir, s } = fidelitySession()
		const { row } = textSource(dir, "S7", "secondary")
		const twice = nodeJson(["fact", "derive", "--op", "expr", `${row.fact_id} * 2`, "--unit", "m", "--rationale", "two spans", "--label", "two_spans", "--json", ...s]).json.data.row.fact_id
		setField(dir, "source floor", "primary only")
		// when
		const refused = fillTemplate(dir, `<p>Two spans are {{${twice}:two_spans}} [S7].</p>`)
		// then
		expect([refused.code, codesOf(refused.json)]).toEqual([1, ["source_outside_floor"]])
		expect(JSON.stringify(refused.json)).toContain("rests on S7")
	})

	test("#given an edition filled under standard from a secondary source #when the brief tightens to primary only #then fact verify refuses with and without its fill map", () => {
		// given
		const { dir, s } = fidelitySession()
		const { row } = textSource(dir, "S7", "secondary")
		const src = readFileSync(join(dir, "report.src.html"), "utf8")
			.replace("<h2>How", `<p>A review gives the span as {{${row.fact_id}:${row.label}}} [S7].</p>\n<h2>How`)
			.replace("</ol>", '<li id="s7">[S7] Bridge review, retrieved 2026-10-01.</li></ol>')
		writeFileSync(join(dir, "report.src.html"), src)
		const filled = nodeJson(["fact", "fill", join(dir, "report.src.html"), "--out", join(dir, "report.html"), ...s])
		const map = join(dir, "report.html.fill-map.json")
		const before = verify(dir, "report.html")
		// when
		setField(dir, "source floor", "primary only")
		const bound = verify(dir, "report.html")
		const record = JSON.parse(readFileSync(join(dir, "fidelity-defects.json"), "utf8"))
		const kept = readFileSync(map, "utf8")
		rmSync(map)
		const unbound = verify(dir, "report.html")
		setField(dir, "source floor", "standard")
		const { brief_sha256: _dropped, ...legacy } = JSON.parse(kept)
		writeFileSync(map, JSON.stringify(legacy))
		const unstamped = verify(dir, "report.html")
		// then
		expect([filled.code, before.code, codesOf(before.json)]).toEqual([0, 0, []])
		expect(typeof JSON.parse(kept).brief_sha256).toBe("string")
		expect(bound.code).toBe(1)
		expect(codesOf(bound.json)).toContain("brief_changed")
		expect(codesOf(bound.json)).toContain("source_outside_floor")
		expect(record.status).toBe("fail")
		expect(unbound.code).toBe(1)
		expect(codesOf(unbound.json)).toContain("source_outside_floor")
		expect(codesOf(unbound.json)).not.toContain("brief_changed")
		expect([unstamped.code, codesOf(unstamped.json)]).toEqual([1, ["brief_changed"]])
	})
})
