import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { type ChildProcess, spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PlantedProcesses, processAlive as alive, runTeardown, stopChildRun, TEARDOWN_HOOK_TIMEOUT_MS } from "./test-support/planted-processes"

const PRELOAD = join(import.meta.dir, "test-support", "hermetic-home.preload.ts")

function readPlanted(pidsFile: string): number[] {
  if (!existsSync(pidsFile)) return []
  return readFileSync(pidsFile, "utf8").split("\n").filter((line) => line !== "").map(Number)
}

// The planted processes name the child run's hermetic home on their command line, exactly as a task host's
// socket argument would, but no task host registration in that home's agent dir names them: they stand for
// a process of another run, or a test's own child, that the teardown must never signal (#11630).
// The planted processes are started with the runtime itself (no shell, so the same fixture runs on Windows),
// detached so they outlive the child run. Neither is a registered task host, so on every platform the teardown
// must leave them alone; on Windows the teardown is report-only even for a registered host (test-hermetic-home.ts,
// stopRunTaskHosts), and the reporting path is covered by the stopRunTaskHosts tests in test-hermetic-home.test.ts.
const PLANTING_TEST = `import { test } from "bun:test"
import { spawn } from "node:child_process"
import { appendFileSync } from "node:fs"

// Each planted process holds a connection to the parent test, which sees it exit as that connection's close event.
const ANNOUNCE = 'const s = require("node:net").connect(Number(process.env.PLANTED_PORT), "127.0.0.1", () => s.write(process.pid + "\\\\n")); s.on("error", () => {});'

function plant(script: string, name: string): number {
  // Their cwd is outside every directory the test removes: on Windows a live process's cwd cannot be deleted.
  const child = spawn(process.execPath, ["-e", script, \`\${process.env.HOME}/\${name}\`], {
    cwd: process.env.PLANTED_CWD,
    detached: true,
    stdio: "ignore",
  })
  child.unref()
  if (child.pid === undefined) throw new Error("planted process did not start")
  // Recorded at once, so the parent can stop it even when a later step of this run fails.
  appendFileSync(process.env.PLANTED_PIDS_FILE as string, \`\${child.pid}\\n\`)
  return child.pid
}

test("plants processes that name this run's hermetic home", () => {
  plant(\`\${ANNOUNCE} setInterval(() => {}, 1000)\`, "foreign-process")
  plant(\`\${ANNOUNCE} process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)\`, "term-ignoring-process")
})
`

describe("hermetic-home teardown signals only the task hosts this run started (#11630)", () => {
  let dir = ""
  let planted: number[] = []
  let registry: PlantedProcesses | undefined
  let childRun: ChildProcess | undefined
  let run: { readonly code: number | null; readonly output: string; readonly elapsedMs: number } | undefined

  beforeAll(async () => {
    registry = await PlantedProcesses.listen()
    dir = mkdtempSync(join(tmpdir(), "omo-hermetic-teardown-"))
    const cwd = join(dir, "run")
    mkdirSync(cwd)
    writeFileSync(join(cwd, "planting.test.ts"), PLANTING_TEST)
    const pidsFile = join(dir, "planted.pids")
    const started = Date.now()
    // A 5 s hook budget is Bun's default for every file after the first: a teardown that waits out a
    // process it signalled, or scans the whole process table under load, overruns it as an unnamed hook failure.
    const child = spawn(process.execPath, ["test", "--timeout", "5000", "--preload", PRELOAD, "./planting.test.ts"], {
      cwd,
      env: { ...process.env, PLANTED_PIDS_FILE: pidsFile, PLANTED_CWD: import.meta.dir, PLANTED_PORT: String(registry.port) },
      stdio: ["ignore", "pipe", "pipe"],
    })
    childRun = child
    let output = ""
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString() })
    const code = await new Promise<number | null>((resolve) => child.once("close", resolve))
    run = { code, output, elapsedMs: Date.now() - started }
    planted = readPlanted(pidsFile)
    // The planted processes connect after they start; wait for both before the assertions read their state.
    await registry.announced(planted)
  }, 60_000)

  afterAll(async () => {
    // Read here, not in beforeAll: if the child run failed after planting, beforeAll never got this far.
    const pids = dir === "" ? [] : readPlanted(join(dir, "planted.pids"))
    try {
      await runTeardown({
        // A child run that outlived beforeAll's budget still holds dir/run as its cwd: it is stopped first.
        stopChildRun: (waitMs) => stopChildRun(childRun, waitMs),
        stop: async (waitMs) => { await registry?.stop(pids, { waitMs }) },
        close: async (waitMs) => { await registry?.close(waitMs) },
      })
    } finally {
      if (dir !== "") rmSync(dir, { recursive: true, force: true })
    }
  }, TEARDOWN_HOOK_TIMEOUT_MS)

  test("#given a process that names the run's home but is no task host of the run #when the run ends #then it is not signalled", () => {
    expect(planted).toHaveLength(2)
    expect(planted.map(alive)).toEqual([true, true])
  })

  test("#given a process that ignores SIGTERM #when the run ends #then the teardown is not held past the hook budget", () => {
    expect(run?.output ?? "").not.toContain("hook timed out")
    expect({ code: run?.code, output: run?.output }).toEqual({ code: 0, output: run?.output })
  })
})
