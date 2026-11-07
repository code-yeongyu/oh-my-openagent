import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { discoverFiles } from "./lib/files"
import { estimateTokens } from "./lib/render"
import { extractDefinitions, extractIdentifiers, languageFor } from "./lib/tags"

const cli = join(import.meta.dir, "repo-map.ts")
const work = mkdtempSync(join(tmpdir(), "repo-map-"))
const plain = join(work, "plain")
const gitRepo = join(work, "gitrepo")

interface JsonOutput {
	readonly files: number
	readonly budget: number
	readonly tokens: number
	readonly definitions: readonly { file: string; name: string; line: number; rank: number }[]
}

function write(root: string, relative: string, content: string): void {
	const path = join(root, relative)
	mkdirSync(join(path, ".."), { recursive: true })
	writeFileSync(path, content)
}

function run(args: readonly string[], cwd = plain): { exitCode: number; stdout: string; stderr: string } {
	const result = Bun.spawnSync(["bun", cli, ...args], { cwd, stdout: "pipe", stderr: "pipe" })
	return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() }
}

function fileRank(output: JsonOutput, file: string): number {
	return output.definitions.filter((definition) => definition.file === file).reduce((sum, definition) => sum + definition.rank, 0)
}

function json(args: readonly string[]): JsonOutput {
	const result = run([...args, "--json"])
	expect(result.stderr).toBe("")
	expect(result.exitCode).toBe(0)
	return JSON.parse(result.stdout) as JsonOutput
}

beforeAll(() => {
	write(plain, "src/core.ts", [
		"export interface PlanStep {",
		"\treadonly name: string",
		"}",
		"export const DEFAULT_LIMIT = 10",
		"export function buildPlan(steps: readonly PlanStep[]): PlanStep[] {",
		"\treturn steps.slice(0, DEFAULT_LIMIT)",
		"}",
		"",
	].join("\n"))
	write(plain, "src/util.ts", [
		"export function formatLine(step: { name: string }): string {",
		"\treturn _internalHelper(step.name)",
		"}",
		"export function _internalHelper(text: string): string {",
		"\treturn text.trim()",
		"}",
		"",
	].join("\n"))
	write(plain, "src/main.ts", [
		'import { buildPlan } from "./core"',
		'import { formatLine } from "./util"',
		"export function main(): void {",
		"\tconst plan = buildPlan([{ name: 'a' }])",
		"\tconsole.log(buildPlan(plan).map(formatLine).join('\\n'))",
		"\tconsole.log(formatLine({ name: 'b' }))",
		"}",
		"",
	].join("\n"))
	write(plain, "src/cli.ts", [
		'import { buildPlan } from "./core"',
		'import { formatLine } from "./util"',
		"export function runCli(): void {",
		"\tfor (const step of buildPlan([])) console.log(formatLine(step))",
		"\tconsole.log(buildPlan([]).length)",
		"}",
		"",
	].join("\n"))
	write(plain, "src/notes.txt", "buildPlan formatLine not code\n")
	write(plain, "node_modules/x/index.ts", "export function buildPlan() {}\n")
	write(plain, "py/runner.py", "class Runner:\n    def run_job(self, job):\n        return job\n")
	write(plain, "py/job.py", "from runner import Runner\n\nrunner = Runner()\nrunner.run_job(1)\nRunner.run_job(runner, 2)\n")
	mkdirSync(gitRepo)
	const git = (args: readonly string[]) => {
		const result = Bun.spawnSync(["git", ...args], { cwd: gitRepo, stdout: "pipe", stderr: "pipe" })
		if (result.exitCode !== 0) throw new Error(result.stderr.toString())
	}
	git(["init", "-q", "-b", "main"])
	write(gitRepo, ".gitignore", "ignored.ts\n")
	write(gitRepo, "kept.ts", "export function keptThing(): number { return 1 }\nkeptThing()\n")
	write(gitRepo, "ignored.ts", "export function ignoredThing(): number { return 2 }\n")
	write(gitRepo, "user.ts", "import { keptThing } from './kept'\nkeptThing(); keptThing()\n")
})

afterAll(() => {
	rmSync(work, { recursive: true, force: true })
})

