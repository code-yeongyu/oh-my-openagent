// report-tools-commands.mjs - one function per report-tools subcommand. Each returns
// { json | text, summary?, exitCode } and never exits the process; report-tools.mjs dispatches.

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import { CliError, parseArgs, readJsonFile, writeJsonAtomic } from "./cli-support.mjs"
import { REPAIR_DEFAULTS } from "./contracts.mjs"
import { parseLineageMode, parsePalette, renderDesignSpec } from "./design-spec.mjs"
import { extractFromHtml, extractFromPath, fetchHtml } from "./format-extract.mjs"
import { checkLayout } from "./gates-layout.mjs"
import { checkStatic } from "./gates-static.mjs"
import { parseHtml } from "./html-lite.mjs"
import { buildProbeSource } from "./layout-probe.mjs"
import * as outcome from "./outcome.mjs"
import { createTracker, decide, deserializeState, isArtifactOk, serializeState } from "./repair-tracker.mjs"

const SEVERITY_ORDER = { blocker: 0, major: 1, minor: 2 }

function readText(path) {
	try {
		return readFileSync(path, "utf8")
	} catch (error) {
		throw new CliError(`cannot read ${path}: ${error.code ?? error.message}`)
	}
}

function nowFrom(flags) {
	if (flags.now === undefined) return new Date()
	const date = new Date(flags.now)
	if (Number.isNaN(date.getTime())) throw new CliError("--now requires an ISO timestamp")
	return date
}

function sessionDirFrom(flags) {
	const dir = flags["session-dir"] ?? process.env.SESSION_DIR
	if (!dir) throw new CliError("--session-dir is required (or set SESSION_DIR)")
	return resolve(dir)
}

export function runCheck(argv) {
	const args = parseArgs(argv, { repeatable: ["require-section"] })
	const reportPath = args.positionals[0]
	if (!reportPath) throw new CliError("usage: check <report.html> --design-spec <design-spec.md> [--layout <boxes.json>] [--require-section <regex>]... [--max-defects N]")
	const specText = readText(args.required("design-spec"))
	const doc = parseHtml(readText(reportPath))
	const requireSections = (args.flags["require-section"] ?? []).map((source) => new RegExp(source, "i"))
	const result = checkStatic(doc, {
		palette: parsePalette(specText),
		lineageMode: parseLineageMode(specText),
		requireSections,
		baseDir: dirname(resolve(reportPath)),
	})
	const defects = [...result.defects]
	const gatesRun = [...result.gatesRun]
	let layout = "not_run"
	if (args.flags.layout !== undefined) {
		const layoutResult = checkLayout(readJsonFile(args.flags.layout))
		defects.push(...layoutResult.defects)
		gatesRun.push("layout")
		layout = layoutResult.defects.some((d) => d.severity === "blocker") ? "fail" : "pass"
	}
	defects.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (a.line ?? 0) - (b.line ?? 0) || a.code.localeCompare(b.code))
	const counts = { blocker: 0, major: 0, minor: 0, total: defects.length }
	for (const defect of defects) counts[defect.severity] += 1
	const max = args.int("max-defects", 200)
	const status = counts.blocker > 0 ? "fail" : "pass"
	const exitCode = status === "fail" ? 1 : 0
	return {
		json: { command: "check", status, exitCode, layout, defects: defects.slice(0, max), counts, gatesRun, gatesSkipped: result.gatesSkipped },
		summary: `check: ${status.toUpperCase()} - ${counts.blocker} blocker, ${counts.major} major, ${counts.minor} minor; layout ${layout}`,
		exitCode,
	}
}

export function runLayoutProbe(argv) {
	const args = parseArgs(argv, { booleans: ["json"] })
	const source = buildProbeSource({ cap: args.int("cap", 400), root: args.flags.root ?? "main, article" })
	return args.flags.json ? { json: { command: "layout-probe", source }, exitCode: 0 } : { text: source, exitCode: 0 }
}

