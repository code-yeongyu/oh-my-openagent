import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

const args = process.argv.slice(2)
const scenario = args[args.indexOf("--case") + 1]
const out = args[args.indexOf("--out") + 1]
assert.ok(out !== undefined && out.startsWith("/"), "--out must be an absolute JSON path")
assert.ok(scenario !== undefined && args.includes("--case"), "--case required")
mkdirSync(dirname(out), { recursive: true })
const sha = process.env["OMP_SOURCE_SHA"] ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
const startedAt = new Date().toISOString()

try {
  const result = await dispatch(scenario)
  writeFileSync(out, JSON.stringify({ case: scenario, sha, startedAt, endedAt: new Date().toISOString(), ...result }, null, 2))
} catch (error) {
  writeFileSync(
    out,
    JSON.stringify(
      { case: scenario, sha, startedAt, endedAt: new Date().toISOString(), passed: false, error: error instanceof Error ? error.stack : String(error) },
      null,
      2,
    ),
  )
  throw error
}

async function dispatch(name: string): Promise<Record<string, unknown>> {
  switch (name) {
    case "real-child-kernel-tool":
      return await (await import("./omp-item6-real.ts")).runRealChildKernelTool()
    case "curated-process-and-language-denials":
      return await (await import("./omp-item6-denials.ts")).runCuratedProcessAndLanguageDenials()
    case "parked-child-live-kernel":
      return await (await import("./omp-item6-revive.ts")).runParkedChildLiveKernel()
    case "revived-child-stale-kernel":
      return await (await import("./omp-item6-revive.ts")).runRevivedChildStaleKernel()
    case "scoped-narrowed-child":
      return await (await import("./omp-item6-scope.ts")).runScopedNarrowedChild()
    case "unscoped-narrowed-child-refusal":
      return await (await import("./omp-item6-scope.ts")).runUnscopedNarrowedChildRefusal()
    case "producer-scoped-narrowed-child":
      return await (await import("./omp-item6-scope-producer.ts")).runProducerScopedNarrowedChild()
    default:
      return assert.fail(`unknown --case ${name}`)
  }
}
