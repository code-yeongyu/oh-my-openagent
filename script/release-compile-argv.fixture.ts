import { mock } from "bun:test"
import * as childProcess from "node:child_process"
import { writeFileSync } from "node:fs"

// A separate process keeps the command interception out of other Bun tests.
class CompileCaptured extends Error {}
const originalSpawn = childProcess.spawnSync
const output = process.argv[2]
const outDir = process.argv[3]
if (output === undefined || outDir === undefined) throw new Error("capture paths are required")
mock.module("node:child_process", () => ({
  ...childProcess,
  spawnSync(command: string, args: readonly string[], options: childProcess.SpawnSyncOptions) {
    if (args.includes("--compile") && args.some((arg) => arg.startsWith("--target="))) {
      writeFileSync(output, JSON.stringify({ command, args }))
      throw new CompileCaptured()
    }
    return originalSpawn(command, args, options)
  },
}))
const { buildReleaseBinary, RELEASE_BINARY_TARGETS } = await import("./build-omo-binary")
const target = RELEASE_BINARY_TARGETS.find((entry) => entry.target === "linux-x64")
if (target === undefined) throw new Error("linux-x64 release target is missing")
try {
  await buildReleaseBinary(target, { omoVersion: "0.0.0-test", omoAiVersion: "0.0.0-test", outDir })
  throw new Error("release compile was not captured")
} catch (error) {
  if (!(error instanceof CompileCaptured)) throw error
}
