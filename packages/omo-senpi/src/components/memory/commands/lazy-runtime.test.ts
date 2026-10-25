import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { fileURLToPath } from "node:url"

import { MemoryFakeExtensionAPI } from "../memory.test-support"
import { fakeCommandContext, fakeDeps, invoke } from "./commands.test-support"
import { registerMemoryCommands } from "./register"
import { createMemoryCommandsRuntimeLoader, MEMORY_COMMANDS_RUNTIME_ARTIFACT } from "./runtime-loader"

// The first scenario spawns a fresh Bun process that builds a Git-backed fixture.
setDefaultTimeout(90_000)

const PROBE = fileURLToPath(new URL("./lazy-runtime-probe.test-support.ts", import.meta.url))

async function runProbe(): Promise<Record<string, unknown>> {
  const child = Bun.spawn([process.execPath, PROBE], { stdout: "pipe", stderr: "pipe", env: process.env })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  const line = stdout.split("\n").find((entry) => entry.startsWith("PROBE_RESULT "))
  if (exitCode !== 0 || line === undefined) throw new Error(`probe exited ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`)
  return JSON.parse(line.slice("PROBE_RESULT ".length)) as Record<string, unknown>
}

describe("lazy memory commands sidecar", () => {
  test("#given a fresh process #when the suite registers and two commands run #then the sidecar loads once, on first use, and replies and metadata match the direct registrations", async () => {
    const result = await runProbe()

    expect(result.loadsAfterRegistration).toBe(0)
    expect(result.loadsAfterFirstUse).toBe(1)
    expect(result.loadsTotal).toBe(1)
    expect(result.lazy).toEqual(result.eager)
    expect(result.lazyMetadata).toEqual(result.eagerMetadata)
    const [memory] = result.lazy as Array<{ result: string }>
    expect(memory?.result).toContain("lazy probe")
  })

  test("#given a sidecar that fails to load #when a lazy command runs #then the actionable error is the reply and its error notification", async () => {
    const loader = createMemoryCommandsRuntimeLoader(() => Promise.reject(new Error("Cannot find module '#omo-memory-commands-runtime'")))
    const pi = new MemoryFakeExtensionAPI()
    registerMemoryCommands(pi, fakeDeps(undefined), loader)
    const ctx = fakeCommandContext()

    const reply = await invoke(pi, "sleeptime", "", ctx)

    expect(ctx.ui.notifications).toEqual([{ message: reply, level: "error" }])
    expect(reply).toContain("/sleeptime")
    expect(reply).toContain(MEMORY_COMMANDS_RUNTIME_ARTIFACT)
    expect(reply).toContain("Cannot find module '#omo-memory-commands-runtime'")
    expect(reply).toContain("reinstall omo, then start a new session")
  })

  test("#given one load failure #when the sidecar is requested again #then the loader retries and later calls share one load", async () => {
    let attempts = 0
    const runtime = { runMemoryCommand: async () => "" }
    const loader = createMemoryCommandsRuntimeLoader(() => {
      attempts += 1
      return attempts === 1 ? Promise.reject(new Error("transient")) : Promise.resolve(runtime)
    })

    await expect(loader()).rejects.toThrow("transient")
    const [first, second] = await Promise.all([loader(), loader()])

    expect(first).toBe(runtime)
    expect(second).toBe(runtime)
    expect(attempts).toBe(2)
  })
})
