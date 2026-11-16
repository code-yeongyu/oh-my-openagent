/// <reference types="bun-types" />

// browser-doctor's `state` and `remedy` are machine-read: the browser skill routes on them. BrowserSkill extension 0.4.0
// groups every task tab into a native "BrowserSkill" tab group the browser saves and syncs, so each task leaves a group in
// the user's own browser (#12662). The doctor must not call such a browser ready, and when an up-to-date browser is
// connected beside it, the ready remedy must name that browser so the session cannot land on the 0.4.0 one.
//
// Hermetic: the report is built in-process from the doctor's own seams (a fake daemon socket, an injected CLI version, no
// browser catalog, fixed browser signals), so nothing on the host runs (no bsk, ps or plutil) and no profile is read.
import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { createServer, type Server, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runBrowserDoctor } from "./skills/browser/scripts/browser-doctor-report.mjs"
import { loadOmowright } from "./skills/browser/scripts/omowright.mjs"

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
        const result =
          frame.method === "system.status"
            ? { daemon_version: "0.4.0", protocol_version: "1.7", browsers, sessions: [] }
            : { pong: true }
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

async function doctor(browsers: ReadonlyArray<Record<string, unknown>>) {
  const bskHome = await fakeDaemon(browsers)
  const { entry, omowright } = await loadOmowright({})
  return await runBrowserDoctor({
    omowright,
    entry,
    doctorOptions: {
      client: new omowright.BskIpcClient({ home: bskHome, autoStart: false }),
      platform: "linux",
      home: bskHome,
      env: {},
      bskBin: "/fake/bsk",
      cliVersion: async () => "bsk 0.4.2",
      exists: () => false,
      signals: { defaultBrowser: null, running: [], lastUsed: {} },
    },
  })
}

const OLD = { instance_id: "abc12345", browser_name: "chrome", browser_version: "153", extension_version: "0.4.0" }
const CURRENT = { instance_id: "def67890", browser_name: "edge", browser_version: "153", extension_version: "0.4.2" }

// Unix only: the fake daemon listens on a Unix socket under its home; Windows reaches the daemon over a named pipe.
test.skipIf(process.platform === "win32")(
  "a browser connected only through BrowserSkill extension 0.4.0 is not ready",
  async () => {
    const summary = await doctor([OLD])
    expect(summary.state).toBe("outdated-extension")
    expect(summary.remedy).toContain("0.4.1")
    expect(summary.browsersConnected).toEqual([
      { instanceId: "abc12345", name: "chrome", version: "153", extensionVersion: "0.4.0" },
    ])
  },
)

test.skipIf(process.platform === "win32")(
  "beside a 0.4.0 browser, the ready remedy names the up-to-date browser and lists the outdated one",
  async () => {
    const mixed = await doctor([OLD, CURRENT])
    expect(mixed.state).toBe("ready")
    expect(mixed.remedy).toContain('browser: "def67890"')
    expect(mixed.remedy).toContain("abc12345")

    const current = await doctor([CURRENT])
    expect(current.state).toBe("ready")
    expect(current.remedy).not.toContain("browser:")
  },
)
