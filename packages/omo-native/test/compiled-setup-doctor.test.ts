import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCompiledLauncher } from "../compile-entry"
import { compiledDiagnosticRuntimeLoader } from "../compiled-diagnostic-runtime"

const roots: string[] = []
const temp = () => { const root = mkdtempSync(join(tmpdir(), "omo-compiled-parity-")); roots.push(root); return root }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function runtimeRoot(version = "9.2.1"): string {
  const root = temp()
  writeFileSync(join(root, "package.json"), JSON.stringify({ version }))
  for (const artifact of ["plugin/package.json", "plugin/extensions/omo.js", "plugin/runtime/lsp-daemon/dist/cli.js"]) {
    mkdirSync(join(root, artifact, ".."), { recursive: true })
    writeFileSync(join(root, artifact), "fixture\n")
  }
  return root
}

async function captureLog(run: () => Promise<unknown>): Promise<string> {
  const output: string[] = []
  const originalLog = console.log
  const originalExitCode = process.exitCode
  console.log = (value?: unknown) => { output.push(String(value)) }
  try {
    await run()
  } finally {
    console.log = originalLog
    process.exitCode = originalExitCode
  }
  return output.join("\n")
}

describe("compiled omo setup", () => {
  test("#given omo setup --dry-run #when the compiled entry dispatches it #then the consent-gated import runs with binary-local coverage loaders", async () => {
    const root = runtimeRoot()
    const calls: { args: string[]; options: Record<string, unknown> }[] = []
    const handled = await runCompiledLauncher(["setup", "--dry-run"], root, "2026.8.28", root, {
      runSetup: async (args, options) => { calls.push({ args, options }) },
    })
    expect(handled).toBe(true)
    expect(calls.map((call) => call.args)).toEqual([["--dry-run"]])
    expect(typeof calls[0]?.options.loadCoverageRuntime).toBe("function")
    expect(typeof calls[0]?.options.loadCoverageEngine).toBe("function")
  })

})

describe("compiled omo doctor", () => {
  test("#given a release binary #when doctor runs #then it prints the update command and the computer-use and task-category sections", async () => {
    const root = runtimeRoot()
    const output = await captureLog(() => runCompiledLauncher(["doctor"], root, "2026.8.28", root, {
      computerUseLines: async () => ["INFO computer use: enabled=true supported=true host=fixture"],
      coverageLines: async () => ["WARN task categories: 0 of 10 usable with your connected providers"],
    }))
    const lines = output.split("\n")
    expect(lines).toContain("INFO omo 9.2.1 (engine: senpi 2026.8.28; scheme nodef)")
    expect(lines).toContain("INFO Update: omo update")
    expect(lines).toContain("INFO computer use: enabled=true supported=true host=fixture")
    expect(lines).toContain("WARN task categories: 0 of 10 usable with your connected providers")
  })

  test("#given a computer-use FAIL line #when doctor runs #then the exit code is 1", async () => {
    const root = runtimeRoot()
    let exitCode: number | undefined
    await captureLog(async () => {
      await runCompiledLauncher(["doctor"], root, "2026.8.28", root, {
        computerUseLines: async () => ["FAIL computer use engine: handshake-failed: fixture"],
        coverageLines: async () => [],
      })
      exitCode = Number(process.exitCode)
    })
    expect(exitCode).toBe(1)
  })
})

describe("compiled omo doctor --reap", () => {
  test("#given --reap <pid> #when the compiled doctor runs #then it reaps instead of printing the report", async () => {
    const root = runtimeRoot()
    const signalled: number[] = []
    const output = await captureLog(() => runCompiledLauncher(["doctor", "--reap", "4242"], root, "2026.8.28", root, {
      list: () => [{ pid: 4242, ppid: 1, elapsed: "01:00", tty: "ttys001", command: "/home/u/.omo/binary-runtime/9.2.1/omo" }],
      kill: (pid) => { signalled.push(pid) },
    }))
    expect(signalled).toEqual([4242])
    expect(output).toContain("PASS reaped stale engine pid 4242")
    expect(output).not.toContain("PASS plugin manifest")
  })
})

describe("compiled diagnostic runtime", () => {
  test("#given a provisioned runtime #when the loader runs #then it imports the staged category-coverage bundle from that runtime", async () => {
    const root = temp()
    const bundle = join(root, "plugin", "runtime", "category-coverage", "index.js")
    mkdirSync(join(bundle, ".."), { recursive: true })
    writeFileSync(bundle, "export const marker = 'provisioned-runtime'\n")
    const loaded = await compiledDiagnosticRuntimeLoader(root)() as { marker?: string }
    expect(loaded.marker).toBe("provisioned-runtime")
  })
})
