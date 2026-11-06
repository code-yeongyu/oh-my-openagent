/// <reference types="bun-types" />

// browser-doctor.mjs is the browser skill's machine-read readiness probe: its JSON `state` routes the agent. A connected
// BrowserSkill extension 0.4.0 groups every task tab into a native "BrowserSkill" tab group that the browser saves and
// syncs, so each task leaves a group in the user's own browser (#12662). The doctor must not call that browser ready.
import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { createServer, type Server, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

const doctor = join(import.meta.dir, "skills", "browser", "scripts", "browser-doctor.mjs")
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function fakeDaemon(browsers: ReadonlyArray<Record<string, unknown>>) {
  const home = await mkdtemp(join(tmpdir(), "omo-bsk-doctor-"))
  await mkdir(join(home, "run"))
  const sockets = new Set<Socket>()
  const server: Server = createServer((socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
    let buffer = ""
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8")
      for (let index = buffer.indexOf("\n"); index !== -1; index = buffer.indexOf("\n")) {
        const frame = JSON.parse(buffer.slice(0, index)) as { id: string; method: string }
        buffer = buffer.slice(index + 1)
        const result = frame.method === "system.status" ? { daemon_version: "0.4.0", protocol_version: "1.7", browsers, sessions: [] } : { pong: true }
        socket.write(`${JSON.stringify({ id: frame.id, result })}\n`)
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(join(home, "run", "daemon.sock"), resolve))
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(home, { recursive: true, force: true })
  })
  return home
}

async function doctorState(browsers: ReadonlyArray<Record<string, unknown>>) {
  const home = await fakeDaemon(browsers)
  const child = Bun.spawn([process.execPath, doctor, "--json"], { env: { ...process.env, BSK_HOME: home, BSK_AUTO_START: "0" }, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
  return JSON.parse(stdout) as { state: string; remedy: string; browsersConnected: Array<{ instanceId: string; name: string; version: string; extensionVersion: string | null }> }
}

// Unix only: the fake daemon is found through the default Unix socket at $BSK_HOME/run/daemon.sock; Windows reaches the
// daemon over a named pipe that omowright does not discover from BSK_HOME.
test.skipIf(process.platform === "win32")("a browser connected only through BrowserSkill extension 0.4.0 is not ready", async () => {
  const outdated = await doctorState([{ instance_id: "abc12345", browser_name: "chrome", browser_version: "153", extension_version: "0.4.0" }])
  expect(outdated.state).toBe("outdated-extension")
  expect(outdated.remedy).toContain("0.4.1")
  expect(outdated.browsersConnected).toEqual([{ instanceId: "abc12345", name: "chrome", version: "153", extensionVersion: "0.4.0" }])

  const mixed = await doctorState([
    { instance_id: "abc12345", browser_name: "chrome", browser_version: "153", extension_version: "0.4.0" },
    { instance_id: "def67890", browser_name: "edge", browser_version: "153", extension_version: "0.4.2" },
  ])
  expect(mixed.state).toBe("ready")
})
