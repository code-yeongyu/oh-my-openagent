import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

// Regression for lazycodex#111: the script must resolve `typescript` from the
// caller project (cwd), not from the script's own location, so it works when
// executed from an installed `~/.codex/...` skill cache.

const scriptSource = join(import.meta.dir, "check-no-excuse-rules.ts")
const repoRequire = createRequire(import.meta.url)
const typescriptPackageDir = dirname(repoRequire.resolve("typescript/package.json"))

let tempRoot = ""
let cachedScript = ""
let callerDir = ""
let callerWithoutTypescriptDir = ""

function runNoExcuse(cwd: string, target: string) {
	return spawnSync(process.execPath, ["--no-install", cachedScript, target], {
		cwd,
		encoding: "utf8",
		timeout: 60_000,
	})
}

describe("#given the no-excuse script is executed from an installed ~/.codex-style skill cache", () => {
	beforeAll(() => {
		// given a cache copy of the script outside any project, and two caller projects:
		// one providing node_modules/typescript, one without typescript at all
		tempRoot = mkdtempSync(join(tmpdir(), "no-excuse-cache-repro-"))
		const cacheDir = join(tempRoot, ".codex", "skills", "programming", "scripts", "typescript")
		mkdirSync(cacheDir, { recursive: true })
		cachedScript = join(cacheDir, "check-no-excuse-rules.ts")
		copyFileSync(scriptSource, cachedScript)

		callerDir = join(tempRoot, "caller-project")
		mkdirSync(join(callerDir, "node_modules"), { recursive: true })
		symlinkSync(typescriptPackageDir, join(callerDir, "node_modules", "typescript"), "junction")
		writeFileSync(join(callerDir, "clean.ts"), "export const answer: number = 42\n")
		writeFileSync(join(callerDir, "violating.ts"), "const x = foo as any\nexport default x\n")

		callerWithoutTypescriptDir = join(tempRoot, "caller-without-typescript")
		mkdirSync(callerWithoutTypescriptDir, { recursive: true })
		writeFileSync(join(callerWithoutTypescriptDir, "clean.ts"), "export const answer: number = 42\n")
	})

	afterAll(() => {
		rmSync(tempRoot, { recursive: true, force: true })
	})

	// A generous timeout: the first run does a cold TypeScript program load in a
	// spawned subprocess, which can exceed bun test's 5s default on a cold cache
	// (matches the 60s spawnSync ceiling). This bounds the subprocess, it does not
	// wait on wall-clock time as behavior.
	test("#when the caller project provides typescript #then it resolves the caller's typescript and exits 0", () => {
		// when no-excuse runs from the cache copy against the caller project
		const result = runNoExcuse(callerDir, "clean.ts")

		// then the caller's own typescript is used and the clean file passes
		expect(result.error).toBeUndefined()
		expect(result.status).toBe(0)
		expect(result.stdout).toContain("No violations in 1 file(s).")
	}, 60_000)

	test("#when a checked file violates the rules #then violations are still reported with exit 1", () => {
		// when no-excuse runs against a file containing `as any`
		const result = runNoExcuse(callerDir, "violating.ts")

		// then the existing CLI behavior is unchanged
		expect(result.error).toBeUndefined()
		expect(result.status).toBe(1)
		expect(result.stderr).toContain("[no-any-assertion]")
	}, 60_000)

	test("#when the caller project genuinely lacks typescript #then it fails with a clear error and exit 2", () => {
		// when no-excuse runs from a caller project with no local typescript
		const result = runNoExcuse(callerWithoutTypescriptDir, "clean.ts")

		// then it reports the resolution problem instead of crashing mid-analysis
		expect(result.error).toBeUndefined()
		expect(result.status).toBe(2)
		expect(result.stderr).toContain('cannot resolve "typescript" from the caller project')
	}, 60_000)
})
