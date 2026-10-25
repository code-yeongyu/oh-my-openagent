import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { fileURLToPath } from "node:url"

import { fakeCommandContext, fakeDeps } from "../commands/commands.test-support"
import { registerPeopleCommand } from "../commands/people"
import { MemoryFakeExtensionAPI } from "../memory.test-support"
import { registerPalaceCommand, type PalaceCommandContext } from "./command"
import { createPalaceRuntimeLoader, PALACE_RUNTIME_ARTIFACT } from "./runtime-loader"

// Each scenario spawns a fresh Bun process that builds a Git-backed fixture.
setDefaultTimeout(90_000)

const PROBE = fileURLToPath(new URL("./lazy-runtime-probe.test-support.ts", import.meta.url))

async function runProbe(scenario: "palace" | "people" | "startup"): Promise<Record<string, unknown>> {
  const child = Bun.spawn([process.execPath, PROBE, scenario], { stdout: "pipe", stderr: "pipe", env: process.env })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  const line = stdout.split("\n").find((entry) => entry.startsWith("PROBE_RESULT "))
  if (exitCode !== 0 || line === undefined) {
    throw new Error(`probe ${scenario} exited ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`)
  }
  return JSON.parse(line.slice("PROBE_RESULT ".length)) as Record<string, unknown>
}

function invokeHandler(pi: MemoryFakeExtensionAPI, name: string, args: string, ctx: unknown): Promise<unknown> {
  const registration = pi.commands.find((entry) => entry.name === name)
  const handler = registration?.options.handler
  if (typeof handler !== "function") throw new Error(`${name} command was not registered`)
  return Promise.resolve(Reflect.apply(handler, registration?.options, [args, ctx]))
}

describe("lazy memory palace sidecar", () => {
  test("#given a fresh process #when /palace runs for the first time through its registration #then the sidecar loads once and the output matches the direct runtime", async () => {
    const result = await runProbe("palace")

    expect(result.loadsAfterRegistration).toBe(0)
    expect(result.loadsAfterFirstUse).toBe(1)
    expect(result.loadsTotal).toBe(1)
    expect(result.lazy).toEqual(result.eager)
    const [opened, remote, unbound] = result.lazy as Array<Record<string, unknown>>
    expect(opened?.execCalls).toEqual([{ command: "open", args: [expect.stringMatching(/[\\/]viewers[\\/]palace-<ts>\.html$/)] }])
    expect(String(opened?.html)).toContain('id="omo-palace-data"')
    expect(remote?.notifications).toEqual([{ message: expect.stringMatching(/[\\/]viewers[\\/]palace-<ts>\.html$/), level: "info" }])
    expect(unbound?.notifications).toEqual([{ message: "memory is not bound in this session, so /palace has nothing to render", level: "warning" }])
  })

  test("#given a fresh process #when /people runs for the first time through its registration #then the sidecar loads once and every reply matches the direct runtime", async () => {
    const result = await runProbe("people")

    expect(result.loadsAfterRegistration).toBe(0)
    expect(result.loadsAfterFirstUse).toBe(1)
    expect(result.loadsTotal).toBe(1)
    expect(result.lazy).toEqual(result.eager)
    const [roster, , , miss] = result.lazy as Array<Record<string, unknown>>
    expect(roster?.notifications).toEqual([{ message: roster?.result, level: "info" }])
    expect(String(roster?.result)).toContain("jane-doe")
    expect(miss?.notifications).toEqual([{ message: expect.stringContaining('no person matches "jane doh"'), level: "error" }])
  })

  test("#given the full memory wiring #when a session starts and a turn settles #then the sidecar stays unloaded until /palace, which loads it exactly once", async () => {
    const result = await runProbe("startup")

    expect(result.loadsAfterStartup).toBe(0)
    expect(result.loadsAfterTurn).toBe(0)
    expect(result.loadsAfterPalace).toBe(1)
    expect(result.loadsTotal).toBe(1)
    expect(result.palaceOpened).toEqual(["open"])
    expect(result.secondPalaceOpened).toEqual(["open"])
    expect(result.peopleNotified).toBe(true)
  })

  test("#given a sidecar that fails to load #when /palace runs #then an actionable error notification names the artifact and the fix", async () => {
    const loader = createPalaceRuntimeLoader(() => Promise.reject(new Error("Cannot find module '#omo-memory-palace-runtime'")))
    const pi = new MemoryFakeExtensionAPI()
    registerPalaceCommand(pi, () => undefined, undefined, loader)
    const notifications: Array<{ message: string; level?: string }> = []
    const ctx: PalaceCommandContext = { hasUI: true, ui: { notify: (message, level) => notifications.push({ message, level }) } }

    await invokeHandler(pi, "palace", "", ctx)

    expect(notifications).toHaveLength(1)
    expect(notifications[0]?.level).toBe("error")
    expect(notifications[0]?.message).toContain("/palace")
    expect(notifications[0]?.message).toContain(PALACE_RUNTIME_ARTIFACT)
    expect(notifications[0]?.message).toContain("Cannot find module '#omo-memory-palace-runtime'")
    expect(notifications[0]?.message).toContain("reinstall omo, then start a new session")
  })

  test("#given a sidecar that fails to load #when /people runs #then the actionable error is the reply and its error notification", async () => {
    const loader = createPalaceRuntimeLoader(() => Promise.reject(new Error("unexpected token in omo-memory-palace.js")))
    const pi = new MemoryFakeExtensionAPI()
    registerPeopleCommand(pi, fakeDeps(undefined), loader)
    const ctx = fakeCommandContext()

    const reply = await invokeHandler(pi, "people", "", ctx)

    expect(ctx.ui.notifications).toEqual([{ message: String(reply), level: "error" }])
    expect(String(reply)).toContain("/people")
    expect(String(reply)).toContain(PALACE_RUNTIME_ARTIFACT)
    expect(String(reply)).toContain("unexpected token in omo-memory-palace.js")
    expect(String(reply)).toContain("reinstall omo, then start a new session")
  })

  test("#given one load failure #when the sidecar is requested again #then the loader retries and later calls share one load", async () => {
    let attempts = 0
    const runtime = { runPalaceCommand: async () => undefined, runPeopleCommand: async () => "" }
    const loader = createPalaceRuntimeLoader(() => {
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
