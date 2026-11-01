import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, watch } from "node:fs"
import { createRequire } from "node:module"
import { createConnection } from "node:net"
import { dirname, join } from "node:path"
import { describe, expect, it } from "bun:test"

import { testTempDir } from "../test-support/temp-dir"

// O01 package probe (senpi#4272, PLAN rows X06/T7): the senpi engine omo actually ships, launched from its
// packaged bin at the pinned version, must advertise the engine-socket compact delta pair in get_protocol_info
// when SENPI_ENGINE_SOCKET_COMPACT_UPDATES=1, and nothing compact without the flag. omo adds no protocol logic.
const COMPACT_PAIR = ["compact_message_updates_v1", "event_resync"] as const
const COMPACT_NAMES = [...COMPACT_PAIR, "compact_events"] as const

const requireFromHere = createRequire(import.meta.url)
const packageDir = dirname(requireFromHere.resolve("@code-yeongyu/senpi/package.json"))
const packaged = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
  version: string
  bin: Record<string, string>
}
const omoSenpi = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")) as {
  devDependencies: Record<string, string>
}
const pinnedVersion = omoSenpi.devDependencies["@code-yeongyu/senpi"]

type ProtocolInfo = { readonly serverVersion: string; readonly capabilities: readonly string[] }

function waitForSocket(dir: string, socketPath: string, exited: Promise<number | null>): Promise<void> {
  return new Promise((resolve, reject) => {
    const watcher = watch(dir)
    const timer = setTimeout(() => finish(new Error(`host never bound ${socketPath}`)), 60_000)
    function finish(error?: Error) {
      clearTimeout(timer)
      watcher.close()
      if (error) reject(error)
      else resolve()
    }
    watcher.on("change", () => existsSync(socketPath) && finish())
    void exited.then((code) => finish(new Error(`host exited (${code}) before binding`)))
    if (existsSync(socketPath)) finish()
  })
}

function requestProtocolInfo(socketPath: string): Promise<ProtocolInfo> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ""
    const timer = setTimeout(() => done(new Error("get_protocol_info timed out")), 20_000)
    function done(error: Error | undefined, info?: ProtocolInfo) {
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else resolve(info as ProtocolInfo)
    }
    socket.on("error", (error) => done(error))
    socket.on("connect", () => socket.write(`${JSON.stringify({ id: "o01-probe", type: "get_protocol_info" })}\n`))
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8")
      const newline = buffer.indexOf("\n")
      if (newline < 0) return
      const frame = JSON.parse(buffer.slice(0, newline)) as { success?: boolean; data?: ProtocolInfo }
      if (frame.success !== true || frame.data === undefined) return done(new Error(`refused: ${buffer.slice(0, newline)}`))
      done(undefined, frame.data)
    })
  })
}

async function probePackagedHost(compactFlag: "1" | undefined): Promise<ProtocolInfo> {
  const root = testTempDir("omo-o01-probe-")
  const agentDir = join(root, "agent")
  mkdirSync(agentDir, { mode: 0o755 })
  const socketPath = join(root, "h.sock")
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: root,
    SENPI_CODING_AGENT_DIR: agentDir,
    OMO_CODING_AGENT_DIR: agentDir,
    PI_CODING_AGENT_DIR: agentDir,
    OMO_DISABLE_POSTHOG: "true",
  }
  delete env.SENPI_ENGINE_SOCKET_COMPACT_UPDATES
  if (compactFlag !== undefined) env.SENPI_ENGINE_SOCKET_COMPACT_UPDATES = compactFlag
  const host = spawn(
    process.execPath,
    [join(packageDir, packaged.bin.senpi), "--mode", "rpc", "--listen", socketPath],
    { cwd: root, env, stdio: ["ignore", "ignore", "pipe"] },
  )
  const exited = new Promise<number | null>((resolve) => host.once("exit", (code) => resolve(code)))
  try {
    await waitForSocket(root, socketPath, exited)
    return await requestProtocolInfo(socketPath)
  } finally {
    host.kill("SIGTERM")
    await exited
  }
}

describe.skipIf(process.platform === "win32")("packaged senpi engine compact delta (O01 package probe)", () => {
  it("#given the pinned senpi package #when its bin is resolved #then it is the exact pinned version", () => {
    expect(packaged.version).toBe(pinnedVersion)
  })

  it("#given SENPI_ENGINE_SOCKET_COMPACT_UPDATES=1 #when the packaged host answers get_protocol_info #then it advertises the compact delta pair", async () => {
    const info = await probePackagedHost("1")

    expect(info.serverVersion).toBe(pinnedVersion)
    expect(info.capabilities).toEqual(expect.arrayContaining([...COMPACT_PAIR]))
  }, 90_000)

  it("#given the compact flag unset #when the packaged host answers get_protocol_info #then no compact name is advertised", async () => {
    const info = await probePackagedHost(undefined)

    expect(info.capabilities.filter((capability) => (COMPACT_NAMES as readonly string[]).includes(capability))).toEqual([])
  }, 90_000)
})
