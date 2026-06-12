#!/usr/bin/env bun
// detect-lsp.ts <targetDir> [--json] — scan a directory for source languages and
// report, per detected language: the builtin LSP server, whether its executable
// is on PATH, an install hint, and whether a project LSP config references it.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { delimiter, extname, join, sep } from "node:path"
import process from "node:process"

import { LANGUAGES, type LanguageServer, PROJECT_CONFIG_FILES } from "./lsp-server-table"

const SKIP_DIRECTORIES = new Set<string>([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	"out",
	"target",
	".venv",
	"venv",
	"vendor",
	".cache",
	"__pycache__",
	".turbo",
	"coverage",
])

const MAX_FILES = 50_000

// Mirrors effectiveExtension() in packages/lsp-tools-mcp/src/lsp/effective-extension.ts:
// extensionless Dockerfile/Containerfile resolve to .dockerfile (exact-case basenames).
const BASENAME_EXTENSIONS: Record<string, string> = {
	Dockerfile: ".dockerfile",
	Containerfile: ".dockerfile",
}

interface ConfigFileState {
	readonly path: string
	readonly exists: boolean
	readonly serverIds: readonly string[]
}

interface DetectionResult {
	readonly server: LanguageServer
	readonly executable: string
	readonly installed: boolean
	readonly resolvedPath: string | null
	readonly configuredIn: readonly string[]
}

function collectExtensions(root: string): ReadonlySet<string> {
	const found = new Set<string>()
	const stack: string[] = [root]
	let visited = 0

	while (stack.length > 0) {
		const current = stack.pop()
		if (current === undefined) break

		let entries: string[]
		try {
			entries = readdirSync(current)
		} catch {
			continue
		}

		for (const entry of entries) {
			if (visited >= MAX_FILES) return found
			const fullPath = join(current, entry)

			let kind: "dir" | "file" | "other" = "other"
			try {
				const stat = statSync(fullPath)
				kind = stat.isDirectory() ? "dir" : stat.isFile() ? "file" : "other"
			} catch {
				continue
			}

			if (kind === "dir") {
				if (!SKIP_DIRECTORIES.has(entry)) stack.push(fullPath)
			} else if (kind === "file") {
				visited += 1
				const ext = (BASENAME_EXTENSIONS[entry] ?? extname(entry)).toLowerCase()
				if (ext.length > 0) found.add(ext)
			}
		}
	}

	return found
}

function pathDirectories(): readonly string[] {
	return (process.env["PATH"] ?? "").split(delimiter).filter((dir: string) => dir.length > 0)
}

function resolveExecutable(command: string): string | null {
	const extensions =
		process.platform === "win32" ? (process.env["PATHEXT"]?.split(";") ?? [".EXE", ".CMD", ".BAT"]) : [""]
	const bases = command.includes("/") || command.includes(sep) ? [command] : pathDirectories().map((dir: string) => join(dir, command))

	for (const base of bases) {
		for (const ext of extensions) {
			const candidate = ext.length > 0 ? `${base}${ext}` : base
			try {
				if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
			} catch {
				continue
			}
		}
	}
	return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseConfiguredServerIds(path: string): readonly string[] {
	let parsed: unknown
	try {
		parsed = JSON.parse(readFileSync(path, "utf-8"))
	} catch {
		return []
	}
	if (!isRecord(parsed)) return []
	const lsp = parsed["lsp"]
	return isRecord(lsp) ? Object.keys(lsp) : []
}

function readConfigState(root: string): readonly ConfigFileState[] {
	return PROJECT_CONFIG_FILES.map((relative: string): ConfigFileState => {
		const path = join(root, relative)
		if (!existsSync(path)) return { path: relative, exists: false, serverIds: [] }
		return { path: relative, exists: true, serverIds: parseConfiguredServerIds(path) }
	})
}

function detect(root: string, configState: readonly ConfigFileState[]): readonly DetectionResult[] {
	const extensions = collectExtensions(root)
	const results: DetectionResult[] = []

	for (const server of LANGUAGES) {
		if (!server.extensions.some((ext: string) => extensions.has(ext))) continue

		const executable = server.command[0] ?? server.serverId
		const resolvedPath = resolveExecutable(executable)
		const configuredIn = configState
			.filter((state) => state.serverIds.includes(server.serverId))
			.map((state) => state.path)

		results.push({ server, executable, installed: resolvedPath !== null, resolvedPath, configuredIn })
	}

	return results
}

function renderReport(root: string, results: readonly DetectionResult[], configState: readonly ConfigFileState[]): string {
	const lines: string[] = [`LSP setup scan: ${root}`]
	const configSummary = configState
		.map((state) => `${state.path} (${state.exists ? `present: ${state.serverIds.length} server(s)` : "absent"})`)
		.join(", ")
	lines.push(`Config files: ${configSummary}`, "")

	if (results.length === 0) {
		lines.push("No languages with a builtin LSP server were detected here.")
		return lines.join("\n")
	}

	lines.push("DETECTED LANGUAGES (primary builtin server per language)")
	for (const result of results) {
		const mark = result.installed ? "OK  " : "MISS"
		const state = result.installed ? `installed (${result.resolvedPath})` : "NOT installed"
		const config = result.configuredIn.length > 0 ? `configured in ${result.configuredIn.join(", ")}` : "builtin-default"
		lines.push(`[${mark}] ${result.server.language.padEnd(12)} server=${result.server.serverId}  exe=${result.executable}  ${state}  ${config}`)
		if (!result.installed) lines.push(`        install: ${result.server.installHint}`)
	}

	const missing = results.filter((result) => !result.installed)
	lines.push(
		"",
		missing.length === 0
			? `All ${results.length} detected server(s) installed.`
			: `${missing.length}/${results.length} server(s) NOT installed: ${missing.map((m) => m.server.language).join(", ")}`,
		"Next: read references/<language>/README.md, then configure .codex/lsp-client.json AND .opencode/lsp.json.",
	)
	return lines.join("\n")
}

function main(): void {
	const args = process.argv.slice(2)
	const wantsJson = args.includes("--json")
	const root = args.find((arg: string) => !arg.startsWith("--")) ?? process.cwd()

	if (!existsSync(root)) {
		process.stderr.write(`detect-lsp: target directory does not exist: ${root}\n`)
		process.exit(2)
	}

	const configState = readConfigState(root)
	const results = detect(root, configState)

	if (wantsJson) {
		process.stdout.write(`${JSON.stringify({ root, configState, results }, null, 2)}\n`)
		return
	}
	process.stdout.write(`${renderReport(root, results, configState)}\n`)
}

main()
