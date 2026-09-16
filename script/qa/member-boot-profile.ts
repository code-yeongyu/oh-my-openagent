import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { createColdReviveTrace } from "../../packages/senpi-task/src/lifecycle/__fixtures__/cold-revive-trace"
import { realColdRevive } from "../../packages/senpi-task/src/lifecycle/__fixtures__/real-cold-revive"

const output = process.argv[2]
if (!output) throw new Error("Usage: bun script/qa/member-boot-profile.ts <output.json>")
const out = resolve(output)
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
const trace = createColdReviveTrace(true)
let result: unknown
let failure: unknown
try {
  result = await realColdRevive("process", false, { idleTimeoutMs: 37, team: true, trace })
} catch (error) {
  failure = error
} finally {
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify({ head, platform: process.platform, bun: Bun.version,
    passed: failure === undefined, result, error: failure instanceof Error ? failure.stack : failure,
    stages: trace.stages, graphs: trace.graphs,
  }, null, 2))
}
if (failure !== undefined) throw failure
