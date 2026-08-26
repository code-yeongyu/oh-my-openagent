/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { join } from "node:path"

// Regression guard for issue #7339 (pi-tui half): the task component's own register() must warm the
// lazy pi-tui boundary. composeOmoSenpiExtension's warm-up cannot do this job in the shipped
// product: compose bundles into omo.js while every synchronous piTui() consumer of the task surface
// bundles into the separately-loaded omo-task.js, whose module-scoped boundary state stays cold.
// The probe runs in a fresh `bun run` process, which ignores `[test] preload`, and self-reports
// that the boundary really was cold before register executed.
const PROBE = join(import.meta.dir, "__fixtures__", "register-cold-pi-tui-probe.ts")

type ProbeResult = {
  readonly coldBeforeRegister: boolean
  readonly widgetRendered: boolean
  readonly error?: string
}

async function runColdProbe(): Promise<ProbeResult> {
  const child = Bun.spawn({
    cmd: [process.execPath, "run", PROBE],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  const line = stdout.trim().split("\n").at(-1) ?? ""
  if (exitCode !== 0 || line.length === 0) {
    throw new Error(`cold probe failed (exit ${exitCode}):\n${stdout}\n${stderr}`)
  }
  return JSON.parse(line) as ProbeResult
}

describe("createTaskComponent pi-tui warm-up", () => {
  it("#given a cold process with only the task component registered #when the debounced status-widget timer renders #then no barrel error escapes the timer", async () => {
    // when
    const result = await runColdProbe()

    // then
    expect(result.coldBeforeRegister).toBe(true)
    expect(result.error).toBeUndefined()
    expect(result.widgetRendered).toBe(true)
  }, 60_000)
})
