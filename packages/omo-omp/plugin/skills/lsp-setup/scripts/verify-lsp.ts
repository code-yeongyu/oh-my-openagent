#!/usr/bin/env bun
// verify-lsp.ts <file> [--timeout=ms] — perform a real LSP diagnostics roundtrip
// for <file> through the lsp-tools-mcp engine and report ok/fail with error text.
// The engine source is located by walking up from this script and the cwd, so
// run it inside the omo repo/worktree (where packages/lsp-tools-mcp/src exists).

import { existsSync, statSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

const ENGINE_TOOLS = "packages/lsp-tools-mcp/src/tools.ts"
const ENGINE_CONTEXT = "packages/lsp-tools-mcp/src/request-context.ts"
const ENGINE_MANAGER = "packages/lsp-tools-mcp/src/lsp/manager.ts"
const DEFAULT_TIMEOUT_MS = 60_000

interface ToolExecutionResult {
	readonly content: ReadonlyArray<{ readonly type: "text"; readonly text: string }>
	readonly isError?: boolean
	readonly details?: unknown
}

interface DiagnosticsDetails {
	readonly mode: "file" | "directory"
	readonly totalDiagnostics: number
	readonly error?: string
	readonly errorKind?: "missing_dependency" | "no_files" | "invalid_path"
}

interface ToolsModule {
	readonly executeLspDiagnostics: (params: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolExecutionResult>
}

interface ContextModule {
	readonly runWithRequestContext: <T>(context: { cwd?: string; env?: Record<string, string> }, fn: () => T) => T
}

interface ManagerModule {
	readonly disposeDefaultLspManager: () => Promise<void>
}

function findUp(relativeTarget: string): string | null {
	const starts = [dirname(fileURLToPath(import.meta.url)), process.cwd()]
	for (const start of starts) {
		let current = start
		while (true) {
			const candidate = join(current, relativeTarget)
			if (existsSync(candidate)) return candidate
			const parent = dirname(current)
			if (parent === current) break
			current = parent
		}
	}
	return null
}

function buildEnv(): Record<string, string> {
	const env: Record<string, string> = {}
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined) env[key] = value
	}
	return env
}

function isDiagnosticsDetails(value: unknown): value is DiagnosticsDetails {
	return typeof value === "object" && value !== null && "mode" in value && "totalDiagnostics" in value
}

async function loadModule<T>(relativeTarget: string): Promise<T> {
	const path = findUp(relativeTarget)
	if (path === null) {
		throw new EngineNotFoundError(relativeTarget)
	}
	return (await import(pathToFileURL(path).href)) as T
}

class EngineNotFoundError extends Error {
	constructor(public readonly target: string) {
		super(`lsp-tools-mcp engine not found (looked for ${target}). Run verify-lsp.ts inside the omo repo/worktree.`)
		this.name = "EngineNotFoundError"
	}
}

function parseTimeout(args: readonly string[]): number {
	const flag = args.find((arg) => arg.startsWith("--timeout="))
	if (flag === undefined) return DEFAULT_TIMEOUT_MS
	const parsed = Number.parseInt(flag.slice("--timeout=".length), 10)
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS
}

async function run(filePath: string, timeoutMs: number): Promise<number> {
	const tools = await loadModule<ToolsModule>(ENGINE_TOOLS)
	const context = await loadModule<ContextModule>(ENGINE_CONTEXT)
	const manager = await loadModule<ManagerModule>(ENGINE_MANAGER)
	const absolute = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath)

	try {
		const signal = AbortSignal.timeout(timeoutMs)
		const result = await context.runWithRequestContext({ cwd: process.cwd(), env: buildEnv() }, () =>
			tools.executeLspDiagnostics({ filePath: absolute, severity: "all" }, signal),
		)
		const details = isDiagnosticsDetails(result.details) ? result.details : null
		const text = result.content.map((part) => part.text).join("\n")

		if (details?.errorKind === "missing_dependency") {
			process.stdout.write(`FAIL ${absolute}: language server not installed\n${text}\n`)
			return 1
		}
		if (result.isError === true || details?.errorKind === "invalid_path" || details?.errorKind === "no_files") {
			process.stdout.write(`FAIL ${absolute}: ${details?.error ?? text}\n`)
			return 1
		}

		const count = details?.totalDiagnostics ?? 0
		process.stdout.write(`OK ${absolute}: LSP roundtrip succeeded (${count} diagnostic(s))\n${text}\n`)
		return 0
	} finally {
		await manager.disposeDefaultLspManager()
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2)
	const filePath = args.find((arg) => !arg.startsWith("--"))
	if (filePath === undefined) {
		process.stderr.write("Usage: bun verify-lsp.ts <file> [--timeout=ms]\n")
		process.exit(2)
	}
	if (!existsSync(filePath) || !statSync(filePath).isFile()) {
		process.stderr.write(`verify-lsp: not a file: ${filePath}\n`)
		process.exit(2)
	}

	try {
		const code = await run(filePath, parseTimeout(args))
		process.exit(code)
	} catch (error) {
		if (error instanceof EngineNotFoundError) {
			process.stderr.write(`SKIP: ${error.message}\n`)
			process.exit(3)
		}
		process.stderr.write(`FAIL ${filePath}: ${error instanceof Error ? error.message : String(error)}\n`)
		process.exit(1)
	}
}

await main()
