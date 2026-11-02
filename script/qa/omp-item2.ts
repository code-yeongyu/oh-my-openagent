import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { execFileSync } from "node:child_process"

const args = process.argv.slice(2)
const scenario = args[args.indexOf("--case") + 1]
const out = args[args.indexOf("--out") + 1]
assert.ok(out && out.startsWith("/"), "--out must be an absolute JSON path")
assert.ok(scenario, "--case required")
mkdirSync(dirname(out), { recursive: true })
const sha = process.env.OMP_SOURCE_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
const startedAt = new Date().toISOString()
try {
  const result = await dispatch(scenario, out)
  if (!args.includes("--out-written") && result.written !== true) {
    writeFileSync(out, JSON.stringify({ case: scenario, sha, startedAt, endedAt: new Date().toISOString(), ...result }, null, 2))
  }
} catch (error) {
  writeFileSync(out, JSON.stringify({ case: scenario, sha, startedAt, endedAt: new Date().toISOString(), passed: false, error: error instanceof Error ? error.stack : String(error) }, null, 2))
  throw error
}

async function dispatch(name: string, path: string): Promise<Record<string, unknown>> {
  switch (name) {
    case "measurement-invalid": return (await import("./omp-item2-invalid.ts")).runInvalid(path)
    case "measure-modes": return (await import("./omp-item2-measure.ts")).runMeasure(path)
    case "eval-aggregate": return (await import("./omp-item2-eval.ts")).runEvalAggregate(path)
    case "cancel-uncertain-notify": return (await import("./omp-item2-eval.ts")).runCancelUncertainNotify(path)
    default: return assert.fail(`unknown --case ${name}`)
  }
}
