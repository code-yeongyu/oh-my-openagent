import { afterEach, describe, expect, test } from "bun:test"
import { spawn, type ChildProcess } from "node:child_process"
import { generateKeyPairSync, createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { connect, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Security contract: D11 enrollment design row M-1. A host omo launches carries the omo account authority and enforces
// presenter accounts by default, so a signed-out host refuses an account presenter.

const OMO_BIN = join(import.meta.dir, "..", "bin", "omo.js")
const HOST_READY = "senpi rpc listening on"
const started: ChildProcess[] = []
const homes: string[] = []
afterEach(async () => {
  for (const child of started.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    const exited = new Promise(resolve => child.once("exit", resolve))
    child.kill("SIGKILL")
    await exited
  }
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
}, 60_000)

type Frame = Record<string, unknown>

function lines(socket: Socket): () => Promise<Frame> {
  const queue: Frame[] = []
  const waiters: Array<(frame: Frame) => void> = []
  let buffered = ""
  socket.on("data", (chunk: Buffer) => {
    buffered += chunk.toString("utf8")
    for (let end = buffered.indexOf("\n"); end >= 0; end = buffered.indexOf("\n")) {
      const line = buffered.slice(0, end).trim()
      buffered = buffered.slice(end + 1)
      if (line === "") continue
      const frame = JSON.parse(line) as Frame
      const waiter = waiters.shift()
      if (waiter) waiter(frame)
      else queue.push(frame)
    }
  })
  return () => {
    const next = queue.shift()
    return next ? Promise.resolve(next) : new Promise(resolve => waiters.push(resolve))
  }
}

async function open(path: string) {
  const socket = connect(path)
  await new Promise<void>((resolve, reject) => socket.once("connect", resolve).once("error", reject))
  const next = lines(socket)
  const send = (frame: Frame) => socket.write(`${JSON.stringify(frame)}\n`)
  const request = async (frame: Frame): Promise<Frame> => {
    send(frame)
    for (;;) {
      const reply = await next()
      if (reply["id"] === frame["id"]) return reply
    }
  }
  return { socket, send, next, request }
}

async function omoHost(): Promise<{ socketPath: string; cwd: string }> {
  const home = mkdtempSync(join(tmpdir(), "omo-presenter-launch-"))
  // The control socket lands under the host's TMPDIR, so it gets a short one to stay below the sun_path limit.
  const hostTmp = mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", "opl-"))
  homes.push(home, hostTmp)
  const agentDir = join(home, "agent")
  mkdirSync(agentDir, { mode: 0o700 })
  const socketPath = join(hostTmp, "host.sock")
  const child = spawn(process.execPath, [OMO_BIN, "--mode", "rpc", "--multi-session", "--listen", `unix://${socketPath}`, "--no-skills", "--no-context-files"], {
    cwd: home,
    env: {
      PATH: process.env["PATH"], HOME: home, TMPDIR: hostTmp,
      OMO_CODING_AGENT_DIR: agentDir, SENPI_CODING_AGENT_DIR: agentDir,
      OMO_SERVICE_API_URL: "http://127.0.0.1:9",
      OMO_OFFLINE: "1", SENPI_OFFLINE: "1", PI_OFFLINE: "1", OMO_TELEMETRY: "0", PI_TELEMETRY: "0",
      OMO_RPC_REQUIRE_TOKEN: "0", SENPI_RPC_REQUIRE_TOKEN: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  started.push(child)
  let output = ""
  await new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      output += chunk.toString()
      if (output.includes(HOST_READY)) resolve()
    }
    child.stdout?.on("data", onData)
    child.stderr?.on("data", onData)
    child.once("exit", code => reject(new Error(`omo host exited (${code}) before it listened:\n${output}`)))
  })
  return { socketPath, cwd: home }
}

async function presenterContext(host: { socketPath: string; cwd: string }): Promise<Frame> {
  const peer = await open(host.socketPath)
  try {
    const opened = await peer.request({ id: "open", type: "open_session", cwd: host.cwd })
    const data = (opened["data"] ?? {}) as Frame
    const sessionId = data["sessionId"] ?? opened["sessionId"]
    const reply = await peer.request({ id: "context", type: "mcp_presenter_context", sessionId, discover: true })
    const context = ((reply["data"] ?? reply) as Frame)["context"]
    if (typeof context !== "object" || context === null) throw new Error(`no presenter context: ${JSON.stringify(reply)} (open: ${JSON.stringify(opened)})`)
    return context as Frame
  } finally {
    peer.socket.destroy()
  }
}

function controlPath(endpoint: unknown): string {
  if (typeof endpoint === "string") return endpoint
  const path = (endpoint as Frame | undefined)?.["path"]
  if (typeof path !== "string") throw new Error(`no presenter control endpoint: ${JSON.stringify(endpoint)}`)
  return path
}

describe("omo-launched host: presenter account authority (D11 M-1)", () => {
  test("an omo-launched host enforces presenter accounts and a signed-out host refuses account enrollment", async () => {
    const host = await omoHost()
    const context = await presenterContext(host)
    const control = await open(controlPath(context["controlEndpoint"]))
    const { publicKey } = generateKeyPairSync("ed25519")
    const spki = publicKey.export({ type: "spki", format: "der" })
    control.send({
      type: "account_enroll", version: 1, purpose: "mcp_form",
      publicKey: publicKey.export({ type: "spki", format: "pem" }),
      installationKeyId: createHash("sha256").update(spki).digest("hex"),
      attestation: "a.b.c",
    })
    const reply = await control.next()
    control.socket.destroy()
    expect(reply["reason"]).toBe("presenter_account_unavailable")
  }, 120_000)
})
