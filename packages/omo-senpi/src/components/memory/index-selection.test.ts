import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { Duplex } from "node:stream"
import { readFrames, writeFrame } from "./desktop-sync/framing"

async function registration(scenario: string): Promise<{ source?: string; cliBuilt: number; declared?: boolean; sharedSource?: boolean; error?: string; claims: number }> {
  const env = { ...process.env }
  delete env.SENPI_PRIVATE_FDS
  delete env.SENPI_PRIVATE_FDS_FINAL
  if (scenario === "desktop" || scenario === "worker-desktop") env.SENPI_PRIVATE_FDS = '{"memory-sync":5}'
  else if (scenario !== "cli" && scenario !== "worker-absent") env.SENPI_PRIVATE_FDS = '{"memory-sync":null}'
  const child = spawn(process.execPath, [new URL("./index-selection.fixture.ts", import.meta.url).pathname, scenario], {
    env, stdio: ["ignore", "pipe", "pipe", "ignore", "ignore", "pipe"],
  })
  let output = ""
  let errors = ""
  let claims = 0
  let handles = 0
  if (child.stdout === null || child.stderr === null) throw new Error("missing fixture output pipes")
  child.stdout.on("data", chunk => { output += chunk.toString() })
  child.stderr.on("data", chunk => { errors += chunk.toString() })
  const stream: unknown = Reflect.get(child.stdio, 5)
  if (!(stream instanceof Duplex)) throw new Error("missing inherited socket")
  readFrames(stream, packet => {
    const request = packet as { id: number; op: string; request?: { op: string } }
    let value: unknown = {}
    if (request.op === "bootstrap") {
      claims += 1
      value = { child: "fixture-child" }
    } else if (request.request?.op === "descriptor") {
      value = {
        genesis: "unsupported", rpId: null, userName: null,
        serviceOrigin: "https://api.example.test", accountId: "account-1", serviceDeviceId: "device-1",
        syncPrincipalId: "principal-1", publicKeys: { signing: "signing-1", sealing: "sealing-1" },
        generation: "generation-1", incarnation: "incarnation-1",
      }
    } else if (request.request?.op === "operationBegin") {
      value = { handle: `handle-${++handles}` }
    }
    writeFrame(stream, { id: request.id, ok: true, value })
  }, () => {})
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject)
      child.once("close", resolve)
      timer = setTimeout(() => reject(new Error(`registration ${scenario} did not exit: ${errors}`)), 20_000)
    })
    if (code !== 0) throw new Error(`registration ${scenario} exited ${code}: ${errors}`)
    return { ...JSON.parse(output), claims }
  } finally {
    clearTimeout(timer)
    stream.destroy()
    if (child.exitCode === null) child.kill()
  }
}

describe("memory component registration selects the engine account source", () => {
  test("(a) an in-process desktop daemon selects desktop through the real inherited channel", async () => {
    expect(await registration("desktop")).toEqual({ source: "desktop", cliBuilt: 0, declared: true, sharedSource: true, claims: 1 })
  }, 30_000)

  test("(b) a declared null channel is unavailable and never constructs CLI", async () => {
    expect(await registration("declared-null")).toEqual({ source: "unavailable:private_channel_unavailable", cliBuilt: 0, declared: true, sharedSource: true, claims: 0 })
  }, 30_000)

  test("(c) a Worker runtime without bootstrap is unavailable, never CLI", async () => {
    expect(await registration("worker-absent")).toEqual({ source: "unavailable:host_bootstrap_absent", cliBuilt: 0, declared: false, sharedSource: true, claims: 0 })
  }, 30_000)

  test("(d) an undeclared launch still builds the CLI source", async () => {
    expect(await registration("cli")).toEqual({ source: "null", cliBuilt: 1, declared: false, sharedSource: true, claims: 0 })
  }, 30_000)

  test("(e) a provideSessionWorkerData throw propagates out of registration", async () => {
    const result = await registration("provider-throw")
    expect(result.error).toContain('session worker data "omo.memory-sync.v1" is already provided')
    expect(result.cliBuilt).toBe(0)
  }, 30_000)

  test("the real senpi handoff gives a session Worker the host's desktop selection", async () => {
    expect(await registration("worker-desktop")).toEqual({ source: "desktop", cliBuilt: 0, declared: false, sharedSource: true, claims: 1 })
  }, 30_000)

  test("deviceAccount overrides win without constructing the default source", async () => {
    expect(await registration("override")).toEqual({ source: "unavailable:selection_failed", cliBuilt: 0, declared: true, sharedSource: true, claims: 0 })
  }, 30_000)
})
