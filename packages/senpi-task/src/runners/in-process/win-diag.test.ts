import { describe, expect, test } from "bun:test"

import { InProcessRunner } from "../in-process"
import { createBuiltinChildMachine, openBoundSession, watchHttpServers } from "./__fixtures__/builtin-child"
import type { ChildSession } from "./child-handle"

// PROBE ONLY (#9418, never merged): what does an in-process child with the builtin extensions
// actually start on this platform? Prints facts; asserts nothing about the fix.

async function osListeningPorts(): Promise<string[]> {
  const argv = process.platform === "win32" ? ["netstat", "-ano", "-p", "TCP"] : ["lsof", "-nP", "-a", "-p", String(process.pid), "-iTCP", "-sTCP:LISTEN"]
  const child = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" })
  const out = await new Response(child.stdout).text()
  await child.exited
  return out.split(/\r?\n/).filter((line) => process.platform === "win32" ? /LISTENING/.test(line) && line.trim().endsWith(` ${process.pid}`) : /LISTEN/.test(line)).map((line) => line.trim().replace(/\s+/g, " "))
}

describe("PROBE #9418: what a builtin in-process child starts", () => {
  test("print facts", async () => {
    const before = await osListeningPorts()
    const watch = watchHttpServers()
    const machine = await createBuiltinChildMachine()
    let captured: { paths: string[]; tools: string[] } | undefined
    const runner = new InProcessRunner({
      createSession: async (options): Promise<ChildSession> => {
        const session = await openBoundSession(options)
        captured = { paths: session.extensionRunner.getExtensionPaths(), tools: session.extensionRunner.getActiveTools() }
        return session
      },
    })
    const handle = await runner.start(machine.spec("probe-child", "succeeds"))
    const outcome = await handle.waitForIdle()
    const after = await osListeningPorts()
    const facts = {
      platform: process.platform,
      outcome: (outcome as { status?: string }).status,
      hookServers: watch.servers.length,
      hookListening: watch.servers.filter((server) => server.listening).length,
      osListenBefore: before,
      osListenAfter: after,
      extensionPaths: captured?.paths,
      codemodeLoaded: captured?.paths.some((path) => /senpi-codemode/.test(path)),
      evalActive: captured?.tools.includes("eval"),
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PI_|SENPI_|OMO_|CODEMODE|BUN_)/.test(key))),
    }
    console.log("PROBE_FACTS " + JSON.stringify(facts))
    await handle.dispose()
    watch.stop()
    machine.cleanup()
    expect(facts.platform).toBeString()
  }, 150_000)
})