export function runRepairDecide(argv) {
	const args = parseArgs(argv)
	const statePath = args.required("state")
	const now = nowFrom(args.flags)
	const defectsInput = readJsonFile(args.required("defects"))
	const defects = Array.isArray(defectsInput) ? defectsInput : defectsInput.defects
	if (!Array.isArray(defects)) throw new CliError("--defects must be a JSON array or a check result with a defects array")
	const state = existsSync(statePath)
		? deserializeState(readText(statePath))
		: createTracker({
				maxAttempts: args.int("max-attempts", REPAIR_DEFAULTS.maxAttempts),
				plateauLimit: args.int("plateau-limit", REPAIR_DEFAULTS.plateauLimit),
				wallClockMs: args.int("wall-clock-ms", REPAIR_DEFAULTS.wallClockMs),
				startedAt: now,
			})
	// Fail closed: deliver-on-exhaustion needs proof of a usable artifact (bytes and renders).
	const artifactOk =
		args.flags["artifact-bytes"] !== undefined && args.flags.renders !== undefined
			? isArtifactOk({ bytes: Number(args.flags["artifact-bytes"]), renders: Number(args.flags.renders) })
			: false
	const { state: next, decision } = decide(state, defects, now, { artifactOk })
	writeFileSync(statePath, serializeState(next))
	recordRepair(args.flags, next, decision)
	const exitCode = decision.action === "block" ? 1 : 0
	return { json: { command: "repair decide", decision }, summary: `repair: ${decision.action}${decision.reason ? ` (${decision.reason})` : ""}`, exitCode }
}

/** With a session dir that holds outcome.json, the repair summary and residual list land in the manifest. */
function recordRepair(flags, state, decision) {
	const dir = flags["session-dir"] ?? process.env.SESSION_DIR
	if (!dir) return
	const file = join(resolve(dir), outcome.MANIFEST_FILENAME)
	if (!existsSync(file)) return
	const manifest = outcome.readManifest(file)
	manifest.repair = { attempts: state.attempts.length, action: decision.action, reason: decision.reason }
	if (decision.action !== "repair") manifest.residualDefects = decision.residual.map((defect) => ({ ...defect, message: defect.message ?? defect.code }))
	outcome.writeManifest(file, manifest)
}

function manifestPath(flags) {
	return join(sessionDirFrom(flags), outcome.MANIFEST_FILENAME)
}

