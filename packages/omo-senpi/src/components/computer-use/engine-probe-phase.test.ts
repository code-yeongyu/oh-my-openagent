import { expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EventEmitter } from "node:events"
import { PassThrough, Writable } from "node:stream"
import { probeComputerUseEngine, type EngineLauncher } from "./engine-probe"

const HELLO = { protocolVersion: "x", engineVersion: "x", buildSha: "x", abi: "x" }

function writeEngine(body: string): { readonly path: string; readonly cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "omo-probe-phase-"))
  const path = join(root, "engine")
  writeFileSync(path, `#!${process.execPath}
import { createInterface } from "node:readline";
${body}
`)
  chmodSync(path, 0o755)
  return { path, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test.skipIf(process.platform === "win32")(
  "#given an engine that never answers #when the probe deadline expires #then the timeout names the phase it reached",
  async () => {
    // given
    const engine = writeEngine("process.stdin.resume();")
    try {
      // when
      const result = await probeComputerUseEngine(engine.path, {}, 300)

      // then
      expect(result).toMatchObject({ ok: false, code: "timeout" })
      expect(result.ok ? "" : result.message).toContain("phase: requests sent, awaiting engine.hello")
    } finally {
      engine.cleanup()
    }
  },
  10_000,
)

test(
  "#given an engine that answers hello but never capabilities #when the probe deadline expires #then the timeout names that phase",
  async () => {
    // given: an in-process engine that answers engine.hello in the same tick the request is written,
    // so the phase reached before the deadline never depends on how fast a real process starts.
    const stdout = new PassThrough()
    const stdin = new Writable({
      write(chunk: Buffer, _encoding, done) {
        for (const line of chunk.toString("utf8").split("\n").filter(Boolean)) {
          const request = JSON.parse(line) as { id: number; method: string }
          if (request.method === "engine.hello") stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: HELLO })}\n`)
        }
        done()
      },
    })
    const child = Object.assign(new EventEmitter(), {
      stdin, stdout, stderr: new PassThrough(), pid: undefined, unref: () => {}, kill: () => true,
    })
    const launch: EngineLauncher = () => child as unknown as ReturnType<EngineLauncher>

    // when
    const result = await probeComputerUseEngine("in-process-engine", {}, 300, launch)

    // then
    expect(result).toMatchObject({ ok: false, code: "timeout" })
    expect(result.ok ? "" : result.message).toContain("phase: engine.hello answered, awaiting capabilities")
  },
  10_000,
)
