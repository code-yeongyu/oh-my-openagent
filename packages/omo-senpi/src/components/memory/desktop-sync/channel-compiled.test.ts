import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { spawn, type StdioOptions } from "node:child_process"
import { once } from "node:events"
import { mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Duplex } from "node:stream"
import { z } from "zod"
import { readFrames, writeFrame } from "./framing"

// #11997 row 5. The newest pinned senpi known to refuse every win32 pair: senpi#5125 records the Bun 1.4.4
// proof that enables them (senpi#5142 the pipe recognition). Up to this version the win32 pair case is
// skipped; a newer senpi that still refuses fails the case loudly instead.
const SENPI_WITHOUT_WINDOWS_PAIR = "2026.10.30-1"
const senpiVersion = z.object({ version: z.string() }).parse(createRequire(import.meta.url)("@code-yeongyu/senpi/package.json")).version
const versionParts = (version: string) => version.split(/[.-]/).map(Number)
function newerThan(version: string, than: string): boolean {
  const [left, right] = [versionParts(version), versionParts(than)]
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0)
    if (delta !== 0) return delta > 0
  }
  return false
}
const senpiCarriesWindowsPair = newerThan(senpiVersion, SENPI_WITHOUT_WINDOWS_PAIR)

const root = mkdtempSync(join(tmpdir(), "omo-memsync-compiled-"))
const engine = join(root, process.platform === "win32" ? "engine.exe" : "engine")

beforeAll(async () => {
  const fixture = join(import.meta.dir, "channel-compiled.fixture.ts")
  const build = spawn(process.execPath, ["build", "--compile", fixture, "--outfile", engine], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true })
  let errors = ""
  build.stderr?.on("data", (chunk: Buffer) => { errors += chunk.toString() })
  const [code] = await once(build, "close", { signal: AbortSignal.timeout(120_000) })
  if (code !== 0) throw new Error(`bun build --compile failed: ${errors}`)
}, 150_000)

afterAll(() => rmSync(root, { recursive: true, force: true }))

async function launch(table: string, slots: number) {
  const stdio: StdioOptions = ["ignore", "pipe", "pipe", "ignore", "ignore"]
  for (let slot = 0; slot < slots; slot++) stdio.push("pipe")
  const env: Record<string, string | undefined> = { ...process.env, SENPI_PRIVATE_FDS: table }
  delete env.SENPI_PRIVATE_FDS_FINAL
  const child = spawn(engine, [], { env, stdio, windowsHide: true })
  const closed = once(child, "close", { signal: AbortSignal.timeout(60_000) })
  let report = ""
  let errors = ""
  child.stdout?.on("data", (chunk: Buffer) => { report += chunk.toString() })
  child.stderr?.on("data", (chunk: Buffer) => { errors += chunk.toString() })
  const pipes: readonly unknown[] = child.stdio
  const frames: unknown[] = []
  // POSIX: one socket at fd 5. win32: fd 5 carries desktop->engine and fd 6 engine->desktop.
  const toEngine = pipes[5]
  const toDesktop = pipes[slots === 2 ? 6 : 5]
  if (toEngine instanceof Duplex && toDesktop instanceof Duplex) {
    readFrames(toDesktop, (packet) => {
      frames.push(packet)
      if (typeof packet !== "object" || packet === null || !("id" in packet) || !("op" in packet)) return
      writeFrame(toEngine, { id: packet.id, ok: true, value: packet.op === "bootstrap" ? { child: "compiled-child" } : { descriptor: "ok" } })
    }, () => {})
  }
  try {
    const [code] = await closed
    expect(code, errors).toBe(0)
    return { report: JSON.parse(report), frames }
  } finally {
    for (const pipe of pipes) if (pipe instanceof Duplex) pipe.destroy()
  }
}

const connected = {
  report: { kind: "desktop", reply: { descriptor: "ok" } },
  frames: [{ id: 1, op: "bootstrap" }, { id: 2, op: "request", capability: "compiled-child", request: { op: "descriptor" } }],
}

describe("the memory-sync channel in a Bun-compiled engine (#11997)", () => {
  test("a declared channel whose descriptors were not handed over is unavailable, never the CLI source", async () => {
    const table = process.platform === "win32" ? '{"memory-sync":[5,6]}' : '{"memory-sync":5}'
    expect(await launch(table, 0)).toEqual({ report: { kind: "unavailable", reason: "private_channel_unavailable" }, frames: [] })
  }, 90_000)

  test.skipIf(process.platform === "win32")("POSIX: the engine bootstraps and requests over the fd 5 socket", async () => {
    expect(await launch('{"memory-sync":5}', 1)).toEqual(connected)
  }, 90_000)

  test.skipIf(process.platform !== "win32" || !senpiCarriesWindowsPair)(
    "win32: the engine bootstraps and requests over the two one-way pipes (needs senpi#5125)",
    async () => {
      expect(await launch('{"memory-sync":[5,6]}', 2), `senpi ${senpiVersion} under Bun ${Bun.version} refused the pair`).toEqual(connected)
    },
    90_000,
  )
})
