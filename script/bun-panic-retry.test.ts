import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const runner = fileURLToPath(new URL("./bun-panic-retry.ts", import.meta.url))

const PANIC_OUTPUT = [
  "panic(main thread): Segmentation fault at address 0x1",
  "oh no: Bun has crashed. This indicates a bug in Bun, not your code.",
  "✗ packages\\senpi-task\\src\\runners\\rpc-host\\liveness.test.ts (worker crashed: exit code 3)",
].join("\n")
const FAILING_TEST = "(fail) launch spec > #given a spec #when read #then it parses [1.20ms]"

// Each attempt of the fake `bun test` prints the output of one step and exits with its code; the
// attempt counter lives in a file so the test can see how many times the runner launched it.
const FAKE_BUN_TEST = `
import { existsSync, readFileSync, writeFileSync } from "node:fs"
const [counterFile, ...steps] = process.argv.slice(2)
const attempt = existsSync(counterFile) ? Number(readFileSync(counterFile, "utf8")) + 1 : 1
writeFileSync(counterFile, String(attempt))
const step = steps[attempt - 1] ?? "unexpected-attempt"
const lines = []
if (step.includes("panic")) lines.push(${JSON.stringify(PANIC_OUTPUT)})
if (step.includes("fail")) lines.push(${JSON.stringify(FAILING_TEST)})
const failures = (step.includes("panic") ? 1 : 0) + (step.includes("fail") ? 1 : 0)
lines.push(" 41 pass", \` \${failures} fail\`)
if (step === "unexpected-attempt") { console.error("launched more times than scripted"); process.exit(9) }
if (step.includes("panic")) console.error(lines.join("\\n")); else console.log(lines.join("\\n"))
process.exit(failures === 0 ? 0 : 1)
`

let root = ""
let fakeBunTest = ""
let counterFile = ""

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omo-bun-panic-retry-"))
  fakeBunTest = join(root, "fake-bun-test.ts")
  counterFile = join(root, "attempts")
  writeFileSync(fakeBunTest, FAKE_BUN_TEST)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function runInvocation(...steps: string[]): { exitCode: number; output: string; attempts: number } {
  const env = { ...process.env }
  delete env.GITHUB_ACTIONS
  const result = Bun.spawnSync([process.execPath, runner, fakeBunTest, counterFile, ...steps], {
    stdout: "pipe",
    stderr: "pipe",
    env,
  })
  return {
    exitCode: result.exitCode,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
    attempts: Number(readFileSync(counterFile, "utf8")),
  }
}

describe("bun-panic-retry", () => {
  test("#given a passing invocation #when it runs #then it runs once and passes", () => {
    const run = runInvocation("pass")

    expect(run.exitCode).toBe(0)
    expect(run.attempts).toBe(1)
    expect(run.output).not.toContain("retrying")
  })

  test("#given Bun crashes once #when the retry passes #then the invocation passes after exactly one retry naming the crash", () => {
    const run = runInvocation("panic", "pass")

    expect(run.exitCode).toBe(0)
    expect(run.attempts).toBe(2)
    expect(run.output).toContain("::warning title=Bun crashed (oven-sh/bun#44390)::attempt 1 crashed:")
    expect(run.output).toContain("panic(main thread): Segmentation fault at address 0x1")
    expect(run.output).toContain("retrying this invocation once")
  })

  test("#given Bun crashes on both attempts #when it runs #then it fails after the single retry", () => {
    const run = runInvocation("panic", "panic", "pass")

    expect(run.exitCode).toBe(1)
    expect(run.attempts).toBe(2)
    expect(run.output).toContain("::error title=Bun crashed again (oven-sh/bun#44390)::attempt 2 of 2 crashed:")
  })

  test("#given an assertion failure without a crash #when it runs #then it fails without a retry", () => {
    const run = runInvocation("fail", "pass")

    expect(run.exitCode).toBe(1)
    expect(run.attempts).toBe(1)
    expect(run.output).toContain("attempt 1 failed with test failures (exit 1); not retried")
  })

  test("#given a crash and an assertion failure in the same run #when it runs #then the failure is not retried", () => {
    const run = runInvocation("panic+fail", "pass")

    expect(run.exitCode).toBe(1)
    expect(run.attempts).toBe(1)
    expect(run.output).not.toContain("retrying")
  })

  test("#given a crash and then an assertion failure on the retry #when it runs #then it fails without a third attempt", () => {
    const run = runInvocation("panic", "fail", "pass")

    expect(run.exitCode).toBe(1)
    expect(run.attempts).toBe(2)
    expect(run.output).toContain("attempt 2 failed with test failures (exit 1); not retried")
  })
})
