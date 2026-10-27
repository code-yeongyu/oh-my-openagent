// source-commands.mjs - the `source snapshot`, `source refresh` and `claims index` subcommands of
// report-tools. A source dir is immutable: the same id with identical bytes is a no-op, different
// bytes fail (exit 1, snapshot_exists), because ledger rows pin the old hash; `source refresh`
// (source-refresh.mjs) is the one explicit repin. `--replace` swaps in a corrected capture under the
// same id (the conversion_altered_number recovery) only while no active ledger row cites the id
// (exit 1, snapshot_pinned, listing them). `--url` fetches with plain fetch (30 s timeout,
// no browser) and records extractor tool:source-snapshot@1; `--html` imports a browser-lane page
// capture and `--raw` alone a saved file's bytes (extractor model). `--text` alone registers a converted-only source (no raw bytes:
// quotes only); `--raw <bytes> --text <extraction> --extractor NAME@VERSION` keeps the original
// bytes and declares the text their extraction. `--command` runs an argv without a shell and
// snapshots its stdout, with the argv, cwd, exit status, and output hashes in command.json.
// node: builtins and sibling imports only.

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { indexClaims } from "./claims-index.mjs"
import { CliError, parseArgs, sha256Of, writeJsonAtomic } from "./cli-support.mjs"
import { runConversionProbe } from "./conversion-probe.mjs"
import { readLedger } from "./fact-ledger.mjs"
import { parseFidelityBlock } from "./fidelity-brief.mjs"
import { parseSourceFloor } from "./fidelity-policy.mjs"
import { encodingOf, headerCharset } from "./raw-decode.mjs"
import { writeSnapshot } from "./source-snapshot.mjs"
import { readSnapshot } from "./source-view.mjs"

const FETCH_TIMEOUT_MS = 30_000
const TOOL_EXTRACTOR = "tool:source-snapshot@1"
export const SNAPSHOT_USAGE =
	"usage: source probe-conversion <raw-file> <converted-file> | source snapshot --id S<n> (--url <u> | --html <file> | --raw <file> [--text <file> --extractor NAME@VERSION] | --text <file> (converted-only) | --command '<argv json>' --cwd DIR) [--charset NAME] [--kind page|command|document|converted-only] [--provenance primary|secondary] [--revision R] [--replace] --session-dir D"

function readInput(path) {
	try {
		return readFileSync(path, "utf8")
	} catch (error) {
		throw new CliError(`cannot read ${path}: ${error.code ?? error.message}`)
	}
}

/** The session dir from --session-dir or SESSION_DIR; a usage error when neither is set. */
export function sessionDirOf(flags) {
	const dir = flags["session-dir"] ?? process.env.SESSION_DIR
	if (!dir || dir === true) throw new CliError("--session-dir is required (or set SESSION_DIR)")
	return resolve(dir)
}

/** The snapshot as source-view.mjs reads it ({ meta, raw, sha256, drift, view }); unreadable is a usage error. */
export function snapshotOf(sessionDir, id) {
	const dir = join(sessionDir, "sources", String(id))
	if (!existsSync(join(dir, "meta.json"))) throw new CliError(`source ${id} has no snapshot; run source snapshot --id ${id} first`)
	try {
		return readSnapshot(dir)
	} catch (error) {
		throw new CliError(`source ${id}: ${error.message}`)
	}
}

/**
 * Whether the brief's source floor lists this source as pointed at (`pointed only: a, b`). An absent
 * or pending floor points at nothing; a malformed floor is a usage error (parseSourceFloor's CliError).
 */
export function pointedFlag(sessionDir, url) {
	const brief = join(sessionDir, "brief.md")
	const floor = existsSync(brief) ? (parseFidelityBlock(readInput(brief)).fields?.["source floor"] ?? "") : ""
	if (floor === "" || floor === "pending") return false
	const rule = parseSourceFloor(floor)
	return rule?.kind === "pointed" && rule.list.includes(url)
}

