// cli-support.mjs - argument parsing, typed usage errors, exit-code mapping, and JSON file IO
// shared by every report-tools subcommand. node: builtins only.

import { readFileSync, renameSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"

/** A usage or input error: always exit code 2. */
export class CliError extends Error {
	constructor(message) {
		super(message)
		this.name = "CliError"
	}
}

const IO_CODES = new Set(["ENOENT", "EACCES", "EISDIR", "ENOTDIR", "EPERM"])

/** 0 pass, 1 semantic failure (result.exitCode), 2 usage or IO error. */
export function exitCodeFor(resultOrError) {
	if (resultOrError instanceof CliError) return 2
	if (resultOrError instanceof Error) return IO_CODES.has(resultOrError.code) ? 2 : 1
	return resultOrError?.exitCode === 1 ? 1 : 0
}

/**
 * Parse `--name value`, `--name=value`, boolean flags, and repeatable flags.
 * @param {readonly string[]} argv
 * @param {{ repeatable?: string[], booleans?: string[] }} spec
 */
export function parseArgs(argv, { repeatable = [], booleans = [] } = {}) {
	const repeat = new Set(repeatable)
	const bools = new Set(booleans)
	const positionals = []
	const flags = {}
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index]
		if (!arg.startsWith("--")) {
			positionals.push(arg)
			continue
		}
		const eq = arg.indexOf("=")
		const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq)
		let value
		if (bools.has(name) && eq === -1) value = true
		else if (eq !== -1) value = arg.slice(eq + 1)
		else {
			value = argv[index + 1]
			if (value === undefined || value.startsWith("--")) throw new CliError(`--${name} requires a value`)
			index += 1
		}
		if (repeat.has(name)) flags[name] = [...(flags[name] ?? []), value]
		else flags[name] = value
	}
	return {
		positionals,
		flags,
		/** @param {string} name @param {number} [fallback] */
		int(name, fallback) {
			if (flags[name] === undefined) {
				if (fallback === undefined) throw new CliError(`--${name} is required`)
				return fallback
			}
			const parsed = Number(flags[name])
			if (!Number.isInteger(parsed) || parsed <= 0) throw new CliError(`--${name} requires a positive integer`)
			return parsed
		},
		/** @param {string} name */
		required(name) {
			const value = flags[name]
			if (value === undefined || value === true) throw new CliError(`--${name} is required`)
			return value
		},
	}
}

/** Read and parse a JSON file; a missing or malformed file is a CliError naming the path. */
export function readJsonFile(path) {
	let text
	try {
		text = readFileSync(path, "utf8")
	} catch (error) {
		throw new CliError(`cannot read ${path}: ${error.code ?? error.message}`)
	}
	try {
		return JSON.parse(text)
	} catch (error) {
		throw new CliError(`${path} is not valid JSON: ${error.message}`)
	}
}

/** Write JSON through a sibling temp file + rename, so a crash never leaves a half-written file. */
export function writeJsonAtomic(path, value) {
	const temp = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`)
	writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`)
	renameSync(temp, path)
}

/** Print a result: JSON on stdout, one summary line on stderr. */
export function emit(result, { stdout = process.stdout, stderr = process.stderr } = {}) {
	if (typeof result.text === "string") stdout.write(result.text.endsWith("\n") ? result.text : `${result.text}\n`)
	else stdout.write(`${JSON.stringify(result.json ?? result, null, 2)}\n`)
	if (result.summary) stderr.write(`${result.summary}\n`)
}
