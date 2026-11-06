import { describe, expect, onTestFinished, test } from "bun:test"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { PROMOTION } from "../fact-commands-meaning.mjs"
import { writeFidelityRecord } from "../fidelity-records.mjs"
import { PAIR_KINDS } from "../fact-pairs.mjs"
import { VERDICT_SCHEMA } from "../meaning-check.mjs"
import { POLISH_MARKUP_REASON } from "../polish-apply.mjs"
import { COMMANDS, run } from "../report-tools.mjs"


const SCRIPT = join(join(import.meta.dir, ".."), "report-tools.mjs")

const FIXTURES = join(join(import.meta.dir, ".."), "tests", "fixtures")

/** The caller-owned observation time every CLI derive passes (derive never reads the clock). */
const NOW = "2026-10-23T08:00:00Z"


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
	const derive = nodeJson(["fact", "derive", "--op", "convert", "F1", "--to", "mm", "--label", "span_mm", "--now", NOW, "--json", ...s])
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
	const snap = nodeJson(["source", "snapshot", "--id", id, "--raw", join(dir, `${id}.txt`), "--kind", "document", ...prov, "--session-dir", dir])
	const add = nodeJson(["fact", "add", "--source", id, "--find", "span length", "--label", `span_${id.toLowerCase()}`, "--json", "--session-dir", dir])
	return { snap, row: add.json.data?.row }
}


const ledgerRow = (dir: string, id: string) => JSON.parse(readFileSync(join(dir, "fact-ledger.json"), "utf8")).rows.find((r: { fact_id: string }) => r.fact_id === id)
export { SCRIPT, FIXTURES, NOW, sessionDir, nodeWithoutBun, defectsFile, FIDELITY, sha256, CliRow, CliJson, nodeJson, fidelitySession, verify, codesOf, Pair, pairedSession, verdicts, calibrationRows, runLines, PolishJson, polishSession, polishApply, setField, fillTemplate, textSource, ledgerRow }
