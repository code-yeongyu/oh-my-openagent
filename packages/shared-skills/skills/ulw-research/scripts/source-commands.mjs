// source-commands.mjs - the `source snapshot` and `claims index` subcommands of report-tools.
// A source dir is immutable: the same id with identical text is a no-op, different text fails
// (exit 1, snapshot_exists), because ledger rows pin the old hash. `--url` fetches with plain
// fetch (30 s timeout, no browser) and records extractor tool:source-snapshot@1; `--html` and
// `--text` import a browser-lane capture and record extractor model (lower trust), or the named
// extractor for `--text --extractor NAME@VERSION`; `--command` runs an argv without a shell and
// snapshots its stdout, with the argv, cwd, exit status, and output hashes in command.json.
// node: builtins and sibling imports only.

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { indexClaims } from "./claims-index.mjs"
import { CliError, parseArgs, sha256Of, writeJsonAtomic } from "./cli-support.mjs"
import { parseFidelityBlock } from "./fidelity-brief.mjs"
import { parseSourceFloor } from "./fidelity-policy.mjs"
import { writeSnapshot } from "./source-snapshot.mjs"

const FETCH_TIMEOUT_MS = 30_000
const TOOL_EXTRACTOR = "tool:source-snapshot@1"
const SNAPSHOT_USAGE =
	"usage: source snapshot --id S<n> (--url <u> | --html <file> | --text <file> [--extractor NAME@VERSION] | --command '<argv json>' --cwd DIR) [--kind page|command|document] [--provenance primary|secondary] [--revision R] --session-dir D"

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

/** The snapshot of one source: meta.json, text.txt, and source.html when the source was a page. */
export function snapshotOf(sessionDir, id) {
	const dir = join(sessionDir, "sources", String(id))
	if (!existsSync(join(dir, "meta.json"))) throw new CliError(`source ${id} has no snapshot; run source snapshot --id ${id} first`)
	const html = join(dir, "source.html")
	return { meta: JSON.parse(readInput(join(dir, "meta.json"))), text: readInput(join(dir, "text.txt")), html: existsSync(html) ? readInput(html) : null }
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
		throw new CliError(`pdf response: ${url}; extract its text and use --text <file> --extractor NAME@VERSION`)
	}
	const body = await response.text()
	return /html|xml/i.test(type) || /^\s*</.test(body) ? { url, html: body } : { url, text: body }
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
	const proc = spawnSync(argv[0], argv.slice(1), { cwd: resolve(cwd), encoding: "utf8", shell: false, maxBuffer: 64 * 1024 * 1024 })
	if (proc.error) throw new CliError(`--command could not start: ${proc.error.message}`)
	const receipt = { argv, cwd: resolve(cwd), exit_status: proc.status, stdout_sha256: sha256Of(proc.stdout), stderr_sha256: sha256Of(proc.stderr) }
	return { path: `command:${argv.join(" ")}`, text: proc.stdout, kind: "command", receipt }
}

async function acquire(flags) {
	const given = ["url", "html", "text", "command"].filter((name) => flags[name] !== undefined)
	if (given.length !== 1) throw new CliError(SNAPSHOT_USAGE)
	if (flags.extractor !== undefined && flags.text === undefined) throw new CliError("--extractor goes with --text only")
	if (flags.url !== undefined) return { ...(await fetchSource(flags.url)), extractor: TOOL_EXTRACTOR }
	if (flags.html !== undefined) return { path: resolve(flags.html), html: readInput(flags.html), extractor: "model" }
	if (flags.text !== undefined) return { path: resolve(flags.text), text: readInput(flags.text), extractor: flags.extractor === undefined ? "model" : `extractor:${flags.extractor}` }
	return { ...runCommand(flags.command, flags.cwd), extractor: TOOL_EXTRACTOR }
}

export async function runSource(argv) {
	const [sub, ...rest] = argv
	if (sub !== "snapshot") throw new CliError(SNAPSHOT_USAGE)
	const args = parseArgs(rest)
	const id = args.required("id")
	const sourcesDir = join(sessionDirOf(args.flags), "sources")
	const { receipt, ...input } = await acquire(args.flags)
	if (args.flags.kind !== undefined) input.kind = args.flags.kind
	if (args.flags.provenance !== undefined) input.provenance = args.flags.provenance
	if (args.flags.revision !== undefined) input.revision = args.flags.revision
	let written
	try {
		written = writeSnapshot(sourcesDir, id, input)
	} catch (error) {
		if (String(error.message).startsWith("snapshot_exists")) {
			return { json: { command: "source snapshot", status: "fail", exitCode: 1, error: "snapshot_exists", message: error.message }, summary: `source snapshot: ${error.message}`, exitCode: 1 }
		}
		if (error instanceof TypeError) throw new CliError(error.message)
		throw error
	}
	if (receipt) writeFileSync(join(written.dir, "command.json"), `${JSON.stringify(receipt, null, 2)}\n`)
	const meta = JSON.parse(readFileSync(join(written.dir, "meta.json"), "utf8"))
	const data = { source_id: id, directory: written.dir, snapshot_sha256: written.sha256, extractor: meta.extractor, kind: meta.kind, provenance: meta.provenance }
	return { json: { command: "source snapshot", status: "pass", exitCode: 0, data }, summary: `source snapshot: ${id} ${written.sha256.slice(0, 12)} (${meta.extractor})`, exitCode: 0 }
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
