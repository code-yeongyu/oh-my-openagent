import { afterEach, expect, test } from "bun:test"
import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, rmSync, writeFileSync } from "node:fs"
import { createConnection } from "node:net"
import { join } from "node:path"

import { resolveRpcSocketTransport } from "@oh-my-opencode/senpi-task/rpc-socket-client"

import { shortSocketDir } from "../../../../senpi-task/src/runners/rpc-host/short-socket-dir.test-support"
import { createLiveThreadSurface } from "./live-surface"

// #14444: concurrent thread_read calls of local terminals failed together (`thread RPC request timed out`, EPIPE,
// ECONNRESET) while the terminals answered within milliseconds. Another read running synchronous work in the same engine
// blocked the caller's event loop: the conversations already dialed could not send their secret within the terminal's
// handshake window, and the time the caller could not run was charged to the host's deadline.

const READS = 4
// Longer than the terminal's handshake window (2 s), as the remote leg of the reported batch blocked the caller.
const CALLER_STALL_MS = 2_500

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function startTerminal(socket: string, address: string): Promise<ChildProcess> {
  const host = spawn(process.execPath, [join(import.meta.dir, "caller-stall-host.fixture.ts"), socket, address], {
    stdio: ["ignore", "pipe", "inherit"],
  })
  cleanups.push(async () => {
    if (host.exitCode !== null) return
    const exited = new Promise((resolve) => host.once("exit", resolve))
    host.kill("SIGTERM")
    await exited
  })
  await new Promise<void>((resolve, reject) => {
    let out = ""
    const timer = setTimeout(() => reject(new Error("the terminal fixture never listened")), 10_000)
    host.once("exit", (code) => reject(new Error(`the terminal fixture exited ${code}`)))
    host.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8")
      if (!out.includes("READY\n")) return
      clearTimeout(timer)
      resolve()
    })
  })
  return host
}

function blockEventLoop(ms: number): void {
  const until = performance.now() + ms
  while (performance.now() < until) {
    // Synchronous work on the caller's own thread: nothing else in this process runs.
  }
}

// Where the terminal listens. "its own path": a unix socket at the endpoint's path. "a translated address": nothing
// exists at the endpoint's path and the dial goes elsewhere, as on Windows, where the address is a named pipe derived from
// the path and its secret (#14624 review M4); elsewhere a second socket path stands in for the pipe.
const shapes =
  process.platform === "win32"
    ? (["a translated address"] as const)
    : (["its own path", "a translated address"] as const)

test.each(shapes)(
  "#given a terminal served at %s #when another call blocks the caller past the handshake window #then concurrent reads all answer",
  async (shape) => {
    // The platform temp dir (a short /tmp parent only where a long one would not bind a unix socket).
    const { dir, socket } = shortSocketDir("caller-stall", "t-0123456789abcdef.sock")
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    writeFileSync(`${socket}.secret`, Buffer.alloc(32, 9), { mode: 0o600 })
    const pipe =
      process.platform === "win32" ? (await resolveRpcSocketTransport(socket))?.address : join(dir, "pipe.sock")
    if (pipe === undefined) throw new Error("no named pipe for the endpoint")
    const address = shape === "its own path" ? socket : pipe
    await startTerminal(socket, address)

    let dialed = 0
    const surface = createLiveThreadSurface(undefined, {
      env: { SENPI_CODING_AGENT_DIR: dir, OMO_CODING_AGENT_DIR: dir, PI_CODING_AGENT_DIR: dir },
      socket: join(dir, "legacy.sock"),
      registry: async () => [],
      // A translated endpoint has no file at its own path: it is present when its secret is.
      ...(address === socket
        ? {}
        : { exists: (path: string) => (path === socket ? existsSync(`${socket}.secret`) : existsSync(path)) }),
      connect: () => {
        const connection = createConnection(address)
        dialed += 1
        // Every read has dialed and the terminal is accepting: the caller is busy before any of them can send its secret.
        if (dialed === READS) blockEventLoop(CALLER_STALL_MS)
        return connection
      },
    })
    const terminal = surface.endpoint(socket)
    const reads = Array.from({ length: READS }, (_, index) =>
      terminal.getMessages(`session-${index}`).then(
        (messages) => ({ ok: true as const, messages }),
        (error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }),
      ),
    )

    const results = await Promise.all(reads)
    expect(results).toEqual(
      Array.from({ length: READS }, (_, index) => ({
        ok: true as const,
        messages: [{ role: "user", content: `transcript of session-${index}` }],
      })),
    )
  },
)
