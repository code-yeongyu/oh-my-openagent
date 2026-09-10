import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const wrapper = readFileSync(join(repoRoot, ".github", "scripts", "windows-ci-telemetry.ps1"), "utf8")
const workflow = readFileSync(join(repoRoot, ".github", "workflows", "ci.yml"), "utf8")
const preload = readFileSync(join(repoRoot, "test-setup.ts"), "utf8")

describe("per-file test timeout budget", () => {
  test("#given a sequential multi-file run #when files rely on the preload default #then only the first file gets it (the Bun defect this contract guards)", () => {
    // Two files, each sleeping past Bun's 5000ms built-in but inside test-setup.ts's budget. Without
    // an explicit --timeout the second file must die at 5000ms; with it both must pass. This is the
    // whole reason ci.yml and the Windows wrapper pass the flag explicitly.
    const root = mkdtempSync(join(tmpdir(), "omo-timeout-budget-"))
    try {
      const dir = join(root, "probe")
      mkdirSync(dir)
      for (const name of ["a", "b"]) {
        writeFileSync(join(dir, `${name}.test.ts`), [
          'import { expect, test } from "bun:test"',
          `test("${name}: 5.5s with no explicit timeout", async () => {`,
          "  await new Promise((resolve) => setTimeout(resolve, 5500))",
          "  expect(true).toBe(true)",
          "})",
          "",
        ].join("\n"))
      }
      const run = (...extra: string[]) => spawnSync(process.execPath, ["test", ...extra, dir], { cwd: repoRoot, encoding: "utf8" })
      const explicit = run("--timeout", "20000")
      expect(`${explicit.stdout}${explicit.stderr}`).toMatch(/\b2 pass\b/)
      expect(`${explicit.stdout}${explicit.stderr}`).not.toMatch(/timed out after 5000ms/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, { timeout: 60_000 })

  test("#given the Windows wrapper #when it launches bun test #then it injects the 30000ms budget for every job", () => {
    expect(wrapper).toMatch(/\$WindowsTestTimeoutMs = "30000"/)
    expect(wrapper).toMatch(/if \(\$argument -eq "test"\) \{ \$withTimeout \+= @\("--timeout", \$WindowsTestTimeoutMs\) \}/)
    expect(wrapper).toMatch(/-not \(\$TestArguments -contains "--timeout"\)/)
  })

  test("#given ci.yml #when a POSIX job runs bun test over more than one file #then the invocation carries --timeout 20000", () => {
    const multiFileRuns = workflow
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^(run: )?bun (--config=\S+ )?test\b/.test(line))
      .filter((line) => !/--timeout/.test(line))
      .filter((line) => {
        const targets = line.replace(/^(run: )?bun (--config=\S+ )?test\b/, "").trim().split(/\s+/).filter(Boolean)
        const explicitFiles = targets.filter((target) => /\.test\.(ts|mjs)$/.test(target))
        // one explicit file is the first-and-only file, which the preload default does cover;
        // anything else (several files, a directory or package, or no target at all) runs more
        // than one file sequentially and needs the flag
        return !(explicitFiles.length === 1 && explicitFiles.length === targets.length)
      })
    expect(multiFileRuns).toEqual([])
  })

  test("#given test-setup.ts #when its budget is documented #then it states the first-file-only behaviour and the three numbers to keep in step", () => {
    expect(preload).toMatch(/setDefaultTimeout\(process\.platform === "win32" \? 30_000 : 20_000\)/)
    expect(preload).toMatch(/FIRST test file of a sequential run only/)
    expect(preload).toMatch(/Windows wrapper injects 30000/)
    expect(preload).toMatch(/carry 20000/)
  })
})
