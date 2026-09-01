/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { join } from "node:path"

// Regression guard for the pi-tui warm-up boundary.
//
// This suite deliberately does NOT exercise compose in-process: the root bunfig preload
// (test-setup.ts) and the senpi-task package preload both await loadPiTui() before any test body
// runs, so an in-process assertion would pass even with no warm-up in compose at all. The probe
// runs in a fresh `bun run` process, which ignores `[test] preload`, and self-reports that the
// boundary really was cold before compose executed.
const PROBE = join(import.meta.dir, "__fixtures__", "cold-pi-tui-probe.ts")

type ProbeResult = {
  readonly coldBeforeCompose: boolean
  readonly rendered: boolean
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

describe("composeOmoSenpiExtension pi-tui warm-up", () => {
  it("#given a cold process with the task component disabled #when compose runs #then other components' notice renderers still render", async () => {
    // when
    const result = await runColdProbe()

    // then
    expect(result.coldBeforeCompose).toBe(true)
    expect(result.error).toBeUndefined()
    expect(result.rendered).toBe(true)
  }, 60_000)
})
