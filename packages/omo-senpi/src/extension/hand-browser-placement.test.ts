/// <reference types="bun-types" />

// Browser placement = HAND (Q, 2026-11-04). omo has no browser tool of its own: a browser task goes through the
// browser skill's shell commands or an MCP browser tool. The fixture drives the engine's real split-local path (a
// session's remote ToolHost linked to a real hand) in a child process, so the engine's process-wide state never
// reaches other tests; the MCP half of this proof waits on senpi#5747 (a hand never serves MCP tools yet).

import { afterEach, describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const FIXTURE = join(import.meta.dir, "hand-browser-placement.test-fixture.ts")
const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Runs the fixture with HOME and every agent-dir variable inside `scratch`, bounded so a hung hand fails the test. */
function runFixture(scratch: string, handRoot: string): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  const agentDir = join(scratch, "agent")
  const env = { ...process.env, HOME: join(scratch, "home"), SENPI_CODING_AGENT_DIR: agentDir, OMO_CODING_AGENT_DIR: agentDir, PI_CODING_AGENT_DIR: agentDir }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [FIXTURE, handRoot, agentDir], { cwd: import.meta.dir, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString() })
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`hand fixture did not finish within 60 s: ${stderr.slice(-800)}`)) }, 60_000)
    child.on("error", (error) => { clearTimeout(timer); reject(error) })
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }) })
  })
}

describe("browser work on a split session runs on the hand (Q 2026-11-04: browser = HAND)", () => {
  test("#given a session linked to a hand #when the browser skill's shell command runs #then it executes on the hand, in the hand scope's root", async () => {
    // given
    const scratch = mkdtempSync(join(tmpdir(), "omo-hand-browser-"))
    tempDirs.push(scratch)
    const handRoot = join(scratch, "hand-root")
    for (const dir of [handRoot, join(scratch, "agent"), join(scratch, "home")]) mkdirSync(dir, { recursive: true })

    // when
    const run = await runFixture(scratch, handRoot)

    // then
    expect({ code: run.code, stderr: run.code === 0 ? "" : run.stderr.slice(-800) }).toEqual({ code: 0, stderr: "" })
    expect(JSON.parse(run.stdout.trim().split("\n").at(-1) ?? "{}")).toEqual({ results: [handRoot] })
  }, 90_000)
})