async function fetchSource(url) {
	if (!URL.canParse(url)) throw new CliError(`--url is not a URL: ${url}`)
	let response
	try {
		response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
	} catch (error) {
		throw new CliError(`fetch failed for ${url}: ${error.message}`)
	}
	if (!response.ok) {
		await response.body?.cancel()
		throw new CliError(`fetch failed: HTTP ${response.status} for ${url}`)
	}
	const type = response.headers.get("content-type") ?? ""
	if (/pdf/i.test(type)) {
		await response.body?.cancel()
		throw new CliError(`pdf response: ${url}; save the bytes and use --raw <file.pdf> --text <extracted.txt> --extractor NAME@VERSION`)
	}
	const raw = Buffer.from(await response.arrayBuffer())
	return { url, raw, charset: headerCharset(type), markup: /html|xml/i.test(type) || /^\s*</.test(raw.subarray(0, 1024).toString("latin1")) }
}

function runCommand(argvJson, cwd) {
	let argv
	try {
		argv = JSON.parse(argvJson)
	} catch (error) {
		throw new CliError(`--command must be a JSON array of strings: ${error.message}`)
	}
	if (!Array.isArray(argv) || argv.length === 0 || !argv.every((part) => typeof part === "string" && part.length > 0)) {
		throw new CliError("--command must be a non-empty JSON array of non-empty strings")
	}
	if (!cwd || cwd === true) throw new CliError("--command needs --cwd DIR")
	const proc = spawnSync(argv[0], argv.slice(1), { cwd: resolve(cwd), shell: false, maxBuffer: 64 * 1024 * 1024 })
	if (proc.error) throw new CliError(`--command could not start: ${proc.error.message}`)
	const receipt = { argv, cwd: resolve(cwd), exit_status: proc.status, stdout_sha256: sha256Of(proc.stdout), stderr_sha256: sha256Of(proc.stderr) }
	return { path: `command:${argv.join(" ")}`, raw: proc.stdout, kind: "command", receipt }
}

function readBytes(path) {
	try {
		return readFileSync(path)
	} catch (error) {
		throw new CliError(`cannot read ${path}: ${error.code ?? error.message}`)
	}
}

/** The snapshot input the flags describe; shared by `source snapshot` and `source refresh`. */
export async function acquire(flags) {
	const given = ["url", "html", "text", "command"].filter((name) => flags[name] !== undefined)
	if (flags.raw !== undefined && given.some((name) => name !== "text")) throw new CliError("--raw goes alone or with --text (--url, --html and --command already keep the raw bytes)")
	if (given.length + (flags.raw !== undefined && flags.text === undefined ? 1 : 0) !== 1) throw new CliError(SNAPSHOT_USAGE)
	if (flags.extractor !== undefined && flags.text === undefined) throw new CliError("--extractor goes with --text only")
	if (flags.charset !== undefined && encodingOf(flags.charset) === null) throw new CliError(`--charset ${flags.charset} is not a known encoding`)
	const charset = flags.charset === undefined ? {} : { charset: encodingOf(flags.charset) }
	if (flags.url !== undefined) return { ...(await fetchSource(flags.url)), ...charset, extractor: TOOL_EXTRACTOR }
	if (flags.html !== undefined) return { path: resolve(flags.html), raw: readBytes(flags.html), markup: true, ...charset, extractor: "model" }
	if (flags.raw !== undefined && flags.text === undefined) return { path: resolve(flags.raw), raw: readBytes(flags.raw), ...charset, extractor: "model" }
	if (flags.text !== undefined) {
		const extractor = flags.extractor === undefined ? "model" : `extractor:${flags.extractor}`
		if (flags.raw !== undefined) return { path: resolve(flags.raw), raw: readBytes(flags.raw), text: readInput(flags.text), ...charset, extractor }
		if (flags.kind !== undefined && flags.kind !== "converted-only") throw new CliError("--text without --raw registers a converted-only source; pass --raw <original bytes> to keep a measurable snapshot")
		return { path: resolve(flags.text), text: readInput(flags.text), kind: "converted-only", extractor }
	}
	return { ...runCommand(flags.command, flags.cwd), extractor: TOOL_EXTRACTOR }
}

/**
 * `--replace` with `--text` alone (the conversion_altered_number recovery) keeps the source's raw.bin and
 * declares the verified text its extraction, so value rows locate in text.txt while the original bytes stay
 * pinned; plain `--text` without `--replace`, or over an id with no raw.bin, stays converted-only.
 */