describe("taggers", () => {
	test("#given TypeScript, Python and Rust sources #when definitions are extracted #then declarations are found and impl blocks are not", () => {
		const ts = extractDefinitions(["export interface PlanStep {", "export const DEFAULT_LIMIT = 10", "export async function buildPlan() {}", "class Foo {", "\tasync run() {", "}"].join("\n"), "typescript")
		expect(ts.map((definition) => definition.name)).toEqual(["PlanStep", "DEFAULT_LIMIT", "buildPlan", "Foo", "run"])
		expect(ts[2]?.line).toBe(3)
		const py = extractDefinitions("class Runner:\n    def run_job(self):\n        pass\n", "python")
		expect(py.map((definition) => definition.name)).toEqual(["Runner", "run_job"])
		const rs = extractDefinitions("pub struct Foo;\nimpl Display for Foo {}\npub(crate) fn make_foo() -> Foo { Foo }\n", "rust")
		expect(rs.map((definition) => definition.name)).toEqual(["Foo", "make_foo"])
	})

	test("#given identifiers inside strings and comments #when references are counted #then they are not counted", () => {
		const counts = extractIdentifiers('// buildPlan in a comment\nconst s = "buildPlan";\n/* buildPlan */\nbuildPlan(); buildPlan()\n', "typescript")
		expect(counts.get("buildPlan")).toBe(2)
		expect(counts.has("const")).toBe(false)
	})

	test("#given file extensions #when a language is looked up #then unknown extensions have none", () => {
		expect(languageFor("a/b.tsx")).toBe("typescript")
		expect(languageFor("a/b.py")).toBe("python")
		expect(languageFor("a/notes.txt")).toBeNull()
	})
})

describe("discovery", () => {
	test("#given a plain directory #when files are discovered #then node_modules and unknown extensions are skipped", () => {
		const files = discoverFiles(["."], plain).map((file) => file.replaceAll("\\", "/"))
		expect(files.some((file) => file.includes("node_modules"))).toBe(false)
		expect(files.some((file) => file.endsWith("notes.txt"))).toBe(false)
		expect(files.filter((file) => file.endsWith(".ts")).length).toBe(4)
	})

	test("#given a git repository with a .gitignore #when files are discovered #then the ignored file is excluded", () => {
		const files = discoverFiles(["."], gitRepo).map((file) => file.replaceAll("\\", "/"))
		expect(files.some((file) => file.endsWith("kept.ts"))).toBe(true)
		expect(files.some((file) => file.endsWith("ignored.ts"))).toBe(false)
	})
})

describe("ranking and rendering", () => {
	test("#given the fixture #when ranked #then the referenced core outranks util, both outrank main, and the underscore helper trails", () => {
		const output = json(["."])
		expect(output.files).toBe(6)
		expect(fileRank(output, "src/core.ts")).toBeGreaterThan(fileRank(output, "src/util.ts"))
		expect(fileRank(output, "src/util.ts")).toBeGreaterThan(fileRank(output, "src/main.ts"))
		const byName = Object.fromEntries(output.definitions.map((definition) => [definition.name, definition.rank]))
		expect(byName.formatLine ?? 0).toBeGreaterThan(byName._internalHelper ?? 0)
		expect(byName.Runner ?? 0).toBeGreaterThan(0)
	})

	test("#given --mention formatLine #when ranked #then util outranks core", () => {
		const output = json([".", "--mention", "formatLine"])
		expect(fileRank(output, "src/util.ts")).toBeGreaterThan(fileRank(output, "src/core.ts"))
	})

	test("#given --focus src/main.ts #when rendered #then main.ts leads the map", () => {
		const result = run([".", "--focus", "src/main.ts"])
		expect(result.exitCode).toBe(0)
		expect(result.stdout.trimStart().startsWith("src/main.ts:")).toBe(true)
	})

	test("#given budgets #when rendered #then the token estimate stays within budget and a tiny budget still prints one definition", () => {
		for (const budget of [200, 4096]) {
			const output = json([".", "--budget", String(budget)])
			expect(output.tokens).toBeLessThanOrEqual(budget)
			expect(estimateTokens(run([".", "--budget", String(budget)]).stdout)).toBeLessThanOrEqual(budget)
		}
		const tiny = json([".", "--budget", "8"])
		expect(tiny.definitions.length).toBe(1)
	})

	test("#given the text map #when printed #then each file heads its block and lines carry numbers", () => {
		const result = run(["."])
		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain("src/core.ts:")
		expect(result.stdout).toMatch(/\n\s+5: export function buildPlan/)
	})

	test("#given no mappable files #when run #then exit 1 with a message", () => {
		const empty = join(work, "empty")
		mkdirSync(empty, { recursive: true })
		const result = run(["."], empty)
		expect(result.exitCode).toBe(1)
		expect(result.stderr.length).toBeGreaterThan(0)
	})
})
