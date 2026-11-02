import { describe, expect, it } from "bun:test"
import { spawn, type ChildProcess } from "node:child_process"
import { fstatSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parseModelCatalog, probeModelCatalog, type ModelCatalogSpawnOptions } from "./model-catalog-probe"
import type { RpcSpawnDescriptor } from "./spawn"

const ROWS = 4_000
const LAST_MODEL = `prov${String(ROWS - 1).padStart(5, "0")}/model-${"x".repeat(40)}`

// Writes the rows, then exits at once, the way `senpi --list-models` ends.
const LISTING_CHILD = `
process.stdout.write("provider  model\\n")
for (let index = 0; index < ${ROWS}; index += 1) process.stdout.write("prov" + String(index).padStart(5, "0") + "  model-" + "x".repeat(40) + "\\n")
process.exit(0)
`

function listingDescriptor(): RpcSpawnDescriptor {
  return { command: process.execPath, args: ["-e", LISTING_CHILD], cwd: process.cwd(), env: { ...process.env } }
}

// A host too loaded to drain the probe's stdout pipe while the child runs: when the probe asks for a pipe,
// the child writes into a real pipe that nothing reads until the child has exited (the `exited` marker is
// touched only after it returns). A file descriptor has no reader to wait on, so it is passed straight through.
function spawnWithLoadedHost(exitedMarker: string) {
  return (command: string, args: readonly string[], options: ModelCatalogSpawnOptions): ChildProcess => {
    if (typeof options.stdio[1] === "number") return spawn(command, [...args], options)
    const script = `{ "$0" "$@"; touch "${exitedMarker}"; } | { until [ -f "${exitedMarker}" ]; do sleep 0.01; done; cat; }`
    return spawn("sh", ["-c", script, command, ...args], options)
  }
}

describe("model catalog probe output capture (#9068)", () => {
  describe("#given a listing child that exits right after writing more than a pipe holds", () => {
    it("#when nothing drains its output until it has exited #then the probe still returns every row", async () => {
      // given
      const dir = mkdtempSync(join(tmpdir(), "omo-catalog-stall-"))

      try {
        // when
        const result = await probeModelCatalog(listingDescriptor(), {
          spawnProcess: spawnWithLoadedHost(join(dir, "exited")),
          timeoutMs: 60_000,
        })

        // then
        expect(result.code).toBe(0)
        const models = parseModelCatalog(result.stdout)
        expect(models.size).toBe(ROWS)
        expect(models.has(LAST_MODEL)).toBe(true)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  describe("#given the capture file disappears before the probe reads it", () => {
    it("#when the child exits #then the probe still resolves and names the read failure in stderr", async () => {
      // given
      // Removes only this probe's own capture: the stdout fd is still open here, so its inode names exactly one file.
      const spawnRemovingCapture = (command: string, args: readonly string[], options: ModelCatalogSpawnOptions): ChildProcess => {
        const captureInode = fstatSync(options.stdio[1]).ino
        const child = spawn(command, [...args], options)
        child.once("exit", () => {
          for (const entry of readdirSync(tmpdir())) {
            const candidate = join(tmpdir(), entry, "stdout")
            if (entry.startsWith("omo-model-catalog-") && statSync(candidate, { throwIfNoEntry: false })?.ino === captureInode) rmSync(candidate)
          }
        })
        return child
      }

      // when
      const result = await probeModelCatalog(
        { command: process.execPath, args: ["-e", "process.stdout.write('provider  model\\n')"], cwd: process.cwd(), env: { ...process.env } },
        { spawnProcess: spawnRemovingCapture, timeoutMs: 60_000 },
      )

      // then
      expect(result.code).toBe(0)
      expect(result.stdout).toBe("")
      expect(result.stderr).toContain("could not read the model catalog capture")
    })
  })
})
