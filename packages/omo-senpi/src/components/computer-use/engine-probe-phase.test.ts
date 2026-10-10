import { expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { probeComputerUseEngine } from "./engine-probe"

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

test.skipIf(process.platform === "win32")(
  "#given an engine that answers hello but never capabilities #when the probe deadline expires #then the timeout names that phase",
  async () => {
    // given
    const engine = writeEngine(`createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "engine.hello") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: ${JSON.stringify(HELLO)} }) + "\\n");
});`)
    try {
      // when
      const result = await probeComputerUseEngine(engine.path, {}, 300)

      // then
      expect(result).toMatchObject({ ok: false, code: "timeout" })
      expect(result.ok ? "" : result.message).toContain("phase: engine.hello answered, awaiting capabilities")
    } finally {
      engine.cleanup()
    }
  },
  10_000,
)