export function runOutcome(argv) {
	const [sub, ...rest] = argv
	const args = parseArgs(rest, { booleans: ["json"] })
	const file = sub === "state" ? null : manifestPath(args.flags)
	switch (sub) {
		case "init": {
			const promised = args.required("promised").split(",").map((s) => s.trim()).filter(Boolean)
			const manifest = outcome.initManifest({ sessionDir: sessionDirFrom(args.flags), promised, lane: args.flags.lane ?? null, now: nowFrom(args.flags) })
			outcome.writeManifest(file, manifest)
			return { json: { command: "outcome init", path: file, deliverables: manifest.deliverables }, exitCode: 0 }
		}
		case "set": {
			const [format, status] = args.positionals
			if (!format || !status) throw new CliError("usage: outcome set <format> <status> [--path p] [--reason r] [--pages n]")
			const manifest = outcome.readManifest(file)
			const detail = {}
			if (args.flags.path !== undefined) {
				detail.path = resolve(args.flags.path)
				if (existsSync(detail.path)) detail.bytes = statSync(detail.path).size
			}
			if (args.flags.reason !== undefined) detail.reason = args.flags.reason
			if (args.flags.pages !== undefined) detail.pages = args.int("pages")
			outcome.writeManifest(file, outcome.setDeliverable(manifest, format, status, { ...detail, now: nowFrom(args.flags) }))
			return { json: { command: "outcome set", format, status }, exitCode: 0 }
		}
		case "gate": {
			const [gate, status] = args.positionals
			if (!gate || !status) throw new CliError("usage: outcome gate <static|layout|visual|proofread> <pass|fail|not_run>")
			outcome.writeManifest(file, outcome.setGate(outcome.readManifest(file), gate, status))
			return { json: { command: "outcome gate", gate, status }, exitCode: 0 }
		}
		case "render": {
			const [path] = args.positionals
			if (!path) throw new CliError("usage: outcome render <path> --page N")
			outcome.writeManifest(file, outcome.addRender(outcome.readManifest(file), resolve(path), args.int("page")))
			return { json: { command: "outcome render", path: resolve(path) }, exitCode: 0 }
		}
		case "state": {
			const deliverable = args.required("deliverable")
			const sibling = join(dirname(resolve(deliverable)), outcome.MANIFEST_FILENAME)
			const dir = args.flags["session-dir"] ?? process.env.SESSION_DIR
			const candidate = dir ? join(resolve(dir), outcome.MANIFEST_FILENAME) : sibling
			const manifest = existsSync(candidate) ? outcome.readManifest(candidate) : null
			const state = outcome.deliverableState(resolve(deliverable), manifest)
			return { json: { command: "outcome state", state }, summary: `state: ${state}`, exitCode: 0 }
		}
		case "verify": {
			const result = outcome.verifyManifest(outcome.readManifest(file))
			return { json: { command: "outcome verify", ...result }, summary: `verify: ${result.ok ? "OK" : `${result.problems.length} problem(s)`}`, exitCode: result.ok ? 0 : 1 }
		}
		case "finish": {
			const manifest = outcome.readManifest(file)
			const ledgerPath = args.flags.ledger ?? join(sessionDirFrom(args.flags), "sources-ledger.md")
			const now = nowFrom(args.flags)
			const facts = outcome.briefingFacts(manifest, existsSync(ledgerPath) ? readText(ledgerPath) : "", now)
			manifest.finishedAt = now.toISOString()
			manifest.elapsedMinutes = facts.minutes
			manifest.sources = { total: facts.sources, domains: facts.domains }
			outcome.writeManifest(file, manifest)
			return { json: { command: "outcome finish", finishedAt: manifest.finishedAt, elapsedMinutes: facts.minutes, sources: manifest.sources }, exitCode: 0 }
		}
		case "briefing": {
			const manifest = outcome.readManifest(file)
			const ledgerPath = args.flags.ledger ?? join(sessionDirFrom(args.flags), "sources-ledger.md")
			const ledger = existsSync(ledgerPath) ? readText(ledgerPath) : ""
			const now = nowFrom(args.flags)
			if (args.flags.json) return { json: { command: "outcome briefing", ...outcome.briefingFacts(manifest, ledger, now) }, exitCode: 0 }
			return { text: outcome.buildBriefing(manifest, ledger, now), exitCode: 0 }
		}
		default:
			throw new CliError("usage: outcome <init|set|gate|render|state|verify|finish|briefing> ...")
	}
}

export async function runFormatExtract(argv) {
	const args = parseArgs(argv, { booleans: ["from-url"] })
	const [reference] = args.positionals
	if (!reference) throw new CliError("usage: format-extract <reference> --out <design-spec.md> [--from-url]")
	const out = args.required("out")
	let extract
	try {
		extract = args.flags["from-url"] ? extractFromHtml(await fetchHtml(reference), { origin: reference }) : extractFromPath(reference)
	} catch (error) {
		// An unsupported, unreadable, or unreachable reference is an input problem (exit 2), not a gate result.
		throw new CliError(`format-extract ${reference}: ${error.message}`)
	}
	writeJsonAtomic(`${out}.extract.json`, { ...extract, tokens: { light: Object.fromEntries(extract.tokens?.light ?? []), dark: Object.fromEntries(extract.tokens?.dark ?? []) } })
	writeFileSync(out, renderDesignSpec(extract))
	return { json: { command: "format-extract", out: resolve(out), origin: extract.origin, lineageMode: extract.lineageMode, notes: extract.notes ?? [] }, summary: `format-extract: wrote ${out}`, exitCode: 0 }
}
