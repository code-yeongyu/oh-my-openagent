import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Duplex } from "node:stream"
import { readFrames, writeFrame } from "./desktop-sync/framing"

const senpiCli = join(dirname(createRequire(import.meta.url).resolve("@code-yeongyu/senpi/package.json")), "dist", "bundle", "cli.js")
const fixture = new URL("./index-engine.fixture.ts", import.meta.url).pathname

type Frame = { readonly id: number; readonly op: string; readonly capability?: string; readonly request?: { readonly op: string } }
type RpcLine = { readonly id?: string; readonly type?: string; readonly success?: boolean; readonly data?: unknown }

async function engineLaunch(declared: boolean) {
  const home = mkdtempSync(join(tmpdir(), "omo-memsync-engine-"))
  mkdirSync(join(home, "tmp"))
  // A fresh environment: variables other test files set in this process must not steer the engine's launch path.
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "", HOME: home, TMPDIR: join(home, "tmp"),
    OMO_MEMORY_HOME: join(home, "memory"), SENPI_CODING_AGENT_DIR: join(home, "agent"),
    ...(declared ? { SENPI_PRIVATE_FDS: '{"memory-sync":5}' } : {}),
  }
  const child = spawn(process.execPath, [senpiCli, "--mode", "rpc", "--no-session", "--no-extensions", "-e", fixture], {
    cwd: home, env, stdio: ["pipe", "pipe", "pipe", "ignore", "ignore", "pipe"],
  })
  const frames: Frame[] = []
  const pending = new Map<string, (line: RpcLine) => void>()
  let stdout = ""
  let stderr = ""
  child.stderr?.on("data", chunk => { stderr += chunk.toString() })
  child.stdout?.on("data", chunk => {
    stdout += chunk.toString()
    for (let end = stdout.indexOf("\n"); end >= 0; end = stdout.indexOf("\n")) {
      const raw = stdout.slice(0, end)
      stdout = stdout.slice(end + 1)
      if (!raw.startsWith("{")) continue
      const line = JSON.parse(raw) as RpcLine
      if (line.type === "response" && line.id !== undefined) pending.get(line.id)?.(line)
    }
  })
  const channel: unknown = Reflect.get(child.stdio, 5)
  if (!(channel instanceof Duplex)) throw new Error("missing the memory-sync socket")
  const bootstrapped = Promise.withResolvers<void>()
  readFrames(channel, packet => {
    const frame = packet as Frame
    frames.push(frame)
    if (frame.op === "bootstrap") {
      writeFrame(channel, { id: frame.id, ok: true, value: { child: "engine-child" } })
      bootstrapped.resolve()
    } else {
      writeFrame(channel, { id: frame.id, ok: false })
    }
  }, () => {})
  let sequence = 0
  const call = (name: string) => {
    const id = `call-${++sequence}`
    const reply = new Promise<RpcLine>(resolve => pending.set(id, resolve))
    child.stdin?.write(`${JSON.stringify({ id, type: "extension_request", name, data: {} })}\n`)
    return bounded(reply, `extension_request ${name}`)
  }
  const bounded = <T>(promise: Promise<T>, what: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`waited 120s for ${what}; engine stderr: ${stderr}`)), 120_000)
    })
    return Promise.race([promise, expired]).finally(() => clearTimeout(timer))
  }
  const close = () => {
    channel.destroy()
    child.kill("SIGKILL")
    rmSync(home, { recursive: true, force: true })
  }
  return { frames, call, bootstrapped: () => bounded(bootstrapped.promise, "the bootstrap frame"), close }
}

async function selection(launch: Awaited<ReturnType<typeof engineLaunch>>): Promise<unknown> {
  const reply = await launch.call("fixture.memory-sync.selection")
  if (reply.success !== true) throw new Error(`selection call failed: ${JSON.stringify(reply)}`)
  return reply.data
}

describe("the real senpi engine claims the desktop's private memory-sync channel at startup (#11997)", () => {
  test("a declared memory-sync socket gets the bootstrap frame and the engine adopts the reply's child", async () => {
    const launch = await engineLaunch(true)
    try {
      await launch.bootstrapped()
      expect(await selection(launch)).toEqual({ kind: "desktop" })
      // Resolving the account goes through the desktop source, addressed by the adopted child capability.
      await launch.call("omo.memory.sync.status")
      expect(launch.frames).toEqual([
        { id: 1, op: "bootstrap" },
        { id: 2, op: "request", capability: "engine-child", request: { op: "descriptor" } },
      ])
    } finally {
      launch.close()
    }
  }, 300_000)

  test("with no memory-sync channel declared the engine still selects the CLI source", async () => {
    const launch = await engineLaunch(false)
    try {
      expect(await selection(launch)).toEqual({ kind: "cli" })
      expect(launch.frames).toEqual([])
    } finally {
      launch.close()
    }
  }, 300_000)
})
