import { spawn } from "node:child_process"
import { mkdirSync, readFileSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { createConnection } from "node:net"
import { dirname, join } from "node:path"
import { describe, expect, it, onTestFinished } from "bun:test"

import { MAX_SHARD_BIND_PATH } from "../../senpi-task/src/runners/rpc-host/shard-socket"
import { shortSocketDir } from "../../senpi-task/src/runners/rpc-host/short-socket-dir.test-support"
import { testTempDir } from "../test-support/temp-dir"
import { remainingTestTime, useTestTimeout } from "../../../test-support/test-deadline"

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

function probeSocketPath(): string {
  const { dir, socket } = shortSocketDir("o01-probe", "h.sock")
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  return socket
}

// Readiness is the host's own signal: it prints `senpi rpc listening on unix://<path>` once the socket is bound.
// A directory watch is not one: macOS does not report a bound socket as a change event, so the wait never ended.
function waitForListening(stderr: NodeJS.ReadableStream, socketPath: string, exited: Promise<number | null>): Promise<void> {
  const ready = `senpi rpc listening on unix://${socketPath}`
  return new Promise((resolve, reject) => {
    let seen = ""
    // The tail carries the host's error line; the head is only the source excerpt Bun prints above it.
    const timer = setTimeout(() => finish(new Error(`host never reported listening on ${socketPath} within the test budget; stderr: ${seen.slice(-2000)}`)), remainingTestTime())
    function finish(error?: Error) {
      clearTimeout(timer)
      stderr.off("data", onData)
      if (error) reject(error)
      else resolve()
    }
    function onData(chunk: Buffer | string) {
      seen += chunk.toString()
      if (seen.includes(ready)) finish()
    }
    stderr.on("data", onData)
    void exited.then((code) => finish(new Error(`host exited (${code}) before listening; stderr: ${seen.slice(-2000)}`)))
  })
}

function requestProtocolInfo(socketPath: string): Promise<ProtocolInfo> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ""
    const timer = setTimeout(() => done(new Error("get_protocol_info did not answer within the test budget")), remainingTestTime())
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
  const socketPath = probeSocketPath()
  // The runner's own session (PI_SESSION_FILE, SENPI_RUNTIME, OMO_* roots) must not reach the probed host.
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(PI_|SENPI_|OMO_)/.test(key)))
  const env: NodeJS.ProcessEnv = {
    ...inherited,
    HOME: root,
    SENPI_CODING_AGENT_DIR: agentDir,
    OMO_CODING_AGENT_DIR: agentDir,
    PI_CODING_AGENT_DIR: agentDir,
    OMO_DISABLE_POSTHOG: "true",
  }
  if (compactFlag !== undefined) env.SENPI_ENGINE_SOCKET_COMPACT_UPDATES = compactFlag
  const host = spawn(
    process.execPath,
    [join(packageDir, packaged.bin.senpi), "--mode", "rpc", "--listen", socketPath],
    { cwd: root, env, stdio: ["ignore", "ignore", "pipe"] },
  )
  // A spawn that fails emits 'error' and never 'exit'; settle on either so the wait names it and teardown never hangs.
  const exited = new Promise<number | null>((resolve) => {
    host.once("exit", (code) => resolve(code))
    host.once("error", () => resolve(null))
  })
  try {
    await waitForListening(host.stderr, socketPath, exited)
    host.stderr.resume()
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

  // #12557: the root suite's preload nests TMPDIR one level deeper than a package run, and a long runner TMPDIR
  // then put `<TMPDIR>/<probe dir>/h.sock` over the engine's limit, so the host exited 1 before binding.
  it("#given a runner TMPDIR too deep for the engine's socket limit #when the packaged host is probed #then it still binds and answers", async () => {
    useTestTimeout(90_000)
    const deep = join(testTempDir("omo-o01-deep-"), "d".repeat(MAX_SHARD_BIND_PATH))
    mkdirSync(deep)
    const previous = process.env.TMPDIR
    process.env.TMPDIR = deep
    try {
      const info = await probePackagedHost(undefined)

      expect(info.serverVersion).toBe(pinnedVersion)
    } finally {
      if (previous === undefined) delete process.env.TMPDIR
      else process.env.TMPDIR = previous
    }
  }, 90_000)

  it("#given SENPI_ENGINE_SOCKET_COMPACT_UPDATES=1 #when the packaged host answers get_protocol_info #then it advertises the compact delta pair", async () => {
    useTestTimeout(90_000)
    const info = await probePackagedHost("1")

    expect(info.serverVersion).toBe(pinnedVersion)
    expect(info.capabilities).toEqual(expect.arrayContaining([...COMPACT_PAIR]))
  }, 90_000)

  it("#given the compact flag unset #when the packaged host answers get_protocol_info #then no compact name is advertised", async () => {
    useTestTimeout(90_000)
    const info = await probePackagedHost(undefined)

    expect(info.capabilities.filter((capability) => (COMPACT_NAMES as readonly string[]).includes(capability))).toEqual([])
  }, 90_000)
})
