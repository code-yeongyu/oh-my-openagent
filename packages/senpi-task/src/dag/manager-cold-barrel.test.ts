/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { join } from "node:path"

// Regression guard for issue #7339 (senpi-barrel half): dag start (and amend) materialize node
// skills through the default filesystem skill loader, whose discovery reads senpiBarrel()
// synchronously. The manager's async entry points must await loadSenpiBarrel() first, or a
// definition with load_skills crashes the start call before any worker is dispatched. The probe
// runs in a fresh `bun run` process, which ignores `[test] preload`, and self-reports that the
// barrel really was cold before start executed.
const PROBE = join(import.meta.dir, "__fixtures__", "dag-start-cold-barrel-probe.ts")

type ProbeResult = {
  readonly coldBeforeStart: boolean
  readonly started: boolean
  readonly missingSkillReported: boolean
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

describe("createDagManager senpi-barrel warm-up", () => {
  it("#given a cold process and a definition with load_skills #when the run is created #then skill materialization does not throw the cold-barrel error", async () => {
    // when
    const result = await runColdProbe()

    // then
    expect(result.coldBeforeStart).toBe(true)
    expect(result.error).toBeUndefined()
    expect(result.started).toBe(true)
    expect(result.missingSkillReported).toBe(true)
  }, 60_000)
})