function declareOverKeptRaw(sourcesDir, id, input) {
	const dir = join(sourcesDir, String(id))
	if (input.kind !== "converted-only" || !existsSync(join(dir, "raw.bin")) || !existsSync(join(dir, "meta.json"))) return
	const before = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"))
	Object.assign(input, { url: before.url, raw: readFileSync(join(dir, "raw.bin")), kind: before.kind, declared: true })
	delete input.path
}

export async function runSource(argv) {
	const [sub, ...rest] = argv
	if (sub === "refresh") return (await import("./source-refresh.mjs")).runRefresh(rest)
	if (sub === "probe-conversion") return runConversionProbe(rest)
	if (sub !== "snapshot") throw new CliError(SNAPSHOT_USAGE)
	const args = parseArgs(rest, { booleans: ["replace"] })
	const id = args.required("id")
	const sessionDir = sessionDirOf(args.flags)
	const sourcesDir = join(sessionDir, "sources")
	const replace = args.flags.replace === true
	const pinned = replace ? readLedger(sessionDir).rows.filter((row) => row.source_id === id && (row.status ?? "active") === "active").map((row) => row.fact_id) : []
	if (pinned.length > 0) {
		const message = `${id} is cited by active row(s) ${pinned.join(", ")}; retract them first, or snapshot the corrected text under a new id`
		return { json: { command: "source snapshot", status: "fail", exitCode: 1, error: "snapshot_pinned", message, rows: pinned }, summary: `source snapshot: ${message}`, exitCode: 1 }
	}
	const { receipt, ...input } = await acquire(args.flags)
	if (replace) declareOverKeptRaw(sourcesDir, id, input)
	if (args.flags.kind !== undefined) input.kind = args.flags.kind
	if (args.flags.provenance !== undefined) input.provenance = args.flags.provenance
	if (args.flags.revision !== undefined) input.revision = args.flags.revision
	let written
	try {
		written = writeSnapshot(sourcesDir, id, input, { replace })
	} catch (error) {
		if (String(error.message).startsWith("snapshot_exists")) {
			return { json: { command: "source snapshot", status: "fail", exitCode: 1, error: "snapshot_exists", message: error.message }, summary: `source snapshot: ${error.message}`, exitCode: 1 }
		}
		if (error instanceof TypeError) throw new CliError(error.message)
		throw error
	}
	if (receipt) writeFileSync(join(written.dir, "command.json"), `${JSON.stringify(receipt, null, 2)}\n`)
	const meta = JSON.parse(readFileSync(join(written.dir, "meta.json"), "utf8"))
	const data = { source_id: id, directory: written.dir, snapshot_sha256: written.sha256, extractor: meta.extractor, kind: meta.kind, provenance: meta.provenance, text_source: meta.text_source, ...(written.altered ? { conversion_altered_numbers: written.altered } : {}) }
	const probe = written.altered ? `; conversion ${written.altered.length} altered${written.altered.length ? ` (${written.altered.join(", ")}): fact add refuses those numbers` : ""}` : ""
	return { json: { command: "source snapshot", status: "pass", exitCode: 0, data }, summary: `source snapshot: ${id} ${written.sha256.slice(0, 12)} (${meta.extractor}, ${meta.text_source})${probe}`, exitCode: 0 }
}

export function runClaims(argv) {
	const [sub, ...rest] = argv
	const args = parseArgs(rest)
	const [graph] = args.positionals
	if (sub !== "index" || !graph) throw new CliError("usage: claims index <claim-graph.md> --out claims.json")
	const out = args.required("out")
	const index = indexClaims(readInput(graph))
	if (index.errors.length > 0) throw new CliError(`claims index ${graph}: ${index.errors.join("; ")}`)
	writeJsonAtomic(out, { schemaVersion: 1, graph: resolve(graph), graph_sha256: sha256Of(readFileSync(graph)), ...index })
	const verified = index.claims.filter((claim) => claim.in_verified).length
	return { json: { command: "claims index", out: resolve(out), claims: index.claims.length, verified }, summary: `claims index: ${index.claims.length} claim(s), ${verified} verified`, exitCode: 0 }
}
