/// <reference types="bun-types" />

import { type ChildProcess, spawn } from "node:child_process"
import { once } from "node:events"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "bun:test"

// Every task child on Windows runs as its own `senpi --mode rpc` process, so this is where a child's own
// fallback chain (#9582) has to survive a usage limit after a tool call - including one that lands near
// the compaction threshold - without touching the user's settings file.
const isWin32 = process.platform === "win32"
const driverPath = fileURLToPath(new URL("./task-runtime-fallback-e2e.mjs", import.meta.url))
const SCENARIOS = ["user-fallback", "limit-after-tool", "limit-near-compaction"]
// Three scenarios, each a parent turn plus a child (a few seconds warm, up to 240 s each on a cold runner).
const DRIVER_TIMEOUT_MS = 900_000

type ScenarioVerdict = {
  readonly runner: string
  readonly scenario: string
  readonly result: string
  readonly checks: Readonly<Record<string, string>>
}

function readIfPresent(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : ""
}

// What a failed Windows run leaves behind: the task's status and error, its event types, and the parent's stderr tail.
function scenarioDiagnostics(outDir: string, scenario: ScenarioVerdict): string {
  const dir = join(outDir, scenario.runner, scenario.scenario)
  const task = readIfPresent(join(dir, "task.json"))
  const record = task === "" ? {} : (JSON.parse(task) as Record<string, unknown>)
  const events = readIfPresent(join(dir, "task.jsonl.log"))
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => (JSON.parse(line) as { readonly type?: string; readonly payload?: unknown }))
    .map((event) => `${event.type}${event.type === "child_error" || event.type === "task_start_failed" ? ` ${JSON.stringify(event.payload)}` : ""}`)
  return [
    `--- ${scenario.runner}/${scenario.scenario}: status=${String(record.status)} model=${String(record.model)} error=${String(record.error_message)}`,
    `events: ${events.join(", ")}`,
    `stderr tail: ${readIfPresent(join(dir, "stderr.log")).slice(-1500)}`,
  ].join("\n")
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return
  const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
  await Promise.race([once(killer, "close"), once(killer, "error")])
}

test.skipIf(!isWin32)(
  "#given process-runner task children on Windows #when their model hits a usage limit after a tool call #then each answers on its own fallback chain and the settings file is untouched",
  async () => {
    // given
    const outDir = mkdtempSync(join(tmpdir(), "omo-runtime-fallback-win-"))
    const driver = spawn(process.execPath, [driverPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TASK_RUNTIME_FALLBACK_OUT_DIR: outDir,
        TASK_RUNTIME_FALLBACK_RUNNERS: "child-process",
        TASK_RUNTIME_FALLBACK_SCENARIOS: SCENARIOS.join(","),
      },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    })
    let output = ""
    driver.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk
    })
    driver.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`fallback driver did not finish in ${DRIVER_TIMEOUT_MS}ms`)), DRIVER_TIMEOUT_MS)
    })

    // when
    try {
      await Promise.race([once(driver, "close"), deadline])
    } finally {
      clearTimeout(timer)
      await terminateProcessTree(driver)
    }

    // then
    try {
      const verdict = JSON.parse(readFileSync(join(outDir, "verdict.json"), "utf8")) as {
        readonly scenarios: readonly ScenarioVerdict[]
      }
      const failing = verdict.scenarios.filter((scenario) => scenario.result !== "PASS")
      expect(
        failing.map((scenario) => `${scenario.runner}/${scenario.scenario} ${JSON.stringify(scenario.checks)}`),
        failing.map((scenario) => scenarioDiagnostics(outDir, scenario)).join("\n") || output.slice(-4000),
      ).toEqual([])
      expect(verdict.scenarios.map((scenario) => scenario.scenario).sort()).toEqual([...SCENARIOS].sort())
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  },
  DRIVER_TIMEOUT_MS + 30_000,
)
